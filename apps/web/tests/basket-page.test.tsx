import { routes } from "@cartoptix/contracts";
import {
  basketRequestExample,
  catalogueExample,
  productsExample,
} from "@cartoptix/contracts/fixtures";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "../src/App";
import { BASKET_STORAGE_KEY } from "../src/features/basket/storage";
import { comparisonFixtures } from "./support/fixtures";

afterEach(() => {
  window.sessionStorage.removeItem(BASKET_STORAGE_KEY);
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});

it("renders the empty basket page, brand backdrop and zero item and pack counts", async () => {
  window.sessionStorage.removeItem(BASKET_STORAGE_KEY);
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith(routes.catalogue.url)) return new Response(JSON.stringify(catalogueExample));
    if (url.startsWith(routes.products.url)) return new Response(JSON.stringify(productsExample));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.pushState({}, "", "/basket");

  render(<App queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />);

  expect(await screen.findByRole("heading", { name: "Review your basket" })).toBeDefined();
  expect(screen.getByRole("heading", { name: "Your basket is empty" })).toBeDefined();
  const hero = document.querySelector(".basket-product-hero");
  expect(hero?.querySelector(".basket-product-hero__heading-row h1")?.textContent).toBe(
    "Review your basket",
  );
  expect(hero?.querySelector(".basket-header__meta")?.textContent).toBe("0items0packs");
  expect(hero?.querySelector(".basket-product-hero__track--static")).not.toBeNull();
  expect(hero?.querySelectorAll(".basket-product-hero__brand-mark")).toHaveLength(12);
  expect(
    (screen.getByRole("button", { name: "Compare basket" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(fetchMock.mock.calls.some(([url]) => String(url) === routes.compare.url)).toBe(false);
});

it("comparison navigates to results and goes stale after an edit", async () => {
  window.sessionStorage.setItem(BASKET_STORAGE_KEY, JSON.stringify(basketRequestExample.lines));
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith(routes.catalogue.url)) return new Response(JSON.stringify(catalogueExample));
    if (url.startsWith(routes.products.url)) return new Response(JSON.stringify(productsExample));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.pushState({}, "", "/basket");
  const fakeSource = vi.fn(async () => {
    const fixture = comparisonFixtures.complete;
    if (!fixture) throw new Error("Missing fixture");
    return structuredClone(fixture);
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["product-index"], productsExample.products);
  render(<App comparisonSource={fakeSource} queryClient={queryClient} />);
  expect(screen.queryByText("How many retailer orders?")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Compare basket" }));
  expect(await screen.findByRole("heading", { name: "Retailer basket comparison" })).toBeDefined();
  expect(window.location.pathname).toBe("/results");
  expect(fakeSource).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith(routes.compare.url))).toBe(
    false,
  );
  expect(screen.queryByText(/earlier basket state/)).toBeNull();

  fireEvent.click(screen.getByRole("link", { name: "Edit basket" }));
  fireEvent.click(screen.getByRole("button", { name: "Increase Fixture White Rice" }));
  fireEvent.click(screen.getByRole("link", { name: "View previous" }));
  expect(await screen.findByRole("heading", { name: "Retailer basket comparison" })).toBeDefined();
  expect(screen.getByRole("status").textContent).toContain("earlier basket state");
  expect(screen.getByRole("status").textContent).toContain("Recalculate");
  expect(screen.getAllByRole("article")).toHaveLength(3);
  expect(screen.getAllByText(/1 kg.*Quantity: 1 pack/)).toHaveLength(2);
});
