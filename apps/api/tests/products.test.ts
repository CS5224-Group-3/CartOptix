import { OffersResponseSchema, ProductsResponseSchema, routes } from "@cartoptix/contracts";
import Fastify from "fastify";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import { createFixtureProductsStore, registerProductsRoutes } from "../src/products/index.ts";

describe("products API", () => {
  const servers: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => { await Promise.all(servers.map((server) => server.close())); servers.length = 0; });

  function start() {
    const server = Fastify({ logger: false });
    registerProductsRoutes(server, createFixtureProductsStore());
    servers.push(server);
    return server;
  }

  it("returns products with an unpaginated total", async () => {
    const response = await start().inject({ method: "GET", url: `${routes.products.url}?page=1&pageSize=1` });
    expect(response.statusCode).toBe(200);
    expect(Value.Check(ProductsResponseSchema, response.json())).toBe(true);
    expect(response.json()).toMatchObject({ products: [expect.objectContaining({ productId: "fixture-drink" })], total: 2 });
  });

  it("searches product name and pack size and filters by category", async () => {
    const server = start();
    const search = await server.inject({ method: "GET", url: `${routes.products.url}?q=RICE` });
    const category = await server.inject({ method: "GET", url: `${routes.products.url}?categoryId=drinks` });
    expect(search.json().products.map((product: { productId: string }) => product.productId)).toEqual(["fixture-rice"]);
    expect(category.json().products.map((product: { productId: string }) => product.productId)).toEqual(["fixture-drink"]);
  });

  it("calculates quantity-aware offer totals including extra charges", async () => {
    const response = await start().inject({ method: "GET", url: `${routes.offers.url.replace(":id", "fixture-rice")}?quantity=2` });
    expect(response.statusCode).toBe(200);
    expect(Value.Check(OffersResponseSchema, response.json())).toBe(true);
    expect(response.json().offers).toEqual([
      expect.objectContaining({ retailerId: "fairprice", lineTotalCents: 820, excludedPromotions: ["Unverified multibuy offer"] }),
      expect.objectContaining({ retailerId: "redmart", lineTotalCents: 1230 }),
    ]);
  });

  it("rejects invalid quantities and reports unknown products", async () => {
    const server = start();
    const invalid = await server.inject({ method: "GET", url: `${routes.offers.url.replace(":id", "fixture-rice")}?quantity=21` });
    const missing = await server.inject({ method: "GET", url: `${routes.offers.url.replace(":id", "missing")}?quantity=1` });
    expect(invalid.statusCode).toBe(400);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("not_found");
  });
});
