import { CatalogueResponseSchema, routes } from "@cartoptix/contracts";
import { catalogueExample } from "@cartoptix/contracts/fixtures";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { createFixtureCatalogueStore, registerCatalogueRoutes } from "../src/catalogue/index.ts";

describe("catalogue API", () => {
  const servers: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    servers.length = 0;
  });

  it("returns the fixture catalogue matching the contract", async () => {
    const server = Fastify({ logger: false });
    registerCatalogueRoutes(server, createFixtureCatalogueStore());
    servers.push(server);
    const response = await server.inject({ method: "GET", url: routes.catalogue.url });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(catalogueExample);
    expect(Value.Check(CatalogueResponseSchema, response.json())).toBe(true);
  });

  it("does not expose collection dates", async () => {
    const server = Fastify({ logger: false });
    registerCatalogueRoutes(server, createFixtureCatalogueStore());
    servers.push(server);
    const response = await server.inject({ method: "GET", url: routes.catalogue.url });
    expect(response.json()).not.toHaveProperty("collectionDate");
  });
});
