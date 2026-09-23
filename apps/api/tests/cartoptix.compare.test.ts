import { describe, expect, it } from "vitest";
import { DEMO_SCENARIOS, compareBasket, getOffers, getOffersForQuantity } from "@cartoptix/contracts/domain/cartoptix";

describe("CartOptix comparison integrity", () => {
  it("returns the intended outcome for every required demo scenario", () => {
    const expectations: Array<[keyof typeof DEMO_SCENARIOS, string, string]> = [
      ["split-saves", "complete", "split"],
      ["single-cheapest", "complete", "baseline"],
      ["no-split-help", "complete", "baseline"],
      ["no-baseline", "complete", "split"],
      ["no-valid", "no_valid_plan", "none"],
      ["unavailable", "complete", "baseline"],
      ["excluded-promo", "complete", "baseline"],
      ["delivery-minimum", "complete", "baseline"],
    ];
    for (const [scenarioKey, status, recommendation] of expectations) {
      const scenario = DEMO_SCENARIOS[scenarioKey];
      const result = compareBasket(scenario.lines, scenario.retailerLimit);
      expect(result.status, scenarioKey).toBe(status);
      expect(result.recommended, scenarioKey).toBe(recommendation);
    }
  });

  it("never returns a split plan that costs more than a baseline", () => {
    const result = compareBasket(DEMO_SCENARIOS["split-saves"].lines, 2);
    expect(result.baseline).not.toBeNull();
    expect(result.bestSplit).not.toBeNull();
    expect(result.bestSplit!.totalCents).toBeLessThan(result.baseline!.totalCents);
  });

  it("keeps quantities as integer cents and applies a verified multibuy", () => {
    const offers = getOffersForQuantity("da1", 2);
    const fairPrice = offers.find((offer) => offer.retailer === "FairPrice");
    expect(fairPrice?.productCostCents).toBe(760);
    expect(fairPrice?.unitPriceCents).toBe(290);
  });

  it("reports excluded promotions without applying them to totals", () => {
    const result = compareBasket(DEMO_SCENARIOS["excluded-promo"].lines, 3);
    expect(result.excludedPromotions.length).toBeGreaterThan(0);
    expect(result.excludedPromotions[0]).toContain("excluded");
  });

  it("distinguishes unavailable offers and no valid plans", () => {
    expect(getOffers("dead1").every((offer) => offer.stockState === "unavailable")).toBe(true);
    const result = compareBasket(DEMO_SCENARIOS["no-valid"].lines, 3);
    expect(result.calculationStatus).toBe("No valid plan found.");
    expect(result.explanation).toContain("not labelled impossible");
  });

  it("rejects invalid quantities without producing a recommendation", () => {
    const result = compareBasket([{ productId: "r1", quantity: 21 }], 2);
    expect(result.status).toBe("failed");
    expect(result.recommended).toBe("none");
  });
});
