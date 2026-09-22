import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import * as examples from "../src/fixtures.ts";
import {
  BasketCompareRequestSchema,
  BasketCompareResponseSchema,
  buildOpenApiDocument,
  CatalogueResponseSchema,
  CentsSchema,
  DatasetConflictSchema,
  DeliveryRuleSchema,
  duplicateProductIds,
  OfferPricingInputSchema,
  OffersQuerySchema,
  OffersResponseSchema,
  OperationalErrorSchema,
  OrderPricingInputSchema,
  OrderPricingResultSchema,
  openApiDocument,
  PricedLineSchema,
  ProductsQuerySchema,
  ProductsResponseSchema,
  routes,
  ValidationErrorSchema,
} from "../src/index.ts";

const ajv = new Ajv({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});

describe("shared executable examples", () => {
  const cases: [string, TSchema, unknown][] = [
    ["catalogue", CatalogueResponseSchema, examples.catalogueExample],
    ["products", ProductsResponseSchema, examples.productsExample],
    ["empty search is success", ProductsResponseSchema, examples.emptyProductsExample],
    ["offers", OffersResponseSchema, examples.offersExample],
    ["basket request", BasketCompareRequestSchema, examples.basketRequestExample],
    ["best found", BasketCompareResponseSchema, examples.bestFoundExample],
    [
      "baseline fallback after search limit",
      BasketCompareResponseSchema,
      examples.noSplitImprovementExample,
    ],
    ["missing baseline", BasketCompareResponseSchema, examples.missingBaselineExample],
    ["no plan found", BasketCompareResponseSchema, examples.noPlanFoundExample],
    ["proven infeasible", BasketCompareResponseSchema, examples.provenInfeasibleExample],
    ["dataset conflict", DatasetConflictSchema, examples.datasetConflictExample],
    ["database failure", OperationalErrorSchema, examples.databaseFailureExample],
    ["duplicate lines error", ValidationErrorSchema, examples.duplicateLinesErrorExample],
    ["pricing input", OfferPricingInputSchema, examples.pricingInputExample],
    ["priced line", PricedLineSchema, examples.pricedLineExample],
    ["order input", OrderPricingInputSchema, examples.orderPricingInputExample],
    ["order result", OrderPricingResultSchema, examples.orderPricingResultExample],
  ];
  it.each(cases)("%s passes TypeBox and strict AJV", (_name, schema, value) => {
    expect(Value.Check(schema, value)).toBe(true);
    const validate = ajv.compile(schema);
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each(examples.invalidBasketExamples)("rejects $name", ({ kind, value }) => {
    if (kind === "duplicates") {
      expect(Value.Check(BasketCompareRequestSchema, value)).toBe(true);
      if (!Value.Check(BasketCompareRequestSchema, value))
        throw new Error("Fixture must be structurally valid");
      expect(duplicateProductIds(value)).toEqual(["fixture-rice"]);
    } else {
      expect(Value.Check(BasketCompareRequestSchema, value)).toBe(false);
      expect(ajv.compile(BasketCompareRequestSchema)(value)).toBe(false);
    }
  });

  it("accepts the 50-line, 20-pack, 3-retailer boundary", () => {
    const request = {
      datasetId: "fixture-v1",
      maxRetailers: 3,
      lines: Array.from({ length: 50 }, (_, i) => ({ productId: `product-${i}`, quantity: 20 })),
    };
    expect(Value.Check(BasketCompareRequestSchema, request)).toBe(true);
    expect(duplicateProductIds(request)).toEqual([]);
  });

  it("rejects null/unknown delivery fees and non-integer/unsafe money", () => {
    for (const value of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, "100", null]) {
      expect(Value.Check(CentsSchema, value)).toBe(false);
    }
    expect(
      Value.Check(DeliveryRuleSchema, {
        ...examples.fixtureDeliveryRule("redmart"),
        deliveryFeeCents: null,
      }),
    ).toBe(false);
    expect(
      Value.Check(OrderPricingInputSchema, {
        ...examples.orderPricingInputExample,
        delivery: null,
      }),
    ).toBe(false);
  });

  it("requires nullable savings when the baseline is unavailable", () => {
    const invalid = {
      ...examples.missingBaselineExample,
      baseline: { ...examples.missingBaselineExample.baseline, savingsCents: 0 },
    };
    expect(Value.Check(BasketCompareResponseSchema, invalid)).toBe(false);
    expect(Value.Check(BasketCompareResponseSchema, examples.databaseFailureExample)).toBe(false);
    expect(Value.Check(ProductsResponseSchema, examples.databaseFailureExample)).toBe(false);
  });

  it("rejects an unknown status and a plan on a no-plan outcome", () => {
    expect(
      Value.Check(BasketCompareResponseSchema, { ...examples.bestFoundExample, status: "optimal" }),
    ).toBe(false);
    expect(
      Value.Check(BasketCompareResponseSchema, {
        ...examples.noPlanFoundExample,
        recommendation: examples.bestFoundExample.recommendation,
      }),
    ).toBe(false);
  });
});

describe("catalogue and product query boundary", () => {
  it.each([
    { datasetId: "fixture-v1" },
    { datasetId: "fixture-v1", q: "rice", categoryId: "rice-noodles", page: 1, pageSize: 100 },
  ])("accepts a decoded query %j", (value) =>
    expect(Value.Check(ProductsQuerySchema, value)).toBe(true),
  );

  it.each([
    {},
    { datasetId: "fixture-v1", q: "   " },
    { datasetId: "fixture-v1", q: "x".repeat(101) },
    { datasetId: "fixture-v1", page: 0 },
    { datasetId: "fixture-v1", page: 1.5 },
    { datasetId: "fixture-v1", pageSize: 101 },
    { datasetId: "fixture-v1", categoryId: "" },
    { datasetId: "fixture-v1", q: ["rice", "milk"] },
    { datasetId: "fixture-v1", unexpected: "yes" },
  ])("rejects %j", (value) => expect(Value.Check(ProductsQuerySchema, value)).toBe(false));

  it("requires explicit offer quantity and dataset", () => {
    expect(Value.Check(OffersQuerySchema, { datasetId: "fixture-v1", quantity: 20 })).toBe(true);
    expect(Value.Check(OffersQuerySchema, { quantity: 1 })).toBe(false);
    expect(Value.Check(OffersQuerySchema, { datasetId: "fixture-v1" })).toBe(false);
  });

  it("rejects collection dates in the public catalogue", () => {
    expect(
      Value.Check(CatalogueResponseSchema, {
        ...examples.catalogueExample,
        collectionDate: "2026-09-23",
      }),
    ).toBe(false);
  });
});

describe("fixture arithmetic and whole-line integrity", () => {
  it.each(examples.orderPricingCases)("pricing contract pair: $name", ({ input, expected }) => {
    expect(Value.Check(OrderPricingInputSchema, input)).toBe(true);
    expect(Value.Check(OrderPricingResultSchema, expected)).toBe(true);
    if (expected.status === "priced") {
      const order = expected.order;
      expect(order.totalCents).toBe(
        order.merchandiseSubtotalCents +
          order.itemChargesCents +
          order.deliveryCents +
          order.orderCharges.reduce((sum, charge) => sum + charge.amountCents, 0),
      );
      expect(order.minimumOrder === null || order.minimumOrder.met).toBe(true);
    }
  });
  it.each([
    examples.bestFoundExample,
    examples.noSplitImprovementExample,
    examples.missingBaselineExample,
  ])("has complete feasible plans and honest savings in $dataset.datasetId", (result) => {
    expect(result.dataset.datasetId).toBe(result.request.datasetId);
    const plans = [result.recommendation, result.bestSplit, result.baseline.plan].filter(
      (plan) => plan !== null,
    );
    for (const plan of plans) {
      expect(plan.orders.length).toBe(plan.retailerCount);
      expect(new Set(plan.orders.map((order) => order.retailerId)).size).toBe(plan.retailerCount);
      expect(plan.retailerCount).toBeLessThanOrEqual(result.request.maxRetailers);
      const lines = plan.orders.flatMap((order) =>
        order.lines.map(({ productId, quantity }) => ({ productId, quantity })),
      );
      expect(lines.sort((a, b) => a.productId.localeCompare(b.productId))).toEqual(
        [...result.request.lines].sort((a, b) => a.productId.localeCompare(b.productId)),
      );
      expect(plan.totalCents).toBe(plan.orders.reduce((sum, order) => sum + order.totalCents, 0));
      for (const order of plan.orders) {
        expect(order.lines.every((line) => line.retailerId === order.retailerId)).toBe(true);
        expect(order.totalCents).toBe(
          order.lines.reduce((sum, line) => sum + line.lineTotalCents, 0) +
            order.deliveryCents +
            order.orderCharges.reduce((sum, charge) => sum + charge.amountCents, 0),
        );
      }
    }
    if (result.baseline.status === "available") {
      expect(result.baseline.plan.retailerCount).toBe(1);
      expect(result.recommendation.totalCents).toBeLessThanOrEqual(result.baseline.plan.totalCents);
      expect(result.baseline.savingsCents).toBe(
        result.baseline.plan.totalCents - result.recommendation.totalCents,
      );
    } else expect(result.baseline.savingsCents).toBeNull();
  });

  it("itemises included deposits without charging them twice", () => {
    const line = examples.pricedLineExample;
    expect(line.recordedPriceSubtotalCents).toBe(420);
    expect(line.merchandiseSubtotalCents).toBe(400);
    expect(line.lineTotalCents).toBe(430);
    expect(line.lineTotalCents).toBe(
      line.merchandiseSubtotalCents +
        line.itemCharges.reduce((sum, charge) => sum + charge.amountCents, 0),
    );
    const result = examples.orderPricingResultExample;
    if (result.status !== "priced") throw new Error("Expected priced fixture");
    expect(result.order.totalCents).toBe(430 + 300 + 10);
  });
});

describe("generated OpenAPI and Fastify-compatible schemas", () => {
  it("serialises every route and compiles every route schema with strict AJV", () => {
    const ajv2020 = new Ajv2020({ strict: true });
    const document = JSON.parse(JSON.stringify(openApiDocument));
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths)).toHaveLength(7);
    expect(document.paths["/api/v1/products/{id}/offers"].get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", in: "path", required: true }),
        expect.objectContaining({ name: "datasetId", in: "query", required: true }),
      ]),
    );
    expect(
      document.paths["/api/v1/events/outbound-click"].post.responses[204].content,
    ).toBeUndefined();
    for (const route of Object.values(routes)) {
      for (const [key, schema] of Object.entries(route.schema)) {
        if (key === "response") {
          for (const response of Object.values(schema)) {
            expect(() => ajv.compile(response)).not.toThrow();
            expect(() => ajv2020.compile(response)).not.toThrow();
          }
        } else {
          expect(() => ajv.compile(schema)).not.toThrow();
          expect(() => ajv2020.compile(schema)).not.toThrow();
        }
      }
    }
  });

  it("merges methods on a shared path instead of dropping a route", () => {
    const document = buildOpenApiDocument({
      compare: routes.compare,
      clear: { ...routes.compare, method: "DELETE", operationId: "clearBasket" },
    });

    expect(Object.keys(document.paths)).toEqual(["/api/v1/basket/compare"]);
    expect(Object.keys(document.paths["/api/v1/basket/compare"] ?? {}).sort()).toEqual([
      "delete",
      "post",
    ]);
    expect(() => buildOpenApiDocument({ a: routes.compare, b: routes.compare })).toThrow(
      /Duplicate OpenAPI operation/,
    );
  });
});
