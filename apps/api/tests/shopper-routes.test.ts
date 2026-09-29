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
    ["an unknown product", { lines: lines(["r1", 1], ["nope", 1]), maxRetailers: 2 }],
    ["a duplicate product", { lines: lines(["r1", 1], ["r1", 2]), maxRetailers: 2 }],
    ["21 packs", { lines: lines(["r1", 21]), maxRetailers: 2 }],
    ["an unknown field", { lines: lines(["r1", 1]), maxRetailers: 2, extra: "x" }],
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
      payload: { lines: lines(["r1", 2], ["da1", 1], ["b1", 1]), maxRetailers: 2 },
    });
    expect(response.statusCode).toBe(200);
    expect(Value.Check(BasketCompareResponseSchema, response.json())).toBe(true);
  });
});

describe("placeholder comparison", () => {
  const compare = (entries: [string, number][], maxRetailers: number) =>
    compareBasket({ lines: lines(...entries), maxRetailers });

  it("recommends a split when it is cheaper than the baseline", () => {
    const result = compare(
      [
        ["r1", 2],
        ["da1", 1],
        ["b1", 1],
        ["h2", 1],
        ["s3", 1],
        ["t1", 2],
      ],
      2,
    );
    expect(result).toMatchObject({ status: "best_found", recommended: "split" });
    if (result.status !== "best_found" || !result.baseline || !result.bestSplit) throw new Error();
    expect(result.savingsCents).toBe(result.baseline.totalCents - result.bestSplit.totalCents);
    expect(result.savingsCents).toBeGreaterThan(0);
  });

  it("keeps the baseline and zero savings when splitting does not help", () => {
    const result = compare(
      [
        ["d1", 1],
        ["d2", 1],
        ["c2", 1],
        ["h1", 1],
        ["t3", 1],
      ],
      3,
    );
    expect(result).toMatchObject({
      status: "best_found",
      recommended: "baseline",
      savingsCents: 0,
    });
  });

  it("reports unavailable savings when no single retailer has every product", () => {
    const result = compare(
      [
        ["ex1", 1],
        ["ex2", 1],
        ["r1", 2],
        ["r2", 3],
      ],
      2,
    );
    expect(result).toMatchObject({
      status: "best_found",
      baseline: null,
      recommended: "split",
      savingsCents: null,
    });
  });

  it("proves infeasibility when a product has no eligible offer", () => {
    expect(
      compare(
        [
          ["dead1", 1],
          ["r1", 1],
        ],
        3,
      ),
    ).toEqual({
      status: "proven_infeasible",
      blocker: { code: "no_eligible_offer", productIds: ["dead1"] },
    });
  });

  it("finds no plan, without claiming impossibility, when minimums block every order", () => {
    expect(compare([["r2", 1]], 3)).toEqual({ status: "no_plan_found", searchLimitReached: false });
  });

  it("considers only the baseline when one retailer is allowed", () => {
    const result = compare(
      [
        ["r1", 2],
        ["da1", 1],
        ["b1", 1],
        ["h2", 1],
        ["s3", 1],
        ["t1", 2],
      ],
      1,
    );
    expect(result).toMatchObject({
      status: "best_found",
      bestSplit: null,
      recommended: "baseline",
    });
  });

  it("reports the search limit only when the search stops early", () => {
    const basket: [string, number][] = placeholderProducts
      .filter(({ listings }) => listings.length === 3)
      .map(({ product }) => [product.productId, 2]);
    expect(compare(basket.slice(0, 4), 3)).toMatchObject({ searchLimitReached: false });
    const limited = compareBasket(
      { lines: lines(...basket), maxRetailers: 3 },
      { candidateLimit: 50 },
    );
    expect(limited).toMatchObject({ status: "best_found", searchLimitReached: true });
  });

  it("never recommends a plan that costs more than the baseline", () => {
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
        maxRetailers: 1 + random(3),
      });
      expect(Value.Check(BasketCompareResponseSchema, result)).toBe(true);
      if (result.status === "best_found" && result.baseline) {
        const recommended = result.recommended === "split" ? result.bestSplit : result.baseline;
        expect(recommended?.totalCents).toBeLessThanOrEqual(result.baseline.totalCents);
      }
    }
  });

  it("throws for unknown products so the route can reject them", () => {
    expect(() => compare([["nope", 1]], 2)).toThrow(UnknownProductsError);
  });
});
