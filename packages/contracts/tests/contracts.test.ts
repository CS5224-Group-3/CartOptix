import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import * as fixtures from "../src/fixtures.ts";
import {
  BasketCompareRequestSchema,
  type BasketCompareResponse,
  BasketCompareResponseSchema,
  CatalogueResponseSchema,
  duplicateProductIds,
  ErrorResponseSchema,
  OffersParamsSchema,
  OffersQuerySchema,
  OffersResponseSchema,
  ProductsQuerySchema,
  ProductsResponseSchema,
} from "../src/index.ts";

type BestFound = Extract<BasketCompareResponse, { status: "best_found" }>;

const comparisons: [string, BestFound][] = [
  ["split wins", fixtures.splitWinsExample],
  ["single retailer wins", fixtures.singleRetailerWinsExample],
  ["tie", fixtures.tieExample],
  ["baseline only", fixtures.baselineOnlyExample],
  ["missing baseline", fixtures.missingBaselineExample],
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
    ["tie", BasketCompareResponseSchema, fixtures.tieExample],
    ["baseline only", BasketCompareResponseSchema, fixtures.baselineOnlyExample],
    ["missing baseline", BasketCompareResponseSchema, fixtures.missingBaselineExample],
    ["no plan found", BasketCompareResponseSchema, fixtures.noPlanFoundExample],
    ["proven infeasible", BasketCompareResponseSchema, fixtures.provenInfeasibleExample],
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

  it("requires a 1–20 offer quantity and caps page size", () => {
    expect(Value.Check(OffersQuerySchema, { quantity: 20 })).toBe(true);
    expect(Value.Check(OffersQuerySchema, { quantity: 21 })).toBe(false);
    expect(Value.Check(OffersQuerySchema, {})).toBe(false);
    expect(Value.Check(ProductsQuerySchema, {})).toBe(true);
    expect(Value.Check(ProductsQuerySchema, { pageSize: 101 })).toBe(false);
  });

  it("rejects zero, fractional and negative prices", () => {
    const [offer] = fixtures.offersExample.offers;
    for (const cents of [0, -1, 0.5]) {
      const changed = { ...fixtures.offersExample, offers: [{ ...offer, unitPriceCents: cents }] };
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

  it.each(comparisons)("%s: totals, savings and recommendation agree", (_name, result) => {
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
    if (result.baseline && result.bestSplit?.totalCents === result.baseline.totalCents) {
      expect(result.recommended).toBe("baseline");
    }
    if (result.baseline && recommended) {
      expect(recommended.totalCents).toBeLessThanOrEqual(result.baseline.totalCents);
      expect(result.savingsCents).toBe(result.baseline.totalCents - recommended.totalCents);
    } else {
      expect(result.savingsCents).toBeNull();
    }
  });
});

describe("line totals", () => {
  const lines = [
    ...fixtures.offersExample.offers.map((offer) => ({
      ...offer,
      quantity: fixtures.offersExample.quantity,
    })),
    ...comparisons.flatMap(([, result]) =>
      [result.baseline, result.bestSplit].flatMap((plan) =>
        (plan?.orders ?? []).flatMap((order) => order.lines),
      ),
    ),
  ];

  it("fixtures include charges both inside and on top of the price", () => {
    const kinds = new Set(lines.flatMap((l) => l.itemCharges.map((c) => c.includedInPrice)));
    expect([...kinds].sort()).toEqual([false, true]);
  });

  it.each(lines)("$listingId: unit price × quantity plus added charges", (line) => {
    const added = line.itemCharges.filter((c) => !c.includedInPrice);
    const expected =
      line.unitPriceCents * line.quantity + added.reduce((s, c) => s + c.amountCents, 0);
    expect(line.lineTotalCents).toBe(expected);
  });
});

describe("rejected values", () => {
  const [offer] = fixtures.offersExample.offers;

  it.each([
    ["no plan", { baseline: null, bestSplit: null, recommended: "split", savingsCents: null }],
    ["recommends a missing split", { bestSplit: null, recommended: "split", savingsCents: 0 }],
    ["savings without a baseline", { baseline: null, savingsCents: 0 }],
    [
      "non-zero savings when only the baseline exists",
      { bestSplit: null, recommended: "baseline", savingsCents: 5 },
    ],
  ])("best_found with %s", (_name, change) => {
    const result = { ...fixtures.splitWinsExample, ...change };
    expect(Value.Check(BasketCompareResponseSchema, result)).toBe(false);
  });

  it.each(["javascript:alert(1)", "http://example.com/x", "/relative"])(
    "product URL %s",
    (productUrl) => {
      const changed = { ...fixtures.offersExample, offers: [{ ...offer, productUrl }] };
      expect(Value.Check(OffersResponseSchema, changed)).toBe(false);
    },
  );

  it("a non-https image URL", () => {
    const product = { ...fixtures.riceProduct, imageUrl: "http://example.com/rice.png" };
    expect(Value.Check(OffersResponseSchema, { ...fixtures.offersExample, product })).toBe(false);
  });

  it("an empty retailer or category name", () => {
    const catalogue = fixtures.catalogueExample;
    const noRetailerName = { ...catalogue, retailers: [{ retailerId: "redmart", name: "" }] };
    const noCategoryName = { ...catalogue, categories: [{ categoryId: "drinks", name: "" }] };
    expect(Value.Check(CatalogueResponseSchema, noRetailerName)).toBe(false);
    expect(Value.Check(CatalogueResponseSchema, noCategoryName)).toBe(false);
  });

  it.each(["rice/1kg", "rice?x", "..", "rice 1kg", ""])("ID %j, unsafe in a URL path", (id) => {
    expect(Value.Check(OffersParamsSchema, { id })).toBe(false);
  });
});

describe("tie-break", () => {
  it("the tie fixture really ties, so the fewer-orders rule is exercised", () => {
    const { baseline, bestSplit, recommended } = fixtures.tieExample;
    expect(bestSplit.totalCents).toBe(baseline.totalCents);
    expect(bestSplit.orders.length).toBeGreaterThan(baseline.orders.length);
    expect(recommended).toBe("baseline");
  });
});
