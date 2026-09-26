import type { OffersResponse, Product } from "@cartoptix/contracts";
import { offersExample, productsExample } from "@cartoptix/contracts/fixtures";
import { priceOffer } from "./offers.ts";
import { searchProducts, type ProductSearchQuery } from "./search.ts";

export interface ProductsStore {
  products(query: ProductSearchQuery): Promise<{ products: Product[]; total: number }>;
  offers(productId: string, quantity: number): Promise<OffersResponse | null>;
}

export function createFixtureProductsStore(): ProductsStore {
  const products = productsExample.products.map((product) => ({ ...product }));
  return {
    async products(query) { return searchProducts(products, query); },
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
