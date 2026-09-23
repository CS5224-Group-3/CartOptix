import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import * as fixtures from "../src/fixtures.ts";
import {
  BasketCompareRequestSchema,
  BasketCompareResponseSchema,
  CatalogueResponseSchema,
  duplicateProductIds,
  ErrorResponseSchema,
  OffersQuerySchema,
  OffersResponseSchema,
  ProductsQuerySchema,
  ProductsResponseSchema,
} from "../src/index.ts";

const comparisons = [
  fixtures.splitWinsExample,
  fixtures.singleRetailerWinsExample,
  fixtures.missingBaselineExample,
];

describe("fixtures match their schemas", () => {
  const cases: [string, TSchema, unknown][] = [
    ["catalogue", CatalogueResponseSchema, fixtures.catalogueExample],
    ["products", ProductsResponseSchema, fixtures.productsExample],
    ["empty products", ProductsResponseSchema, fixtures.emptyProductsExample],
    ["offers", OffersResponseSchema, fixtures.offersExample],
    ["basket request", BasketCompareRequestSchema, fixtures.basketRequestExample],
    ["split wins", BasketCompareResponseSchema, fixtures.splitWinsExample],
    ["single retailer wins", BasketCompareResponseSchema, fixtures.singleRetailerWinsExample],
    ["missing baseline", BasketCompareResponseSchema, fixtures.missingBaselineExample],
    ["no plan found", BasketCompareResponseSchema, fixtures.noPlanFoundExample],
    ["proven infeasible", BasketCompareResponseSchema, fixtures.provenInfeasibleExample],
    ["dataset conflict", ErrorResponseSchema, fixtures.datasetConflictExample],
    ["duplicate lines", ErrorResponseSchema, fixtures.duplicateLinesExample],
    ["service error", ErrorResponseSchema, fixtures.serviceErrorExample],
  ];

  it.each(cases)("%s", (_name, schema, value) => {
    expect([...Value.Errors(schema, value)]).toEqual([]);
  });
});

describe("request limits", () => {
  it("accepts 50 lines of 20 packs with 3 retailers", () => {
    const request = {
      datasetId: "fixture-v1",
      lines: Array.from({ length: 50 }, (_, i) => ({ productId: `product-${i}`, quantity: 20 })),
      maxRetailers: 3,
    };
    expect(Value.Check(BasketCompareRequestSchema, request)).toBe(true);
  });

  it.each(fixtures.invalidBasketRequests)("rejects $name", ({ value }) => {
    expect(Value.Check(BasketCompareRequestSchema, value)).toBe(false);
  });

  it("finds duplicate products regardless of quantity", () => {
    expect(duplicateProductIds(fixtures.duplicateLinesRequest)).toEqual(["fixture-rice"]);
    expect(duplicateProductIds(fixtures.basketRequestExample)).toEqual([]);
  });

  it("requires a dataset and a 1–20 offer quantity", () => {
    expect(Value.Check(OffersQuerySchema, { datasetId: "fixture-v1", quantity: 20 })).toBe(true);
    expect(Value.Check(OffersQuerySchema, { datasetId: "fixture-v1", quantity: 21 })).toBe(false);
    expect(Value.Check(OffersQuerySchema, { quantity: 1 })).toBe(false);
    expect(Value.Check(ProductsQuerySchema, { datasetId: "fixture-v1", pageSize: 101 })).toBe(
      false,
    );
  });

  it("rejects fractional and negative cents", () => {
    const [offer] = fixtures.offersExample.offers;
    for (const cents of [-1, 0.5]) {
      const changed = { ...fixtures.offersExample, offers: [{ ...offer, lineTotalCents: cents }] };
      expect(Value.Check(OffersResponseSchema, changed)).toBe(false);
    }
  });
});

describe("contract rules", () => {
  it("rejects collection dates and other undeclared fields", () => {
    const dated = { ...fixtures.catalogueExample, collectedOn: "2026-09-23" };
    expect(Value.Check(CatalogueResponseSchema, dated)).toBe(false);
  });

  it("keeps a service error out of every business outcome", () => {
    expect(Value.Check(BasketCompareResponseSchema, fixtures.serviceErrorExample)).toBe(false);
    expect(Value.Check(ProductsResponseSchema, fixtures.serviceErrorExample)).toBe(false);
  });

  it.each(comparisons)("$datasetId totals, savings and recommendation agree", (result) => {
    const recommended = result.recommended === "split" ? result.bestSplit : result.baseline;
    expect(recommended).not.toBeNull();

    for (const plan of [result.baseline, result.bestSplit]) {
      if (!plan) continue;
      expect(plan.totalCents).toBe(plan.orders.reduce((sum, o) => sum + o.totalCents, 0));
      for (const order of plan.orders) {
        const lines = order.lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
        const charges = order.orderCharges.reduce((sum, c) => sum + c.amountCents, 0);
        expect(order.totalCents).toBe(lines + charges + order.deliveryCents);
      }
      const productIds = plan.orders.flatMap((o) => o.lines.map((l) => l.productId)).sort();
      expect(productIds).toEqual(["fixture-drink", "fixture-rice"]);
    }

    if (result.baseline) expect(result.baseline.orders).toHaveLength(1);
    if (result.bestSplit) expect(result.bestSplit.orders.length).toBeGreaterThanOrEqual(2);
    if (result.baseline && recommended) {
      expect(recommended.totalCents).toBeLessThanOrEqual(result.baseline.totalCents);
      expect(result.savingsCents).toBe(result.baseline.totalCents - recommended.totalCents);
    } else {
      expect(result.savingsCents).toBeNull();
    }
  });
});
