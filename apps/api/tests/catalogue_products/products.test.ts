import { OffersResponseSchema, ProductsResponseSchema, routes } from "@cartoptix/contracts";
import { catalogueExample } from "@cartoptix/contracts/fixtures";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import { createFixtureProductsStore } from "../../src/products/index.ts";
import { buildServer } from "../../src/server.ts";

describe("products API", () => {
  const servers: ReturnType<typeof buildServer>[] = [];
  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    servers.length = 0;
  });

  function start() {
    const products = createFixtureProductsStore();
    const server = buildServer({
      database: {
        checkConnection: async () => ({ status: "ok" }),
        loadBasket: async () => { throw new Error("not used"); },
        loadCatalogue: async () => structuredClone(catalogueExample),
        loadProducts: (query) => products.products(query),
        loadOffers: (productId, quantity) => products.offers(productId, quantity),
        close: async () => {},
      },
    });
    servers.push(server);
    return server;
  }

  it("returns products with an unpaginated total", async () => {
    const response = await start().inject({
      method: "GET",
      url: `${routes.products.url}?page=1&pageSize=1`,
    });
    expect(response.statusCode).toBe(200);
    expect(Value.Check(ProductsResponseSchema, response.json())).toBe(true);
    expect(response.json()).toMatchObject({
      products: [expect.objectContaining({ productId: "fixture-drink" })],
      total: 2,
    });
  });

  it("searches names and filters by category", async () => {
    const server = start();
    const search = await server.inject({ method: "GET", url: `${routes.products.url}?q=RICE` });
    const category = await server.inject({
      method: "GET",
      url: `${routes.products.url}?categoryId=drinks`,
    });
    expect(
      search.json().products.map((product: { productId: string }) => product.productId),
    ).toEqual(["fixture-rice"]);
    expect(
      category.json().products.map((product: { productId: string }) => product.productId),
    ).toEqual(["fixture-drink"]);
  });

  it("ignores pack-size whitespace but treats wildcard characters literally", async () => {
    const server = start();
    const packSize = await server.inject({
      method: "GET",
      url: `${routes.products.url}?q=1%20kg`,
    });
    const wildcard = await server.inject({
      method: "GET",
      url: `${routes.products.url}?q=%25`,
    });

    expect(packSize.statusCode).toBe(200);
    expect(packSize.json().products.map((product: { productId: string }) => product.productId)).toEqual([
      "fixture-rice",
    ]);
    expect(wildcard.statusCode).toBe(200);
    expect(wildcard.json()).toEqual({ products: [], total: 0 });
  });

  it("returns fixture offers with quantity-aware totals", async () => {
    const response = await start().inject({
      method: "GET",
      url: `${routes.offers.url.replace(":id", "fixture-rice")}?quantity=2`,
    });
    expect(response.statusCode).toBe(200);
    expect(Value.Check(OffersResponseSchema, response.json())).toBe(true);
    expect(response.json().offers).toEqual([
      expect.objectContaining({ retailerId: "fairprice", lineTotalCents: 820 }),
      expect.objectContaining({ retailerId: "redmart", lineTotalCents: 1230 }),
    ]);
  });

  it("rejects invalid pagination and unknown products", async () => {
    const server = start();
    const invalid = await server.inject({
      method: "GET",
      url: `${routes.products.url}?page=0&pageSize=101`,
    });
    const missing = await server.inject({
      method: "GET",
      url: `${routes.offers.url.replace(":id", "missing")}?quantity=1`,
    });
    expect(invalid.statusCode).toBe(400);
    expect(missing.statusCode).toBe(404);
  });

  it("distinguishes an empty result from a store failure", async () => {
    const emptyServer = buildServer({ database: {
      checkConnection: async () => ({ status: "ok" }),
      loadBasket: async () => { throw new Error("not used"); },
      loadCatalogue: async () => structuredClone(catalogueExample),
      loadProducts: async () => ({ products: [], total: 0 }),
      loadOffers: async () => null,
      close: async () => {},
    }});
    const empty = await emptyServer.inject({
      method: "GET",
      url: `${routes.products.url}?page=1&pageSize=1`,
    });
    await emptyServer.close();

    const failingServer = buildServer({ database: {
      checkConnection: async () => ({ status: "ok" }),
      loadBasket: async () => { throw new Error("not used"); },
      loadCatalogue: async () => structuredClone(catalogueExample),
      loadProducts: async () => { throw new Error("database unavailable"); },
      loadOffers: async () => null,
      close: async () => {},
    }});
    const failed = await failingServer.inject({
      method: "GET",
      url: `${routes.products.url}?page=1&pageSize=1`,
    });
    await failingServer.close();

    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ products: [], total: 0 });
    expect(failed.statusCode).toBe(500);
  });
});
