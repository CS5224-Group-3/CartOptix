import { CatalogueResponseSchema, routes } from "@cartoptix/contracts";
import { catalogueExample } from "@cartoptix/contracts/fixtures";
import { Value } from "typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../../src/server.ts";
import {
  createFixtureCatalogueStore,
  createFixtureProductsStore,
} from "../support/fixture-stores.ts";

describe("catalogue API", () => {
  const servers: ReturnType<typeof buildServer>[] = [];
  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    servers.length = 0;
  });

  it("returns the fixture catalogue matching the contract", async () => {
    const catalogue = createFixtureCatalogueStore();
    const products = createFixtureProductsStore();
    const server = buildServer({
      database: {
        checkConnection: async () => ({ status: "ok" }),
        loadBasket: async () => {
          throw new Error("not used");
        },
        loadCatalogue: () => catalogue.catalogue(),
        loadProducts: (query) => products.products(query),
        loadOffers: (productId, quantity) => products.offers(productId, quantity),
        close: async () => {},
      },
    });
    servers.push(server);
    const response = await server.inject({ method: "GET", url: routes.catalogue.url });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(catalogueExample);
    expect(Value.Check(CatalogueResponseSchema, response.json())).toBe(true);
  });

  it("does not expose collection dates", async () => {
    const catalogue = createFixtureCatalogueStore();
    const products = createFixtureProductsStore();
    const server = buildServer({
      database: {
        checkConnection: async () => ({ status: "ok" }),
        loadBasket: async () => {
          throw new Error("not used");
        },
        loadCatalogue: () => catalogue.catalogue(),
        loadProducts: (query) => products.products(query),
        loadOffers: (productId, quantity) => products.offers(productId, quantity),
        close: async () => {},
      },
    });
    servers.push(server);
    const response = await server.inject({ method: "GET", url: routes.catalogue.url });
    expect(response.json()).not.toHaveProperty("collectionDate");
  });
});
