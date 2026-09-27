import type { RetailerId } from "@cartoptix/contracts";
import {
  type Cents,
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
 * (#13) loads one dataset, passes its rules in, and maps the result onto the
 * contract.
 */

/**
 * The documented order that breaks ties between equal totals, and the order of
 * unavailable retailers. It follows the contract's retailer enumeration.
 */
export const RETAILER_ORDER: readonly RetailerId[] = ["redmart", "fairprice", "cold-storage"];

export interface BasketLine {
  productId: string;
  /** Whole packs, 1–20; the request schema has already checked the range. */
  quantity: number;
}

export interface CompareBasketInput {
  datasetId: string;
  lines: readonly BasketLine[];
  /** Eligible offers for the basket's products, at any retailer. */
  offers: readonly OfferRule[];
  /** Each retailer's delivery rule; a retailer without one is unverified. */
  deliveryRules: readonly DeliveryRule[];
  /** Retailers to compare; defaults to every retailer, in `RETAILER_ORDER`. */
  retailers?: readonly RetailerId[];
}

/** Why one retailer cannot supply the complete basket. */
export type UnavailableReason =
  | { code: "missing-products"; productIds: string[] }
  | { code: "below-minimum-order"; minimumOrder: Cents; measuredAmount: Cents }
  | { code: "delivery-rule-unverified" };

export type RetailerOption =
  | { status: "complete"; retailerId: RetailerId; order: PricedRetailerOrder }
  | { status: "unavailable"; retailerId: RetailerId; reasons: UnavailableReason[] };

/**
 * `options` holds one entry per compared retailer: complete options, cheapest
 * first with ties in `RETAILER_ORDER`, then unavailable ones in that order. A
 * recommendation is always the first option.
 */
export type BasketComparison =
  | { status: "recommended"; recommendedRetailerId: RetailerId; options: RetailerOption[] }
  | { status: "no-feasible-plan"; options: RetailerOption[] };

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
  const retailers = input.retailers ?? RETAILER_ORDER;
  const options = retailers.map((retailerId) => priceRetailer(input, retailerId));

  const complete = options
    .filter((option) => option.status === "complete")
    .sort(
      (a, b) =>
        a.order.total - b.order.total ||
        RETAILER_ORDER.indexOf(a.retailerId) - RETAILER_ORDER.indexOf(b.retailerId),
    );
  const unavailable = options
    .filter((option) => option.status === "unavailable")
    .sort((a, b) => RETAILER_ORDER.indexOf(a.retailerId) - RETAILER_ORDER.indexOf(b.retailerId));

  const [cheapest] = complete;
  const result: BasketComparison = cheapest
    ? {
        status: "recommended",
        recommendedRetailerId: cheapest.retailerId,
        options: [...complete, ...unavailable],
      }
    : { status: "no-feasible-plan", options: unavailable };

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
  if (missing.length > 0) reasons.push({ code: "missing-products", productIds: missing });

  const delivery = input.deliveryRules.find(
    (rule) => rule.retailerId === retailerId && rule.datasetId === input.datasetId,
  );
  if (!delivery?.verified) reasons.push({ code: "delivery-rule-unverified" });

  // Both reasons above are reported together, so the shopper sees every one;
  // pricing the order is only meaningful once the basket is whole.
  if (reasons.length > 0 || !delivery) return { status: "unavailable", retailerId, reasons };

  const lines = offers.map(({ offer, quantity }) => priceOrThrow(offer, quantity));
  const result = priceRetailerOrder({
    retailerId,
    lines,
    delivery,
    datasetId: input.datasetId,
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
            code: "below-minimum-order",
            minimumOrder: result.reason.minimumOrder,
            measuredAmount: result.reason.measuredAmount,
          },
        ],
      };
    case "unavailable":
      // An unresolved fee is an unverified rule; any other gap is bad data.
      if (result.reason.code === "delivery-rule-unverified") {
        return { status: "unavailable", retailerId, reasons: [{ code: result.reason.code }] };
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

  const retailers = result.options.map((option) => option.retailerId);
  if (new Set(retailers).size !== retailers.length) fail("a retailer appears twice");

  const complete = result.options.filter((option) => option.status === "complete");
  const firstUnavailable = result.options.findIndex((option) => option.status === "unavailable");
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

  for (const option of result.options) {
    if (option.status === "unavailable" && option.reasons.length === 0) {
      fail(`${option.retailerId} is unavailable without a reason`);
    }
  }

  if (result.status === "recommended") {
    if (result.options[0]?.retailerId !== result.recommendedRetailerId) {
      fail("the recommendation is not the first option");
    }
  } else if (complete.length > 0) {
    fail("no feasible plan is reported alongside a complete option");
  }
}
