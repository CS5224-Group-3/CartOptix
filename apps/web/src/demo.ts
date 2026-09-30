// Reproducible demo baskets. They reference placeholder product IDs served by the API.
import type { BasketCompareRequest } from "@cartoptix/contracts";

export type BasketLine = BasketCompareRequest["lines"][number];

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
