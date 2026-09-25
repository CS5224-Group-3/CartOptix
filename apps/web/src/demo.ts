// Reproducible demo baskets. They reference placeholder product IDs served by the API.
import type { BasketCompareRequest } from "@cartoptix/contracts";

export type BasketLine = BasketCompareRequest["lines"][number];
export type RetailerLimit = 1 | 2 | 3;

export interface DemoScenario {
  label: string;
  description: string;
  lines: BasketLine[];
  retailerLimit: RetailerLimit;
}

const lines = (...entries: [string, number][]): BasketLine[] =>
  entries.map(([productId, quantity]) => ({ productId, quantity }));

/** Twenty ordinary products, every third one doubled. */
export const DEMO_BASKET: BasketLine[] = [
  "r1",
  "r2",
  "d1",
  "d2",
  "da1",
  "da2",
  "b1",
  "b2",
  "c1",
  "c2",
  "c3",
  "s1",
  "s2",
  "s3",
  "h1",
  "h2",
  "h3",
  "t1",
  "t2",
  "t3",
].map((productId, index) => ({ productId, quantity: index % 3 === 0 ? 2 : 1 }));

export const DEMO_SCENARIOS: Record<string, DemoScenario> = {
  "split-saves": {
    label: "Split saves money",
    description: "A mixed pantry basket where FairPrice and RedMart each have strong prices.",
    lines: lines(["r1", 2], ["da1", 1], ["b1", 1], ["h2", 1], ["s3", 1], ["t1", 2]),
    retailerLimit: 2,
  },
  "single-cheapest": {
    label: "One retailer wins",
    description: "A complete basket where delivery fees and minimums make a single order clearer.",
    lines: lines(["r2", 2], ["c1", 2], ["s1", 2], ["t2", 1]),
    retailerLimit: 2,
  },
  "no-split-help": {
    label: "Splitting does not help",
    description: "A basket that stays cheaper as one complete order.",
    lines: lines(["d1", 1], ["d2", 1], ["c2", 1], ["h1", 1], ["t3", 1]),
    retailerLimit: 3,
  },
  "no-baseline": {
    label: "No single-retailer baseline",
    description: "Two retailer-exclusive products; only a split plan can complete the basket.",
    lines: lines(["ex1", 1], ["ex2", 1], ["r1", 2], ["r2", 3]),
    retailerLimit: 2,
  },
  "proven-infeasible": {
    label: "Impossible basket",
    description: "A product with no eligible offer at any retailer, so no plan can exist.",
    lines: lines(["dead1", 1], ["r1", 1]),
    retailerLimit: 3,
  },
  unavailable: {
    label: "Unavailable product",
    description: "Shows items with retailer-level stock gaps.",
    lines: lines(["s2", 1], ["h3", 1]),
    retailerLimit: 3,
  },
  "excluded-promo": {
    label: "Excluded promotion",
    description: "Member or unverified promotions remain visible but do not affect totals.",
    lines: lines(["c1", 2], ["h2", 1]),
    retailerLimit: 3,
  },
  "delivery-minimum": {
    label: "Delivery + minimums",
    description: "Order-size constraints shape whether a split is feasible.",
    lines: lines(["r1", 2], ["r2", 2]),
    retailerLimit: 3,
  },
};
