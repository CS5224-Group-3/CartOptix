import type { OffersResponse, Product, ProductsResponse } from "@cartoptix/contracts";
import type { QueryClient } from "@tanstack/react-query";

/** Combines every verified metadata source, with later and more specific cache data taking precedence. */
export function buildKnownProductMap(
  queryClient: QueryClient,
  productIndex: ReadonlyMap<string, Product>,
): Map<string, Product> {
  const known = new Map<string, Product>();

  for (const [, product] of queryClient.getQueriesData<Product>({
    queryKey: ["comparison-product"],
  }))
    if (product) known.set(product.productId, product);

  for (const [productId, product] of productIndex) known.set(productId, product);

  for (const [, data] of queryClient.getQueriesData<ProductsResponse>({
    queryKey: ["products"],
  }))
    for (const product of data?.products ?? []) known.set(product.productId, product);

  for (const [, data] of queryClient.getQueriesData<OffersResponse>({ queryKey: ["offers"] }))
    if (data?.product) known.set(data.product.productId, data.product);

  return known;
}
