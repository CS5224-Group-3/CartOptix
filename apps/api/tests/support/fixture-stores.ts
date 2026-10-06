import type { CatalogueResponse, OffersResponse, Product } from "@cartoptix/contracts";
import { catalogueExample, offersExample, productsExample } from "@cartoptix/contracts/fixtures";
import { priceOffer } from "../../src/products/offers.ts";
import type { ProductSearchQuery } from "../../src/products/store.ts";

/** Route tests that need no PostgreSQL. Their search is a stand-in, not the production rule. */

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, "");
}

export function createFixtureCatalogueStore(): { catalogue(): Promise<CatalogueResponse> } {
  return { catalogue: async () => structuredClone(catalogueExample) };
}

export function createFixtureProductsStore(): {
  products(query: ProductSearchQuery): Promise<{ products: Product[]; total: number }>;
  offers(productId: string, quantity: number): Promise<OffersResponse | null>;
} {
  const products = productsExample.products.map((product) => ({ ...product }));
  return {
    async products(query) {
      const term = query.q === undefined ? undefined : normalize(query.q);
      const filtered = products.filter(
        (product) =>
          (query.categoryId === undefined || product.categoryId === query.categoryId) &&
          (term === undefined ||
            [product.name, product.packSize].some((value) => normalize(value).includes(term))),
      );
      const start = (query.page - 1) * query.pageSize;
      return { products: filtered.slice(start, start + query.pageSize), total: filtered.length };
    },
    async offers(productId, quantity) {
      if (productId !== offersExample.product.productId) return null;
      return {
        product: structuredClone(offersExample.product),
        quantity,
        offers: offersExample.offers.map((offer) => priceOffer(offer, quantity)),
      };
    },
  };
}
