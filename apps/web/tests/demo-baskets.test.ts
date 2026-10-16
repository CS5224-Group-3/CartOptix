import { describe, expect, it } from "vitest";
import { DEMO_BASKET, MAX_DEMO_BASKET } from "../src/demo";

describe("evaluation demo baskets", () => {
  it("provides a normal 20-line basket with distinct products", () => {
    expect(DEMO_BASKET).toHaveLength(20);
    expect(new Set(DEMO_BASKET.map((line) => line.productId)).size).toBe(20);
  });

  it("provides the maximum 50-line basket with distinct products", () => {
    expect(MAX_DEMO_BASKET).toHaveLength(50);
    expect(new Set(MAX_DEMO_BASKET.map((line) => line.productId)).size).toBe(50);
  });

  it.each([[DEMO_BASKET], [MAX_DEMO_BASKET]])(
    "keeps every evaluation quantity within the API limit",
    (basket) => {
      for (const line of basket) {
        expect(Number.isInteger(line.quantity)).toBe(true);
        expect(line.quantity).toBeGreaterThanOrEqual(1);
        expect(line.quantity).toBeLessThanOrEqual(20);
      }
    },
  );
});
