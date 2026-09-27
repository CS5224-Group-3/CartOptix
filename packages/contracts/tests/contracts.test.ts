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

const comparisons: [string, BasketCompareResponse][] = [
  ["recommended", fixtures.recommendedExample],
  ["one retailer complete", fixtures.oneRetailerCompleteExample],
  ["tie", fixtures.tieExample],
  ["no feasible plan", fixtures.noFeasiblePlanExample],
];

const completeOptions = (result: BasketCompareResponse) =>
  result.options.filter((option) => option.status === "complete");

describe("fixtures match their schemas", () => {
  const cases: [string, TSchema, unknown][] = [
    ["catalogue", CatalogueResponseSchema, fixtures.catalogueExample],
    ["products", ProductsResponseSchema, fixtures.productsExample],
    ["empty products", ProductsResponseSchema, fixtures.emptyProductsExample],
    ["offers", OffersResponseSchema, fixtures.offersExample],
    ["basket request", BasketCompareRequestSchema, fixtures.basketRequestExample],
    ...comparisons.map(([name, value]): [string, TSchema, unknown] => [
      name,
      BasketCompareResponseSchema,
      value,
    ]),
    ["duplicate lines", ErrorResponseSchema, fixtures.duplicateLinesExample],
    ["service error", ErrorResponseSchema, fixtures.serviceErrorExample],
  ];

  it.each(cases)("%s", (_name, schema, value) => {
    expect([...Value.Errors(schema, value)]).toEqual([]);
  });
});

describe("request limits", () => {
  it("accepts 50 lines of 20 packs", () => {
    const request = {
      lines: Array.from({ length: 50 }, (_, i) => ({ productId: `product-${i}`, quantity: 20 })),
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

  it.each(comparisons)("%s: one option per retailer, in recommendation order", (_name, result) => {
    const retailers = result.options.map((option) => option.retailerId);
    expect(new Set(retailers).size).toBe(retailers.length);
    const firstUnavailable = result.options.findIndex((o) => o.status === "unavailable");
    const complete = completeOptions(result);
    if (firstUnavailable >= 0) expect(firstUnavailable).toBe(complete.length);
    const totals = complete.map((option) => option.totalCents);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
  });

  it.each(comparisons)("%s: complete options cover the whole basket", (_name, result) => {
    const basket = fixtures.basketRequestExample.lines.map((l) => l.productId).sort();
    for (const option of completeOptions(result)) {
      expect(option.lines.map((l) => l.productId).sort()).toEqual(basket);
      const lines = option.lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
      const charges = option.orderCharges
        .filter((c) => !c.waived)
        .reduce((sum, c) => sum + c.amountCents, 0);
      expect(option.totalCents).toBe(lines + charges + option.deliveryCents);
    }
  });

  it.each(comparisons)("%s: the recommendation is the first, cheapest option", (_name, result) => {
    if (result.status === "no_feasible_plan") {
      expect(completeOptions(result)).toEqual([]);
      return;
    }
    const [first] = result.options;
    expect(first?.status).toBe("complete");
    expect(first?.retailerId).toBe(result.recommendedRetailerId);
  });
});

describe("order charges", () => {
  const charges = comparisons.flatMap(([, result]) =>
    completeOptions(result).flatMap((option) => option.orderCharges),
  );

  it("fixtures include both a waived and a charged fee", () => {
    expect([...new Set(charges.map((c) => c.waived))].sort()).toEqual([false, true]);
  });

  it("a waived charge always has a waiver threshold", () => {
    for (const charge of charges) if (charge.waived) expect(charge.waivedFromCents).not.toBeNull();
  });

  it("rejects a charge without its waiver fields", () => {
    const [fairprice, ...rest] = fixtures.recommendedExample.options;
    const bare = { ...fairprice, orderCharges: [{ label: "Fee", amountCents: 399 }] };
    const result = { ...fixtures.recommendedExample, options: [bare, ...rest] };
    expect(Value.Check(BasketCompareResponseSchema, result)).toBe(false);
  });
});

describe("line totals", () => {
  const lines = [
    ...fixtures.offersExample.offers.map((offer) => ({
      ...offer,
      quantity: fixtures.offersExample.quantity,
    })),
    ...comparisons.flatMap(([, result]) =>
      completeOptions(result).flatMap((option) => option.lines),
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

  it("the earlier split-plan shape", () => {
    const split = {
      status: "best_found",
      searchLimitReached: false,
      baseline: null,
      bestSplit: null,
      recommended: "split",
      savingsCents: null,
    };
    expect(Value.Check(BasketCompareResponseSchema, split)).toBe(false);
  });

  it("a complete option in a no-feasible-plan result", () => {
    const [option] = fixtures.recommendedExample.options;
    const result = { ...fixtures.noFeasiblePlanExample, options: [option] };
    expect(Value.Check(BasketCompareResponseSchema, result)).toBe(false);
  });

  it("a recommendation without a retailer, or an unavailable option without a reason", () => {
    const { recommendedRetailerId: _, ...unnamed } = fixtures.recommendedExample;
    expect(Value.Check(BasketCompareResponseSchema, unnamed)).toBe(false);
    const noReason = {
      ...fixtures.noFeasiblePlanExample,
      options: [{ status: "unavailable", retailerId: "redmart", reasons: [] }],
    };
    expect(Value.Check(BasketCompareResponseSchema, noReason)).toBe(false);
    const noProducts = {
      ...fixtures.noFeasiblePlanExample,
      options: [
        {
          status: "unavailable",
          retailerId: "redmart",
          reasons: [{ code: "missing_products", productIds: [] }],
        },
      ],
    };
    expect(Value.Check(BasketCompareResponseSchema, noProducts)).toBe(false);
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
  it("the tie fixture really ties, so the documented retailer order is exercised", () => {
    const [first, second] = completeOptions(fixtures.tieExample);
    expect(first?.totalCents).toBe(second?.totalCents);
    expect(fixtures.tieExample.recommendedRetailerId).toBe(first?.retailerId);
  });
});
