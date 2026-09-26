import {
  routes,
  type OffersParams,
  type OffersQuery,
  type OffersResponse,
  type Product,
  type ProductsQuery,
} from "@cartoptix/contracts";
import { offersExample, productsExample } from "@cartoptix/contracts/fixtures";
import type { FastifyInstance } from "fastify";

// Product search and offer lookup depend on this interface rather than directly
// on fixture data. A future repository can read active-dataset records here.
export interface ProductsStore {
  products(query: Required<Pick<ProductsQuery, "page" | "pageSize">> & Omit<ProductsQuery, "page" | "pageSize">): Promise<{ products: Product[]; total: number }>;
  offers(productId: string, quantity: number): Promise<OffersResponse | null>;
}

/** Creates the fixture-backed product and offer store for local development. */
export function createFixtureProductsStore(): ProductsStore {
  // These fixtures make the API runnable before database/schema work is complete.
  const products = productsExample.products.map((product) => ({ ...product }));
  return {
    async products(query) {
      // Apply category and text filters before pagination so `total` describes all matches.
      const term = query.q?.trim().toLocaleLowerCase();
      const filtered = products.filter((product) => {
        if (query.categoryId !== undefined && product.categoryId !== query.categoryId) return false;
        if (!term) return true;
        return [product.name, product.packSize].some((value) => value.toLocaleLowerCase().includes(term));
      });
      const start = (query.page - 1) * query.pageSize;
      // Stable array ordering plus deterministic slicing gives repeatable pages.
      return { products: filtered.slice(start, start + query.pageSize), total: filtered.length };
    },
    async offers(productId, quantity) {
      // This fixture contains offers for one product; unknown IDs map to a 404 in the route.
      if (productId !== offersExample.product.productId) return null;
      return {
        product: structuredClone(offersExample.product),
        quantity,
        offers: offersExample.offers.map((offer) => ({
          ...offer,
          lineTotalCents:
            offer.unitPriceCents * quantity +
            offer.itemCharges
              .filter((charge) => !charge.includedInPrice)
              .reduce((total, charge) => total + charge.amountCents, 0),
        })),
      };
    },
  };
}

/** Registers product search and quantity-aware offer endpoints with the API server. */
export function registerProductsRoutes(server: FastifyInstance, store: ProductsStore): void {
  // GET /products supports contract-validated search, category filtering and pagination.
  server.get<{ Querystring: ProductsQuery }>(routes.products.url, { schema: routes.products.schema }, async (request) => {
    const query = request.query;
    return store.products({ q: query.q?.trim(), categoryId: query.categoryId, page: query.page ?? 1, pageSize: query.pageSize ?? 20 });
  });
  // GET /products/:id/offers returns quantity-aware retailer prices and promotion disclosures.
  server.get<{ Params: OffersParams; Querystring: OffersQuery }>(routes.offers.url, { schema: routes.offers.schema }, async (request, reply) => {
    const result = await store.offers(request.params.id, request.query.quantity);
    if (result === null) return reply.code(404).send({ error: { code: "not_found", message: "Product not found." } });
    return result;
  });
}
