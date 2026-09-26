import type { Product, ProductsQuery } from "@cartoptix/contracts";

export type ProductSearchQuery = Required<Pick<ProductsQuery, "page" | "pageSize">> & Omit<ProductsQuery, "page" | "pageSize">;

export function searchProducts(products: readonly Product[], query: ProductSearchQuery): { products: Product[]; total: number } {
  const term = query.q?.trim().toLocaleLowerCase();
  const filtered = products.filter((product) => {
    if (query.categoryId !== undefined && product.categoryId !== query.categoryId) return false;
    if (term === undefined) return true;
    return [product.name, product.packSize].some((value) => value.toLocaleLowerCase().includes(term));
  });
  const start = (query.page - 1) * query.pageSize;
  return { products: filtered.slice(start, start + query.pageSize), total: filtered.length };
}
