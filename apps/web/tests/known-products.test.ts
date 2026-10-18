import { offersExample, productsExample } from "@cartoptix/contracts/fixtures";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { buildKnownProductMap } from "../src/features/basket-comparison/knownProducts";

function namedProduct(productId: string, name: string) {
  const template = productsExample.products[0];
  if (!template) throw new Error("Missing shared product fixture");
  return { ...template, productId, name };
}

describe("known product metadata", () => {
  it("combines all metadata sources and lets later, more specific sources win", () => {
    const queryClient = new QueryClient();
    const fromComparisonCache = namedProduct("priority", "Comparison cache");
    const fromIndex = namedProduct("priority", "Product index");
    const fromProductsPage = namedProduct("priority", "Products page");
    const fromOffers = namedProduct("priority", "Offer detail");
    const productsPageOnly = namedProduct("products-page-only", "Products page only");
    const offerOnly = namedProduct("offer-only", "Offer only");
    queryClient.setQueryData(["comparison-product", "priority"], fromComparisonCache);
    queryClient.setQueryData(["products", { page: 1 }], {
      products: [fromProductsPage, productsPageOnly],
      total: 2,
    });
    queryClient.setQueryData(["offers", "priority", 1], {
      ...offersExample,
      product: fromOffers,
    });
    queryClient.setQueryData(["offers", "offer-only", 1], {
      ...offersExample,
      product: offerOnly,
    });

    const known = buildKnownProductMap(queryClient, new Map([["priority", fromIndex]]));

    expect(known.get("priority")).toEqual(fromOffers);
    expect(known.get("products-page-only")).toEqual(productsPageOnly);
    expect(known.get("offer-only")).toEqual(offerOnly);
  });

  it("returns an independent map containing the current product index", () => {
    const queryClient = new QueryClient();
    const product = namedProduct("indexed", "Indexed product");
    const productIndex = new Map([[product.productId, product]]);

    const first = buildKnownProductMap(queryClient, productIndex);
    const second = buildKnownProductMap(queryClient, productIndex);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.get(product.productId)).toEqual(product);
  });
});
