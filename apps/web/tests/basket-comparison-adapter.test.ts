import type { BasketCompareResponse, CompleteOption, Multibuy } from "@cartoptix/contracts";
import {
  basketRequestExample,
  noFeasiblePlanExample,
  oneRetailerCompleteExample,
  productsExample,
  recommendedExample,
  tieExample,
} from "@cartoptix/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { adaptComparison } from "../src/features/basket-comparison/adapter";
import {
  type BasketSnapshot,
  PresentationDataFailure,
} from "../src/features/basket-comparison/model";

function snapshot(): BasketSnapshot {
  return {
    revision: 7,
    products: basketRequestExample.lines.map((line) => {
      const product = productsExample.products.find(
        (product) => product.productId === line.productId,
      );
      if (!product) throw new Error("Missing test product");
      return { ...line, name: product.name, packDescription: product.packSize };
    }),
  };
}
function complete(response: BasketCompareResponse): CompleteOption {
  const option = response.options.find((option) => option.status === "complete");
  if (option?.status !== "complete") throw new Error("Missing fixture option");
  return option;
}

describe("shared comparison contract adapter", () => {
  it.each([recommendedExample, tieExample, oneRetailerCompleteExample])(
    "preserves supplied recommendation and option order",
    (response) => {
      const basket = snapshot();
      const before = structuredClone(response);
      const result = adaptComparison(response, basket, {
        kind: "test",
        description: "Shared contract fixture",
      });
      expect(result.outcome).toEqual({
        kind: "recommended",
        retailerId: response.recommendedRetailerId,
      });
      expect(result.options.map((option) => option.retailer.id)).toEqual(
        response.options.map((option) => option.retailerId),
      );
      expect(result.submittedBasket).toEqual(basket);
      expect(result.submittedBasket).not.toBe(basket);
      expect(result.provenance?.kind).toBe("test");
      expect(result.fixtureLabel).toBeUndefined();
      expect(result.options.every((option) => !Object.hasOwn(option.retailer, "purchaseUrl"))).toBe(
        true,
      );
      expect(response).toEqual(before);
    },
  );

  it("maps complete lines, prices, links, zero delivery and a waived charge", () => {
    const result = adaptComparison(recommendedExample, snapshot());
    const option = result.options[0];
    if (option?.kind !== "complete") throw new Error("Expected complete option");
    const original = complete(recommendedExample);
    expect(option.lines[0]).toEqual({
      productId: "fixture-drink",
      quantity: 1,
      name: "Fixture Plain Drink",
      packDescription: "1 \u00d7 500 ml",
      amountCents: 250,
      purchaseUrl: original.lines[0]?.productUrl,
      pricing: {
        unitPriceCents: 250,
        originalPriceCents: null,
        priceKind: "ordinary",
        multibuy: null,
        itemCharges: [],
        excludedPromotions: [],
      },
    });
    expect(option.orderCharges).toEqual(original.orderCharges);
    expect(option.orderCharges?.[0]).toMatchObject({
      amountCents: 399,
      waived: true,
      waivedFromCents: 600,
    });
    expect(option.deliveryCents).toBe(0);
    expect(option.charges.map((charge) => charge.amountCents)).toEqual([0, 0]);
    expect(option.productSubtotalCents).toBe(650);
    expect(option.estimatedTotalCents).toBe(650);
  });

  it("preserves charged fees and does not add line charges twice", () => {
    const result = adaptComparison(tieExample, snapshot());
    const first = result.options[0];
    const second = result.options[1];
    if (first?.kind !== "complete" || second?.kind !== "complete")
      throw new Error("Missing options");
    expect(first.orderCharges?.[0]).toMatchObject({
      amountCents: 160,
      waived: false,
      waivedFromCents: 1000,
    });
    expect(first.estimatedTotalCents).toBe(810);
    expect(second.lines[0]?.pricing?.itemCharges).toEqual([
      { label: "Synthetic container deposit", amountCents: 10, includedInPrice: false },
    ]);
    expect(second.lines[0]?.amountCents).toBe(210);
    expect(second.productSubtotalCents).toBe(810);
    expect(second.estimatedTotalCents).toBe(810);
  });

  it("retains included charges, sale classification, promotions and positive delivery", () => {
    const response: BasketCompareResponse = structuredClone(recommendedExample);
    const option = complete(response);
    const line = option.lines[0];
    if (!line) throw new Error("Missing line");
    line.itemCharges = [{ label: "Included handling", amountCents: 10, includedInPrice: true }];
    line.priceKind = "unconditional_sale";
    line.originalPriceCents = 300;
    line.excludedPromotions = ["Member promotion excluded"];
    option.deliveryCents = 100;
    option.totalCents += 100;
    const mapped = adaptComparison(response, snapshot()).options[0];
    if (mapped?.kind !== "complete") throw new Error("Missing option");
    expect(mapped.lines[0]?.pricing).toEqual({
      unitPriceCents: 250,
      originalPriceCents: 300,
      priceKind: "unconditional_sale",
      multibuy: null,
      itemCharges: line.itemCharges,
      excludedPromotions: line.excludedPromotions,
    });
    expect(mapped.lines[0]?.amountCents).toBe(250);
    expect(mapped.deliveryCents).toBe(100);
    expect(mapped.estimatedTotalCents).toBe(750);
  });

  it.each([
    ["a sale without an original price", "unconditional_sale", null],
    ["a sale whose original price is not higher", "unconditional_sale", 250],
    ["an ordinary price with an original price", "ordinary", 300],
  ] as const)("rejects %s", (_name, priceKind, originalPriceCents) => {
    const response: BasketCompareResponse = structuredClone(recommendedExample);
    const line = complete(response).lines[0];
    if (!line) throw new Error("Missing line");
    line.priceKind = priceKind;
    line.originalPriceCents = originalPriceCents;
    expect(() => adaptComparison(response, snapshot())).toThrow(PresentationDataFailure);
  });

  /** A line of 3 packs with a "2 for" deal saving 100: one deal plus one pack.
   * Uses the one-complete-retailer fixture, so no other option needs repricing. */
  function withDeal(change: Partial<Multibuy> = {}) {
    const response: BasketCompareResponse = structuredClone(oneRetailerCompleteExample);
    const option = complete(response);
    const line = option.lines[0];
    if (!line) throw new Error("Missing line");
    const unit = line.unitPriceCents;
    const charges = line.itemCharges.reduce(
      (sum, charge) => sum + (charge.includedInPrice ? 0 : charge.amountCents),
      0,
    );
    const total = 3 * unit - 100 + charges;
    line.quantity = 3;
    line.multibuy = {
      packsPerDeal: 2,
      dealPriceCents: 2 * unit - 100,
      mixAndMatch: false,
      timesApplied: 1,
      savingCents: 100,
      ...change,
    };
    option.totalCents += total - line.lineTotalCents;
    line.lineTotalCents = total;
    const basket = snapshot();
    for (const product of basket.products)
      if (product.productId === line.productId) product.quantity = 3;
    return { response, basket, line, total };
  }

  it("reconciles a multibuy line from its deals and remaining packs", () => {
    const { response, basket, line, total } = withDeal();
    const mapped = adaptComparison(response, basket).options.find((o) => o.kind === "complete");
    if (mapped?.kind !== "complete") throw new Error("Missing option");
    expect(mapped.lines[0]?.amountCents).toBe(total);
    expect(mapped.lines[0]?.pricing.multibuy).toEqual(line.multibuy);
  });

  it.each([
    ["a deal count that does not match the quantity", { timesApplied: 0 }],
    ["a saving that does not add up", { savingCents: 90 }],
    ["a deal that is not cheaper", { dealPriceCents: 100_000 }],
  ])("rejects a multibuy with %s", (_name, change) => {
    const { response, basket } = withDeal(change);
    expect(() => adaptComparison(response, basket)).toThrow(PresentationDataFailure);
  });

  it("maps no feasible plan and all structured reasons without partial totals", () => {
    const result = adaptComparison(noFeasiblePlanExample, snapshot());
    expect(result.outcome).toEqual({ kind: "no-feasible-plan" });
    for (const [index, option] of result.options.entries()) {
      if (option.kind !== "unavailable") throw new Error("Expected unavailable");
      expect(option.explanations?.map(({ reason }) => reason)).toEqual(
        noFeasiblePlanExample.options[index]?.reasons,
      );
      expect(option).not.toHaveProperty("estimatedTotalCents");
      expect(option).not.toHaveProperty("lines");
    }
    expect(result.options[0]).toMatchObject({
      reasons: ["Delivery charges could not be verified, so a complete total is not shown."],
    });
    expect(result.options[1]).toMatchObject({
      explanations: [
        {
          reason: { code: "below_minimum_order", minimumOrderCents: 1500, spendCents: 650 },
          text: expect.stringContaining("S$6.50"),
        },
      ],
    });
    expect(result.options[2]).toMatchObject({
      reasons: ["No eligible offer for Fixture White Rice."],
    });
  });

  it("uses an unknown reason product ID as context without inventing metadata", () => {
    const response: BasketCompareResponse = structuredClone(noFeasiblePlanExample);
    const option = response.options[0];
    if (option?.status !== "unavailable") throw new Error("Missing option");
    option.reasons = [{ code: "missing_products", productIds: ["unknown"] }];
    expect(adaptComparison(response, snapshot()).options[0]).toMatchObject({
      reasons: ["No eligible offer for unknown."],
    });
  });

  it.each([
    "quantity",
    "missing",
    "extra",
    "duplicate product",
    "duplicate retailer",
    "total",
    "line total",
    "recommendation",
    "waiver",
    "url",
  ])("rejects inconsistent %s without repairing input", (problem) => {
    const response: BasketCompareResponse = structuredClone(recommendedExample);
    const option = complete(response);
    const line = option.lines[0];
    if (!line) throw new Error("Missing line");
    switch (problem) {
      case "quantity":
        line.quantity = 2;
        line.lineTotalCents *= 2;
        option.totalCents += 250;
        break;
      case "missing":
        option.lines.pop();
        break;
      case "extra":
        option.lines.push({ ...line, productId: "extra" });
        break;
      case "duplicate product":
        option.lines.push({ ...line });
        break;
      case "duplicate retailer":
        response.options.push(structuredClone(option));
        break;
      case "total":
        option.totalCents += 1;
        break;
      case "line total":
        line.lineTotalCents += 1;
        break;
      case "recommendation":
        response.recommendedRetailerId = "redmart";
        break;
      case "waiver":
        option.orderCharges[0] = {
          label: "Fee",
          amountCents: 10,
          waived: true,
          waivedFromCents: null,
        };
        break;
      case "url":
        line.productUrl = "javascript:alert(1)";
        break;
    }
    const before = structuredClone(response);
    expect(() => adaptComparison(response, snapshot())).toThrow(PresentationDataFailure);
    expect(response).toEqual(before);
  });

  it.each(["name", "packDescription"] as const)(
    "rejects missing %s instead of fabricating it",
    (field) => {
      const basket = snapshot();
      const product = basket.products[0];
      if (!product) throw new Error("Missing product");
      product[field] = "";
      expect(() => adaptComparison(recommendedExample, basket)).toThrow(PresentationDataFailure);
    },
  );
});
