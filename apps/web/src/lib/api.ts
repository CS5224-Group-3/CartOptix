// Typed client for the shopper API, built on the shared contract's routes and shapes.
import {
  type BasketCompareRequest,
  type BasketCompareResponse,
  type CatalogueResponse,
  type ErrorResponse,
  type OffersResponse,
  type ProductsQuery,
  type ProductsResponse,
  routes,
} from "@cartoptix/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

/** A non-2xx response, carrying the contract's error code when the API sent one. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorResponse["error"]["code"] | undefined;

  constructor(status: number, message: string, code?: ErrorResponse["error"]["code"]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.ok) return (await response.json()) as T;
  const body = (await response.json().catch(() => undefined)) as ErrorResponse | undefined;
  throw new ApiError(
    response.status,
    body?.error.message ?? `Request failed with status ${response.status}.`,
    body?.error.code,
  );
}

export function fetchCatalogue(): Promise<CatalogueResponse> {
  return request(routes.catalogue.url);
}

export function fetchProducts(query: ProductsQuery): Promise<ProductsResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return request(`${routes.products.url}?${params}`);
}

export function fetchOffers(productId: string, quantity: number): Promise<OffersResponse> {
  const url = routes.offers.url.replace(":id", encodeURIComponent(productId));
  return request(`${url}?quantity=${quantity}`);
}

export function compareBasket(body: BasketCompareRequest): Promise<BasketCompareResponse> {
  return request(routes.compare.url, {
    method: routes.compare.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The API caps page size at 100; fetch every page for basket metadata. */
const PRODUCT_INDEX_PAGE_SIZE = 100;

export function useCatalogue() {
  return useQuery({ queryKey: ["catalogue"], queryFn: fetchCatalogue, staleTime: Infinity });
}

export function useProducts(query: ProductsQuery) {
  return useQuery({
    queryKey: ["products", query],
    queryFn: () => fetchProducts(query),
    placeholderData: keepPreviousData,
  });
}

/** Every product, for looking up basket and plan lines by ID. */
export function useProductIndex() {
  const { data } = useQuery({
    queryKey: ["product-index"],
    queryFn: async () => {
      const first = await fetchProducts({ page: 1, pageSize: PRODUCT_INDEX_PAGE_SIZE });
      const pages = await Promise.all(
        Array.from(
          { length: Math.max(0, Math.ceil(first.total / PRODUCT_INDEX_PAGE_SIZE) - 1) },
          (_, index) => fetchProducts({ page: index + 2, pageSize: PRODUCT_INDEX_PAGE_SIZE }),
        ),
      );
      return [first, ...pages].flatMap((page) => page.products);
    },
    staleTime: Infinity,
  });
  return useMemo(
    () => new Map((data ?? []).map((product) => [product.productId, product])),
    [data],
  );
}

export function useOffers(productId: string, quantity: number) {
  return useQuery({
    queryKey: ["offers", productId, quantity],
    queryFn: () => fetchOffers(productId, quantity),
    enabled: productId !== "",
    // Keep showing the previous quantity's offers while the new ones load.
    placeholderData: (previous) =>
      previous?.product.productId === productId ? previous : undefined,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
}
