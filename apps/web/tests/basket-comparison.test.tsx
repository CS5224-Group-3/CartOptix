import { routes } from "@cartoptix/contracts";
import { catalogueExample, productsExample } from "@cartoptix/contracts/fixtures";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import App from "../src/App";

it("keeps basket-to-results navigation with a synthetic fixture and no comparison HTTP call", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith(routes.catalogue.url)) return new Response(JSON.stringify(catalogueExample));
    if (url.startsWith(routes.products.url)) return new Response(JSON.stringify(productsExample));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.pushState({}, "", "/basket");
  render(<App queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />);
  expect(screen.queryByText("How many retailer orders?")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Multiple complete retailers/ }));
  fireEvent.click(screen.getByRole("button", { name: /Compare basket/ }));
  expect(await screen.findByRole("heading", { name: "Retailer basket comparison" })).toBeDefined();
  expect(window.location.pathname).toBe("/results");
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith(routes.compare.url))).toBe(
    false,
  );
  // Existing revision tracking must still distinguish an earlier basket result.
  expect(screen.queryByText(/This comparison belongs to an earlier basket state/)).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Edit basket" }));
  fireEvent.click(screen.getByRole("button", { name: "Increase Fixture White Rice" }));
  fireEvent.click(screen.getByRole("link", { name: "View previous" }));
  expect(await screen.findByRole("heading", { name: "Retailer basket comparison" })).toBeDefined();
  expect(screen.getByRole("status").textContent).toContain(
    "This comparison belongs to an earlier basket state.",
  );
  expect(screen.getByRole("status").textContent).toContain("Recalculate");
  expect(screen.getAllByRole("article")).toHaveLength(3);
  expect(screen.getAllByText("1 × 1 kg · Quantity: 1 pack")).toHaveLength(2);
  window.history.replaceState({}, "", "/");
}, 15_000);
