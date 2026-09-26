import { routes } from "@cartoptix/contracts";
import type { FastifyInstance } from "fastify";
import type { CatalogueStore } from "./store.ts";

export function registerCatalogueRoutes(server: FastifyInstance, store: CatalogueStore): void {
  server.get(routes.catalogue.url, { schema: routes.catalogue.schema }, async () =>
    store.catalogue(),
  );
}
