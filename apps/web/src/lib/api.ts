// Typed client for the shopper API, built on the shared contract's routes and shapes.
import {
  type BasketCompareRequest,
  type BasketCompareResponse,
  type CatalogueResponse,
  type ErrorResponse,
  type OffersResponse,
  type OutboundClickRequest,
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

/**
 * Reports that the shopper followed a link to a retailer's product page
 * (PR-07).
 *
 * Unlike every other call here, this one returns nothing and never throws.
 * The link must open either way: if tracking is broken, unreachable or
 * blocked by an extension, the shopper still reaches the retailer and never
 * learns anything went wrong. Nothing may await it, which is why it hands
 * back no promise to await.
 *
 * `sendBeacon` is preferred because the browser owns the request once it is
 * queued, so it survives the page being torn down by the navigation that
 * triggered it; a plain `fetch` would usually be cancelled at exactly that
 * moment. `keepalive` gives the same guarantee where `sendBeacon` is missing.
 *
 * Only the listing is sent. The server supplies the retailer, product and
 * time, so the client cannot misattribute a click and nothing here can become
 * a user identity. The API always answers 204 with no body, so there is
 * nothing to read back.
 */
export function recordOutboundClick(listingId: string): void {
  const body: OutboundClickRequest = { listingId };

  try {
    const payload = JSON.stringify(body);

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      // A false return means the browser refused to queue the beacon, which is
      // not something the shopper can act on.
      navigator.sendBeacon(
        routes.outboundClick.url,
        new Blob([payload], { type: "application/json" }),
      );
      return;
    }

    const attempt = fetch(routes.outboundClick.url, {
      method: routes.outboundClick.method,
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
    });

    // Deliberately not awaited: the caller is navigating away. The handler is
    // here only so an unreachable API cannot surface as an unhandled rejection
    // in the shopper's console.
    attempt.catch(() => undefined);
  } catch {
    // Reaching here means the browser refused something basic, such as a Blob
    // constructor behind a strict policy. Tracking is optional; the click is
    // not.
  }
}

/** The API caps page size at 100, which covers the whole prototype catalogue. */
const ALL_PRODUCTS: ProductsQuery = { pageSize: 100 };

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
    queryKey: ["products", ALL_PRODUCTS],
    queryFn: () => fetchProducts(ALL_PRODUCTS),
    staleTime: Infinity,
  });
  return useMemo(
    () => new Map((data?.products ?? []).map((product) => [product.productId, product])),
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
