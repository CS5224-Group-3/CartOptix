/**
 * Shopper endpoints, registered from the shared contract's `routes` so Fastify
 * validates requests and serialises responses with the same schemas the web
 * client compiles against.
 *
 * All shopper reads are served from the imported database seed.
 */
import {
  type BasketCompareRequest,
  duplicateProductIds,
  type ErrorResponse,
  type OffersParams,
  type OffersQuery,
  type ProductsQuery,
  routes,
} from "@cartoptix/contracts";
import type { FastifyError, FastifyInstance } from "fastify";
import { compareBasket } from "./comparison/index.ts";
import { toCompareResponse } from "./comparison/response.ts";
import type { Database } from "./database.ts";

function errorBody(code: ErrorResponse["error"]["code"], message: string): ErrorResponse {
  return { error: { code, message } };
}

export function registerShopperRoutes(server: FastifyInstance, database: Database): void {
  server.setErrorHandler((error: FastifyError, request, reply) => {
    // Schema failures and Fastify's own client errors, such as a malformed JSON
    // body, are the caller's to fix; only the rest are retryable service errors.
    const status = error.statusCode ?? 500;
    if (error.validation !== undefined || (status >= 400 && status < 500)) {
      return reply
        .code(status >= 400 && status < 500 ? status : 400)
        .send(errorBody("invalid_request", error.message));
    }
    request.log.error(error);
    return reply
      .code(500)
      .send(errorBody("service_error", "The service is temporarily unavailable."));
  });

  server.setNotFoundHandler((_request, reply) =>
    reply.code(404).send(errorBody("not_found", "No such endpoint.")),
  );

  server.get(routes.catalogue.url, { schema: routes.catalogue.schema }, async () =>
    database.loadCatalogue(),
  );

  server.get<{ Querystring: ProductsQuery }>(
    routes.products.url,
    { schema: routes.products.schema },
    async (request) =>
      database.loadProducts({
        q: request.query.q,
        categoryId: request.query.categoryId,
        page: request.query.page ?? 1,
        pageSize: request.query.pageSize ?? 20,
      }),
  );

  server.get<{ Params: OffersParams; Querystring: OffersQuery }>(
    routes.offers.url,
    { schema: routes.offers.schema },
    async (request, reply) => {
      const result = await database.loadOffers(request.params.id, request.query.quantity);
      if (result === null) {
        return reply
          .code(404)
          .send(errorBody("not_found", "Product not found."));
      }
      return result;
    },
  );

  server.route<{ Body: BasketCompareRequest }>({
    ...routes.compare,
    handler: async (request, reply) => {
      if (duplicateProductIds(request.body).length > 0) {
        return reply
          .code(400)
          .send(errorBody("invalid_request", "Each product may appear only once."));
      }
      const productIds = request.body.lines.map((line) => line.productId);
      // Read failures and bad seed data throw, and the error handler reports them
      // as a retryable service error, never as an unavailable retailer.
      const data = await database.loadBasket(productIds);
      const unknown = productIds.filter((productId) => !data.knownProductIds.has(productId));
      if (unknown.length > 0) {
        return reply
          .code(400)
          .send(errorBody("invalid_request", `Unknown product IDs: ${unknown.join(", ")}.`));
      }
      const result = compareBasket({
        lines: request.body.lines,
        offers: data.offers,
        deliveryRules: data.deliveryRules,
        retailers: data.retailers,
      });
      return toCompareResponse(result, data.listings);
    },
  });
}
