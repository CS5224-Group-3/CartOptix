import {
  BasketCompareResponseSchema,
  CatalogueResponseSchema,
  OffersResponseSchema,
  ProductsResponseSchema,
  routes,
} from "@cartoptix/contracts";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import type { BasketData } from "../src/comparison/store.ts";
import type { Database } from "../src/database.ts";
import { placeholderProducts } from "../src/placeholder/dataset.ts";
import type { DeliveryRule, OfferRule } from "../src/pricing/index.ts";
import { buildServer } from "../src/server.ts";

/** A two-product seed: rice at RedMart and FairPrice, noodles at FairPrice only. */
const offer = (retailerId: "redmart" | "fairprice", productId: string, unitPrice: number) =>
  ({
    listingId: `${retailerId}-${productId}`,
    productId,
    retailerId,
    priceKind: "ordinary",
    unitPrice,
    eligible: true,
    charges: [],
    excludedPromotions: [],
  }) satisfies OfferRule;
const verified = (retailerId: "redmart" | "fairprice"): DeliveryRule => ({
  retailerId,
  verified: true,
  fee: 500,
  freeDeliveryThreshold: 6000,
  minimumOrder: 1000,
  thresholdBasis: { includesMandatoryCharges: false },
  orderCharges: [],
});
const seedOffers = [
  offer("redmart", "rice", 1200),
  offer("fairprice", "rice", 1100),
  offer("fairprice", "noodles", 300),
];

let loadBasket: Database["loadBasket"] = async (productIds): Promise<BasketData> => {
  const offers = seedOffers.filter((o) => productIds.includes(o.productId));
  return {
    knownProductIds: new Set(productIds.filter((id) => ["rice", "noodles"].includes(id))),
    retailers: ["redmart", "fairprice", "cold-storage"],
    offers,
    deliveryRules: [
      verified("redmart"),
      verified("fairprice"),
      { ...verified("fairprice"), retailerId: "cold-storage", verified: false, fee: null },
    ],
    listings: new Map(
      offers.map((o) => [
        o.listingId,
        { productUrl: `https://example.com/${o.listingId}`, excludedPromotions: [] },
      ]),
    ),
  };
};
const defaultLoadBasket = loadBasket;

const database: Database = {
  checkConnection: async () => ({ status: "ok" }),
  loadBasket: (productIds) => loadBasket(productIds),
  close: async () => {},
};
let server: ReturnType<typeof buildServer> | undefined;
afterEach(async () => {
  await server?.close();
  loadBasket = defaultLoadBasket;
});

function start() {
  server = buildServer({ database });
  return server;
}

const lines = (...entries: [string, number][]) =>
  entries.map(([productId, quantity]) => ({ productId, quantity }));

describe("shopper routes", () => {
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
    ["an unknown product", { lines: lines(["rice", 1], ["nope", 1]) }],
    ["a duplicate product", { lines: lines(["rice", 1], ["rice", 2]) }],
    ["21 packs", { lines: lines(["rice", 21]) }],
    ["an unknown field", { lines: lines(["rice", 1]), extra: "x" }],
    ["a retailer limit", { lines: lines(["rice", 1]), maxRetailers: 2 }],
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

  it("recommends the cheapest complete retailer from the seed", async () => {
    const response = await start().inject({
      method: "POST",
      url: routes.compare.url,
      payload: { lines: lines(["rice", 2]) },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Value.Check(BasketCompareResponseSchema, body)).toBe(true);
    // FairPrice 2200 + 500 delivery; RedMart 2400 + 500; Cold Storage unverified and missing rice.
    expect(body).toMatchObject({
      status: "recommended",
      recommendedRetailerId: "fairprice",
      options: [
        { status: "complete", retailerId: "fairprice", totalCents: 2700, deliveryCents: 500 },
        { status: "complete", retailerId: "redmart", totalCents: 2900 },
        {
          status: "unavailable",
          retailerId: "cold-storage",
          reasons: [
            { code: "missing_products", productIds: ["rice"] },
            { code: "delivery_rule_unverified" },
          ],
        },
      ],
    });
    expect(body.options[0].lines).toEqual([
      {
        productId: "rice",
        quantity: 2,
        listingId: "fairprice-rice",
        productUrl: "https://example.com/fairprice-rice",
        priceKind: "ordinary",
        unitPriceCents: 1100,
        itemCharges: [],
        lineTotalCents: 2200,
        excludedPromotions: [],
      },
    ]);
  });

  it("reports no feasible plan with each retailer's reason", async () => {
    const response = await start().inject({
      method: "POST",
      url: routes.compare.url,
      payload: { lines: lines(["noodles", 1]) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "no_feasible_plan",
      options: [
        {
          status: "unavailable",
          retailerId: "cold-storage",
          reasons: [
            { code: "missing_products", productIds: ["noodles"] },
            { code: "delivery_rule_unverified" },
          ],
        },
        {
          status: "unavailable",
          retailerId: "fairprice",
          reasons: [{ code: "below_minimum_order", minimumOrderCents: 1000, spendCents: 300 }],
        },
        {
          status: "unavailable",
          retailerId: "redmart",
          reasons: [{ code: "missing_products", productIds: ["noodles"] }],
        },
      ],
    });
  });

  it("reports a failed database read as a service error, not a business outcome", async () => {
    loadBasket = async () => {
      throw new Error("connection reset");
    };
    const response = await start().inject({
      method: "POST",
      url: routes.compare.url,
      payload: { lines: lines(["rice", 1]) },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe("service_error");
  });
});
