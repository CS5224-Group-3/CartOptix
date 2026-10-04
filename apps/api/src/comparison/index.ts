import type {
  BasketCompareResponse,
  RetailerId,
  UnavailableOption,
  UnavailableReason,
} from "@cartoptix/contracts";
import {
  type DeliveryRule,
  type OfferRule,
  type PricedLine,
  type PricedRetailerOrder,
  priceLine,
  priceRetailerOrder,
  sumCents,
} from "../pricing/index.ts";

/**
 * Single-retailer basket comparison (issue #11, technical spec C2).
 *
 * Prices the complete basket independently at every retailer through the
 * shared pricing module, so a basket total can never disagree with the product
 * offers it is built from. A retailer either supplies every line at its
 * requested quantity, or is unavailable with its reasons; a partial basket is
 * never priced as complete. The cheapest complete option is recommended.
 *
 * Pure and deterministic: no clock, database or environment. The endpoint
 * (#13) loads the seed's rules, passes them in, and maps the result onto the
 * contract.
 */

/**
 * Stable tie-break between retailers: code-point order of their IDs, so it
 * needs no hard-coded list and does not vary with locale. Retailer IDs stay
 * the same as the seed evolves, so the order does too.
 */
export function compareRetailerIds(a: RetailerId, b: RetailerId): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface BasketLine {
  productId: string;
  /** Whole packs, 1–20; the request schema has already checked the range. */
  quantity: number;
}

export interface CompareBasketInput {
  lines: readonly BasketLine[];
  /** Eligible offers for the basket's products, at any retailer. */
  offers: readonly OfferRule[];
  /** Each retailer's delivery rule; a retailer without one is unverified. */
  deliveryRules: readonly DeliveryRule[];
  /** Every retailer in the seed; each gets an option. */
  retailers: readonly RetailerId[];
}

/**
 * A complete option carries the priced order, which `response.ts` maps onto the
 * contract. Unavailable options and their reasons are already contract values,
 * so they pass straight through.
 */
export type CompleteOption = {
  status: "complete";
  retailerId: RetailerId;
  order: PricedRetailerOrder;
};
export type RetailerOption = CompleteOption | UnavailableOption;

/**
 * `options` holds one entry per compared retailer: complete options, cheapest
 * first with ties by `compareRetailerIds`, then unavailable ones in that order. A
 * recommendation is always the first option.
 */
export type BasketComparison =
  | {
      status: Extract<BasketCompareResponse["status"], "recommended">;
      recommendedRetailerId: RetailerId;
      options: RetailerOption[];
    }
  | {
      status: Extract<BasketCompareResponse["status"], "no_feasible_plan">;
      options: UnavailableOption[];
    };

/**
 * The data broke an invariant the importer (#4) is meant to guarantee, such as
 * an ineligible offer or an unresolved charge reaching pricing. The endpoint
 * reports it as a service error: a retry cannot fix it, and it must never be
 * shown as a retailer being unavailable.
 */
export class ComparisonDataError extends Error {
  override readonly name = "ComparisonDataError";
}

export function compareBasket(input: CompareBasketInput): BasketComparison {
  const options = input.retailers.map((retailerId) => priceRetailer(input, retailerId));

  const complete = options
    .filter((option) => option.status === "complete")
    .sort(
      (a, b) => a.order.total - b.order.total || compareRetailerIds(a.retailerId, b.retailerId),
    );
  const unavailable = options
    .filter((option) => option.status === "unavailable")
    .sort((a, b) => compareRetailerIds(a.retailerId, b.retailerId));

  const [cheapest] = complete;
  const result: BasketComparison = cheapest
    ? {
        status: "recommended",
        recommendedRetailerId: cheapest.retailerId,
        options: [...complete, ...unavailable],
      }
    : { status: "no_feasible_plan", options: unavailable };

  validateComparison(input.lines, result);
  return result;
}

