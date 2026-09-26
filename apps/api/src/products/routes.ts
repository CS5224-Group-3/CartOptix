import {
  type OffersParams,
  type OffersQuery,
  type ProductsQuery,
  routes,
} from "@cartoptix/contracts";
import type { FastifyInstance } from "fastify";
import type { ProductsStore } from "./store.ts";

export function registerProductsRoutes(server: FastifyInstance, store: ProductsStore): void {
  server.get<{ Querystring: ProductsQuery }>(
    routes.products.url,
    { schema: routes.products.schema },
    async (request) => {
      const query = request.query;
      return store.products({
        q: query.q?.trim(),
        categoryId: query.categoryId,
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
      });
    },
  );

  server.get<{ Params: OffersParams; Querystring: OffersQuery }>(
    routes.offers.url,
    { schema: routes.offers.schema },
    async (request, reply) => {
      const result = await store.offers(request.params.id, request.query.quantity);
      if (result === null)
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "Product not found." } });
      return result;
    },
  );
}
