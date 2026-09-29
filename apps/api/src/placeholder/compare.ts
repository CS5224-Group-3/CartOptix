/**
 * Placeholder basket comparison over the placeholder dataset, returning the shared
 * contract's outcomes. It stands in until the comparison endpoint (#13) lands;
 * replace it rather than extending it.
 *
 * Each retailer's complete basket is priced on its own. A retailer missing a
 * product, or whose order falls below its minimum, is unavailable with a reason.
 *
 * The synthetic dataset has only verified delivery rules and no waivable charges,
 * so this never returns `delivery_rule_unverified` or a waived charge. Those paths
 * belong to the real comparison (#11, #13); the contract fixtures cover them for
 * the web client.
 */
import type {
  BasketCompareRequest,
  BasketCompareResponse,
  CompleteOption,
  PlanLine,
  RetailerId,
  RetailerOption,
  UnavailableOption,
} from "@cartoptix/contracts";
import {
  type PlaceholderListing,
  type PlaceholderProduct,
  type PlaceholderRetailerRule,
  placeholderProducts,
  placeholderRules,
} from "./dataset.ts";

/** Ties between equal totals, and unavailable retailers, go by retailer ID. */
const byRetailerId = (a: { retailerId: RetailerId }, b: { retailerId: RetailerId }) =>
  a.retailerId < b.retailerId ? -1 : a.retailerId > b.retailerId ? 1 : 0;

export class UnknownProductsError extends Error {
  readonly productIds: string[];

  constructor(productIds: string[]) {
    super(`Unknown product IDs: ${productIds.join(", ")}.`);
    this.name = "UnknownProductsError";
    this.productIds = productIds;
  }
}

export interface CompareOptions {
  products?: readonly PlaceholderProduct[];
  rules?: Record<RetailerId, PlaceholderRetailerRule>;
}

type Line = BasketCompareRequest["lines"][number];

export function listingUrl(productId: string, retailerId: RetailerId): string {
  return `https://example.com/cartoptix-placeholder/${retailerId}/${productId}`;
}

export function planLine(line: Line, listing: PlaceholderListing): PlanLine {
  return {
    productId: line.productId,
    quantity: line.quantity,
    listingId: `${line.productId}-${listing.retailerId}`,
    productUrl: listingUrl(line.productId, listing.retailerId),
    priceKind: "ordinary",
    unitPriceCents: listing.unitPriceCents,
    itemCharges: [],
    lineTotalCents: listing.unitPriceCents * line.quantity,
    excludedPromotions: listing.excludedPromotions,
  };
}

function retailerOption(
  retailerId: RetailerId,
  lines: { line: Line; listings: PlaceholderListing[] }[],
  rule: PlaceholderRetailerRule,
): RetailerOption {
  const planLines: PlanLine[] = [];
  const missing: string[] = [];
  for (const { line, listings } of lines) {
    const listing = listings.find((candidate) => candidate.retailerId === retailerId);
    if (listing) planLines.push(planLine(line, listing));
    else missing.push(line.productId);
  }
  if (missing.length > 0) {
    return {
      status: "unavailable",
      retailerId,
      reasons: [{ code: "missing_products", productIds: missing }],
    };
  }
  const subtotalCents = planLines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  if (subtotalCents < rule.minimumOrderCents) {
    return {
      status: "unavailable",
      retailerId,
      reasons: [
        {
          code: "below_minimum_order",
          minimumOrderCents: rule.minimumOrderCents,
          spendCents: subtotalCents,
        },
      ],
    };
  }
  const deliveryCents = subtotalCents >= rule.freeDeliveryFromCents ? 0 : rule.deliveryFeeCents;
  // Placeholder charges are never waived.
  const orderCharges = rule.orderCharges.map((charge) => ({
    ...charge,
    waivedFromCents: null,
    waived: false,
  }));
  const chargesCents = orderCharges.reduce((sum, charge) => sum + charge.amountCents, 0);
  return {
    status: "complete",
    retailerId,
    lines: planLines,
    orderCharges,
    deliveryCents,
    totalCents: subtotalCents + deliveryCents + chargesCents,
  };
}

export function compareBasket(
  request: BasketCompareRequest,
  options: CompareOptions = {},
): BasketCompareResponse {
  const products = options.products ?? placeholderProducts;
  const rules = options.rules ?? placeholderRules;
  const byId = new Map(products.map((entry) => [entry.product.productId, entry]));

  const unknown = request.lines
    .map((line) => line.productId)
    .filter((productId) => !byId.has(productId));
  if (unknown.length > 0) throw new UnknownProductsError(unknown);

  const lines = request.lines.map((line) => ({
    line,
    listings: byId.get(line.productId)?.listings ?? [],
  }));
  const retailers = Object.keys(rules) as RetailerId[];
  const all = retailers.map((retailerId) => retailerOption(retailerId, lines, rules[retailerId]));
  const complete = all
    .filter((option): option is CompleteOption => option.status === "complete")
    .sort((a, b) => a.totalCents - b.totalCents || byRetailerId(a, b));
  const unavailable = all
    .filter((option): option is UnavailableOption => option.status === "unavailable")
    .sort(byRetailerId);

  const [cheapest] = complete;
  if (!cheapest) return { status: "no_feasible_plan", options: unavailable };
  return {
    status: "recommended",
    recommendedRetailerId: cheapest.retailerId,
    options: [...complete, ...unavailable],
  };
}