function priceRetailer(input: CompareBasketInput, retailerId: RetailerId): RetailerOption {
  const reasons: UnavailableReason[] = [];

  const missing: string[] = [];
  const offers: { offer: OfferRule; quantity: number }[] = [];
  for (const line of input.lines) {
    const matches = input.offers.filter(
      (offer) => offer.retailerId === retailerId && offer.productId === line.productId,
    );
    if (matches.length > 1) {
      throw new ComparisonDataError(
        `Retailer ${retailerId} has ${matches.length} offers for product ${line.productId}`,
      );
    }
    const [offer] = matches;
    if (offer) offers.push({ offer, quantity: line.quantity });
    else missing.push(line.productId);
  }
  if (missing.length > 0) reasons.push({ code: "missing_products", productIds: missing });

  const delivery = input.deliveryRules.find((rule) => rule.retailerId === retailerId);
  if (!delivery?.verified) reasons.push({ code: "delivery_rule_unverified" });

  // Both reasons above are reported together, so the shopper sees every one;
  // pricing the order is only meaningful once the basket is whole.
  if (reasons.length > 0 || !delivery) return { status: "unavailable", retailerId, reasons };

  const lines = offers.map(({ offer, quantity }) => priceOrThrow(offer, quantity));
  const result = priceRetailerOrder({
    retailerId,
    lines,
    delivery,
  });

  switch (result.status) {
    case "priced":
      return { status: "complete", retailerId, order: result.order };
    case "infeasible":
      return {
        status: "unavailable",
        retailerId,
        reasons: [
          {
            code: "below_minimum_order",
            minimumOrderCents: result.reason.minimumOrder,
            spendCents: result.reason.measuredAmount,
          },
        ],
      };
    case "unavailable":
      // An unresolved fee is an unverified rule; any other gap is bad data.
      if (result.reason.code === "delivery-rule-unverified") {
        return {
          status: "unavailable",
          retailerId,
          reasons: [{ code: "delivery_rule_unverified" }],
        };
      }
      throw new ComparisonDataError(result.reason.detail);
  }
}

function priceOrThrow(offer: OfferRule, quantity: number): PricedLine {
  const result = priceLine({ offer, packs: quantity });
  if (result.status === "unavailable") throw new ComparisonDataError(result.reason.detail);
  return result.line;
}

/**
 * Checks the result against the rules the endpoint and interface rely on, so
 * a defect surfaces as an error instead of a wrong recommendation.
 */
function validateComparison(lines: readonly BasketLine[], result: BasketComparison): void {
  const fail = (message: string): never => {
    throw new Error(`Invalid basket comparison: ${message}`);
  };

  // Widen the union of array types so filtering narrows to complete options.
  const options: readonly RetailerOption[] = result.options;
  const retailers = options.map((option) => option.retailerId);
  if (new Set(retailers).size !== retailers.length) fail("a retailer appears twice");

  const complete = options.filter((option) => option.status === "complete");
  const firstUnavailable = options.findIndex((option) => option.status === "unavailable");
  if (firstUnavailable >= 0 && firstUnavailable < complete.length) {
    fail("a complete option follows an unavailable one");
  }

  const requested = new Map(lines.map((line) => [line.productId, line.quantity]));
  for (const { retailerId, order } of complete) {
    const priced = new Map(order.lines.map((line) => [line.productId, line.packs]));
    if (priced.size !== order.lines.length || priced.size !== requested.size) {
      fail(`${retailerId} does not price every line exactly once`);
    }
    for (const [productId, quantity] of requested) {
      if (priced.get(productId) !== quantity) {
        fail(`${retailerId} prices ${productId} at the wrong quantity`);
      }
    }
    const charges = sumCents(
      order.orderCharges.filter((charge) => !charge.waived).map((charge) => charge.amount),
    );
    if (order.total !== order.itemsTotal + order.delivery.amount + charges) {
      fail(`${retailerId}'s total does not reconcile`);
    }
  }

  for (let i = 1; i < complete.length; i += 1) {
    const previous = complete[i - 1];
    const current = complete[i];
    if (previous && current && previous.order.total > current.order.total) {
      fail("complete options are not cheapest first");
    }
  }

  for (const option of options) {
    if (option.status === "unavailable" && option.reasons.length === 0) {
      fail(`${option.retailerId} is unavailable without a reason`);
    }
  }

  if (result.status === "recommended") {
    if (options[0]?.retailerId !== result.recommendedRetailerId) {
      fail("the recommendation is not the first option");
    }
  } else if (complete.length > 0) {
    fail("no feasible plan is reported alongside a complete option");
  }
}
