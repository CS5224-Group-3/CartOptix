import {
  type BasketCompareResponse,
  BasketCompareResponseSchema,
  CatalogueResponseSchema,
  OffersResponseSchema,
  ProductsResponseSchema,
  routes,
} from "@cartoptix/contracts";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import { compareBasket, UnknownProductsError } from "../src/placeholder/compare.ts";
import { placeholderProducts } from "../src/placeholder/dataset.ts";
import { buildServer } from "../src/server.ts";

const database: Database = {
  checkConnection: async () => ({ status: "ok" }),
  close: async () => {},
};
let server: ReturnType<typeof buildServer> | undefined;
afterEach(async () => {
  await server?.close();
});

function start() {
  server = buildServer({ database });
  return server;
}

const lines = (...entries: [string, number][]) =>
  entries.map(([productId, quantity]) => ({ productId, quantity }));

describe("placeholder shopper routes", () => {
  it("serves a synthetic catalogue matching the contract", async () => {
    const response = await start().inject({ method: "GET", url: routes.catalogue.url });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Value.Check(CatalogueResponseSchema, body)).toBe(true);
  });

  it("searches, filters and paginates products", async () => {
    const app = start();
    const search = await app.inject({ method: "GET", url: `${routes.products.url}?q=rice` });
    expect(Value.Check(ProductsResponseSchema, search.json())).toBe(true);
    expect(search.json().products.map((p: { productId: string }) => p.productId)).toEqual(["r1"]);

    const dairy = await app.inject({
      method: "GET",
      url: `${routes.products.url}?categoryId=dairy`,
    });
    expect(dairy.json().total).toBe(2);

    const page = await app.inject({
      method: "GET",
      url: `${routes.products.url}?pageSize=5&page=2`,
    });
    expect(page.json().products).toHaveLength(5);
    expect(page.json().total).toBe(placeholderProducts.length);
  });

  it("prices offers for the requested quantity, cheapest first", async () => {
    const app = start();
    const response = await app.inject({
      method: "GET",
      url: `${routes.products.url}/r1/offers?quantity=3`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Value.Check(OffersResponseSchema, body)).toBe(true);
    const totals = body.offers.map((offer: { lineTotalCents: number }) => offer.lineTotalCents);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    for (const offer of body.offers) expect(offer.lineTotalCents).toBe(offer.unitPriceCents * 3);
  });

  it("returns not_found for an unknown product and endpoint", async () => {
    const app = start();
    const product = await app.inject({
      method: "GET",
      url: `${routes.products.url}/nope/offers?quantity=1`,
    });
    expect(product.statusCode).toBe(404);
    expect(product.json().error.code).toBe("not_found");
    const endpoint = await app.inject({ method: "GET", url: "/api/v1/nope" });
    expect(endpoint.statusCode).toBe(404);
    expect(endpoint.json().error.code).toBe("not_found");
  });

  it.each([
    ["an unknown product", { lines: lines(["r1", 1], ["nope", 1]) }],
    ["a duplicate product", { lines: lines(["r1", 1], ["r1", 2]) }],
    ["21 packs", { lines: lines(["r1", 21]) }],
    ["an unknown field", { lines: lines(["r1", 1]), extra: "x" }],
    ["a retailer limit", { lines: lines(["r1", 1]), maxRetailers: 2 }],
  ])("rejects a basket with %s", async (_name, payload) => {
    const response = await start().inject({
      method: "POST",
      url: routes.compare.url,
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["an empty JSON body", ""],
  ])("rejects %s as the caller's error, not a service error", async (_name, payload) => {
    const response = await start().inject({
      method: "POST",
      url: routes.compare.url,
      headers: { "content-type": "application/json" },
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
  });

  it("reports an unexpected failure as a retryable service error", async () => {
    const app = start();
    app.get("/api/v1/test-failure", async () => {
      throw new Error("boom");
    });
    const response = await app.inject({ method: "GET", url: "/api/v1/test-failure" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "service_error", message: "The service is temporarily unavailable." },
    });
  });

  it("returns comparison outcomes that match the contract", async () => {
    const response = await start().inject({
      method: "POST",
      url: routes.compare.url,
      payload: { lines: lines(["r1", 2], ["da1", 1], ["b1", 1]) },
    });
    expect(response.statusCode).toBe(200);
    expect(Value.Check(BasketCompareResponseSchema, response.json())).toBe(true);
  });
});

describe("placeholder comparison", () => {
  const compare = (...entries: [string, number][]) => compareBasket({ lines: lines(...entries) });
  const mixed: [string, number][] = [
    ["r1", 2],
    ["da1", 1],
    ["b1", 1],
    ["h2", 1],
    ["s3", 1],
    ["t1", 2],
  ];

  it("prices every retailer and recommends the cheapest complete option", () => {
    const result = compare(...mixed);
    if (result.status !== "recommended") throw new Error(result.status);
    const complete = result.options.filter((option) => option.status === "complete");
    expect(complete.length).toBeGreaterThan(0);
    expect(result.options[0]?.retailerId).toBe(result.recommendedRetailerId);
    const totals = complete.map((option) => option.totalCents);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    expect(new Set(result.options.map((option) => option.retailerId)).size).toBe(3);
  });

  it("marks a retailer unavailable when it lacks a product, and still recommends another", () => {
    const result = compare(["ex1", 1], ["r1", 2], ["r2", 3], ["c1", 2], ["s1", 2]);
    expect(result).toMatchObject({ status: "recommended", recommendedRetailerId: "redmart" });
    const missing = result.options.filter(
      (option) =>
        option.status === "unavailable" &&
        option.reasons.some((reason) => reason.code === "missing_products"),
    );
    expect(missing.length).toBeGreaterThan(0);
    for (const option of result.options) {
      if (option.status === "complete") {
        expect(option.lines.map((line) => line.productId)).toContain("ex1");
      }
    }
  });

  it("reports no feasible plan, with every retailer's reason, for a product nobody stocks", () => {
    const result = compare(["dead1", 1], ["r1", 1]);
    expect(result.status).toBe("no_feasible_plan");
    for (const option of result.options) {
      expect(option).toMatchObject({
        status: "unavailable",
        reasons: [{ code: "missing_products", productIds: ["dead1"] }],
      });
    }
  });

  it("marks retailers below their minimum order unavailable", () => {
    const result = compare(["r2", 1]);
    expect(result.status).toBe("no_feasible_plan");
    for (const option of result.options) {
      expect(option).toMatchObject({
        status: "unavailable",
        reasons: [{ code: "below_minimum_order" }],
      });
    }
  });

  it("always returns a valid result with the cheapest complete option first", () => {
    const ids = placeholderProducts.map(({ product }) => product.productId);
    let seed = 7;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let run = 0; run < 200; run += 1) {
      const picked = new Set<string>();
      const size = 1 + random(8);
      while (picked.size < size) picked.add(ids[random(ids.length)] ?? "r1");
      const result: BasketCompareResponse = compareBasket({
        lines: [...picked].map((productId) => ({ productId, quantity: 1 + random(20) })),
      });
      expect(Value.Check(BasketCompareResponseSchema, result)).toBe(true);
      const complete = result.options.filter((option) => option.status === "complete");
      if (result.status === "recommended") {
        const cheapest = Math.min(...complete.map((option) => option.totalCents));
        expect(result.options[0]).toMatchObject({
          retailerId: result.recommendedRetailerId,
          totalCents: cheapest,
        });
      } else {
        expect(complete).toEqual([]);
      }
    }
  });

  it("throws for unknown products so the route can reject them", () => {
    expect(() => compare(["nope", 1])).toThrow(UnknownProductsError);
  });
});
