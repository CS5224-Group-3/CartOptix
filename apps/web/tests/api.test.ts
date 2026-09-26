// Verifies the web API client builds requests from the shared routes and maps errors.
import { type ErrorResponse, routes } from "@cartoptix/contracts";
import { basketRequestExample, splitWinsExample } from "@cartoptix/contracts/fixtures";
import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  compareBasket,
  fetchCatalogue,
  fetchOffers,
  fetchProducts,
} from "../src/lib/api.ts";

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("API client", () => {
  it("requests the catalogue route", async () => {
    const fetchMock = stubFetch(json({}));
    await fetchCatalogue();
    expect(fetchMock).toHaveBeenCalledWith(routes.catalogue.url, undefined);
  });

  it("sends only the product query fields that are set", async () => {
    const fetchMock = stubFetch(json({ products: [], total: 0 }));
    await fetchProducts({ q: "rice", categoryId: undefined, pageSize: 5 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${routes.products.url}?q=rice&pageSize=5`);
  });

  it("fills the product ID into the offers route with the requested quantity", async () => {
    const fetchMock = stubFetch(json({}));
    await fetchOffers("fixture-rice", 3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/products/fixture-rice/offers?quantity=3");
  });

  it("posts the basket as JSON and returns the comparison", async () => {
    const fetchMock = stubFetch(json(splitWinsExample));
    await expect(compareBasket(basketRequestExample)).resolves.toEqual(splitWinsExample);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(routes.compare.url);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(basketRequestExample);
  });

  it("raises the contract's error code and message", async () => {
    const body: ErrorResponse = {
      error: { code: "invalid_request", message: "Each product may appear only once." },
    };
    stubFetch(json(body, 400));
    const error = await compareBasket(basketRequestExample).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: "invalid_request",
      message: "Each product may appear only once.",
    });
  });

  it("still raises a usable error when the body is not JSON", async () => {
    stubFetch(new Response("Bad gateway", { status: 502 }));
    const error = await fetchCatalogue().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 502,
      code: undefined,
      message: "Request failed with status 502.",
    });
  });
});
