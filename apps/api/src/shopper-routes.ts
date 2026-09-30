/**
 * Shopper endpoints, registered from the shared contract's `routes` so Fastify
 * validates requests and serialises responses with the same schemas the web
 * client compiles against.
 *
 * Basket comparison reads the imported seed. The catalogue, product and offer
 * handlers read the placeholder dataset until #9 and #10 replace them.
 */
import {
  type BasketCompareRequest,
  duplicateProductIds,
  type ErrorResponse,
  type Offer,
  type OffersParams,
  type OffersQuery,
  type ProductsQuery,
  routes,
} from "@cartoptix/contracts";
import type { FastifyError, FastifyInstance } from "fastify";
import { compareBasket } from "./comparison/index.ts";
import { toCompareResponse } from "./comparison/response.ts";
import type { Database } from "./database.ts";
import { placeholderCatalogue, placeholderProducts, planLine } from "./placeholder/dataset.ts";

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

  server.route({ ...routes.catalogue, handler: async () => placeholderCatalogue });

  server.route<{ Querystring: ProductsQuery }>({
    ...routes.products,
    handler: async (request) => {
      const { q, categoryId, page = 1, pageSize = 20 } = request.query;
      const needle = q?.trim().toLowerCase();
      const matches = placeholderProducts
        .map(({ product }) => product)
        .filter(
          (product) =>
            (!needle || product.name.toLowerCase().includes(needle)) &&
            (!categoryId || product.categoryId === categoryId),
        );
      const start = (page - 1) * pageSize;
      return { products: matches.slice(start, start + pageSize), total: matches.length };
    },
  });

  server.route<{ Params: OffersParams; Querystring: OffersQuery }>({
    ...routes.offers,
    handler: async (request, reply) => {
      const entry = placeholderProducts.find(
        ({ product }) => product.productId === request.params.id,
      );
      if (!entry) return reply.code(404).send(errorBody("not_found", "No such product."));
      const { quantity } = request.query;
      const offers: Offer[] = entry.listings
        .map((listing) => {
          const {
            productId: _productId,
            quantity: _quantity,
            ...cost
          } = planLine({ productId: entry.product.productId, quantity }, listing);
          return { retailerId: listing.retailerId, ...cost };
        })
        .sort((a, b) => a.lineTotalCents - b.lineTotalCents);
      return { product: entry.product, quantity, offers };
    },
  });

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
