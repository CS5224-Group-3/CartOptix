// Reproducible demo baskets. They reference placeholder product IDs served by the API.
import type { BasketCompareRequest } from "@cartoptix/contracts";

export type BasketLine = BasketCompareRequest["lines"][number];

export interface DemoScenario {
  label: string;
  description: string;
  lines: BasketLine[];
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
  "mixed-pantry": {
    label: "Mixed pantry basket",
    description: "Every retailer stocks the whole basket, so all three totals are compared.",
    lines: lines(["r1", 2], ["da1", 1], ["b1", 1], ["h2", 1], ["s3", 1], ["t1", 2]),
  },
  "single-cheapest": {
    label: "Delivery fees decide",
    description: "Delivery fees and minimums change which complete basket is cheapest.",
    lines: lines(["r2", 2], ["c1", 2], ["s1", 2], ["t2", 1]),
  },
  "one-retailer-only": {
    label: "Only one retailer has everything",
    description: "A retailer-exclusive product leaves the other retailers unavailable.",
    lines: lines(["ex1", 1], ["r1", 2], ["r2", 3], ["c1", 2], ["s1", 2]),
  },
  "no-feasible-plan": {
    label: "No feasible plan",
    description: "A product with no eligible offer at any retailer, so no complete basket exists.",
    lines: lines(["dead1", 1], ["r1", 1]),
  },
  unavailable: {
    label: "Unavailable product",
    description: "Shows retailers that are unavailable because of stock gaps.",
    lines: lines(["s2", 1], ["h3", 1]),
  },
  "excluded-promo": {
    label: "Excluded promotion",
    description: "Member or unverified promotions remain visible but do not affect totals.",
    lines: lines(["c1", 2], ["h2", 1]),
  },
  "delivery-minimum": {
    label: "Below minimum order",
    description: "A small basket that falls below every retailer's minimum order.",
    lines: lines(["r2", 1]),
  },
};
