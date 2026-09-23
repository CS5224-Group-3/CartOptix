import { routes, type CatalogueResponse } from "@cartoptix/contracts";
import { catalogueExample } from "@cartoptix/contracts/fixtures";
import type { FastifyInstance } from "fastify";

// This interface isolates the HTTP route from its data source. Replace the
// fixture implementation with a database-backed implementation later without
// changing the catalogue endpoint or its shared response contract.
export interface CatalogueStore { catalogue(): Promise<CatalogueResponse>; }

/** Returns the fixture catalogue metadata until database-backed storage is connected. */
export function createFixtureCatalogueStore(): CatalogueStore {
  // Clone the fixture on every request so one caller cannot mutate future responses.
  return { async catalogue() { return structuredClone(catalogueExample); } };
}

/** Registers the catalogue metadata endpoint with the API server. */
export function registerCatalogueRoutes(server: FastifyInstance, store: CatalogueStore): void {
  // GET /catalogue exposes dataset identity, retailers, categories and delivery assumptions.
  // The shared Fastify schema prevents undeclared fields such as collection dates.
  server.get(routes.catalogue.url, { schema: routes.catalogue.schema }, async () => store.catalogue());
}
