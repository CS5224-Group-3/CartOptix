/**
 * Placeholder basket comparison over the placeholder dataset, returning the shared
 * contract's outcomes. It stands in until the pricing module (#8) and comparison
 * endpoint (#13) land; replace it rather than extending it.
 *
 * Every line goes wholly to one retailer. The single-retailer baseline is computed
 * exactly; split plans come from a depth-first search that stops after a fixed
 * number of complete assignments, and reports when it stopped early.
 */
import type {
  BasketCompareRequest,
  BasketCompareResponse,
  Order,
  Plan,
  PlanLine,
  RetailerId,
} from "@cartoptix/contracts";
import {
  type PlaceholderListing,
  type PlaceholderProduct,
  type PlaceholderRetailerRule,
  placeholderProducts,
  placeholderRules,
} from "./dataset.ts";

/** Retailer order used for ties and for listing orders in a plan. */
const RETAILER_ORDER: readonly RetailerId[] = ["redmart", "fairprice", "cold-storage"];

/** Complete assignments the split search evaluates before stopping. */
export const DEFAULT_CANDIDATE_LIMIT = 20_000;

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
  candidateLimit?: number;
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

function buildOrder(
  retailerId: RetailerId,
  lines: PlanLine[],
  rule: PlaceholderRetailerRule,
): Order | null {
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  if (subtotalCents < rule.minimumOrderCents) return null;
  const deliveryCents = subtotalCents >= rule.freeDeliveryFromCents ? 0 : rule.deliveryFeeCents;
  const chargesCents = rule.orderCharges.reduce((sum, charge) => sum + charge.amountCents, 0);
  return {
    retailerId,
    lines,
    orderCharges: rule.orderCharges,
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
  const candidateLimit = options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
  const byId = new Map(products.map((entry) => [entry.product.productId, entry]));

  const unknown = request.lines
    .map((line) => line.productId)
    .filter((productId) => !byId.has(productId));
  if (unknown.length > 0) throw new UnknownProductsError(unknown);

  const lines = request.lines.map((line) => {
    const entry = byId.get(line.productId);
    if (!entry) throw new UnknownProductsError([line.productId]);
    const listings = [...entry.listings].sort(
      (a, b) =>
        a.unitPriceCents - b.unitPriceCents ||
        RETAILER_ORDER.indexOf(a.retailerId) - RETAILER_ORDER.indexOf(b.retailerId),
    );
    return { line, listings };
  });

  // A product with no eligible offer anywhere makes every plan impossible.
  const blocked = lines.filter(({ listings }) => listings.length === 0);
  if (blocked.length > 0) {
    return {
      status: "proven_infeasible",
      blocker: {
        code: "no_eligible_offer",
        productIds: blocked.map(({ line }) => line.productId),
      },
    };
  }

  const buildPlan = (assignment: PlaceholderListing[]): Plan | null => {
    const grouped = new Map<RetailerId, PlanLine[]>();
    assignment.forEach((listing, index) => {
      const entry = lines[index];
      if (!entry) return;
      const group = grouped.get(listing.retailerId) ?? [];
      group.push(planLine(entry.line, listing));
      grouped.set(listing.retailerId, group);
    });
    const orders: Order[] = [];
    for (const retailerId of RETAILER_ORDER) {
      const group = grouped.get(retailerId);
      if (!group) continue;
      const order = buildOrder(retailerId, group, rules[retailerId]);
      if (!order) return null;
      orders.push(order);
    }
    return { orders, totalCents: orders.reduce((sum, order) => sum + order.totalCents, 0) };
  };

  // Baseline: the cheapest retailer that can serve every line, checked exhaustively.
  let baseline: Plan | null = null;
  for (const retailerId of RETAILER_ORDER) {
    const assignment: PlaceholderListing[] = [];
    for (const { listings } of lines) {
      const listing = listings.find((candidate) => candidate.retailerId === retailerId);
      if (!listing) break;
      assignment.push(listing);
    }
    if (assignment.length !== lines.length) continue;
    const plan = buildPlan(assignment);
    if (plan && (!baseline || plan.totalCents < baseline.totalCents)) baseline = plan;
  }

  // Split plans: two or more retailers, up to the requested limit.
  let bestSplit: Plan | null = null;
  let searchLimitReached = false;
  if (request.maxRetailers >= 2) {
    let evaluated = 0;
    const assignment: PlaceholderListing[] = [];
    const used = new Map<RetailerId, number>();
    const visit = (index: number): void => {
      if (searchLimitReached) return;
      if (index === lines.length) {
        if (evaluated >= candidateLimit) {
          searchLimitReached = true;
          return;
        }
        evaluated += 1;
        if (used.size < 2) return;
        const plan = buildPlan(assignment);
        if (plan && (!bestSplit || plan.totalCents < bestSplit.totalCents)) bestSplit = plan;
        return;
      }
      const entry = lines[index];
      if (!entry) return;
      for (const listing of entry.listings) {
        const count = used.get(listing.retailerId) ?? 0;
        if (count === 0 && used.size >= request.maxRetailers) continue;
        used.set(listing.retailerId, count + 1);
        assignment.push(listing);
        visit(index + 1);
        assignment.pop();
        if (count === 0) used.delete(listing.retailerId);
        else used.set(listing.retailerId, count);
        if (searchLimitReached) return;
      }
    };
    visit(0);
  }

  const split = bestSplit as Plan | null;
  if (!baseline && !split) return { status: "no_plan_found", searchLimitReached };
  if (baseline && !split) {
    return {
      status: "best_found",
      searchLimitReached,
      baseline,
      bestSplit: null,
      recommended: "baseline",
      savingsCents: 0,
    };
  }
  if (!baseline && split) {
    return {
      status: "best_found",
      searchLimitReached,
      baseline: null,
      bestSplit: split,
      recommended: "split",
      savingsCents: null,
    };
  }
  if (!baseline || !split) throw new Error("unreachable");
  // A tie goes to the baseline, which needs fewer orders.
  const splitWins = split.totalCents < baseline.totalCents;
  return {
    status: "best_found",
    searchLimitReached,
    baseline,
    bestSplit: split,
    recommended: splitWins ? "split" : "baseline",
    savingsCents: splitWins ? baseline.totalCents - split.totalCents : 0,
  };
}
