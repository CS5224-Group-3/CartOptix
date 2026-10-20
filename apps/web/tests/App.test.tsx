// Verifies the main web application renders its expected initial UI.
import { SNAPSHOT_DISCLAIMER, routes } from "@cartoptix/contracts";
import {
  catalogueExample,
  emptyProductsExample,
  productsExample,
} from "@cartoptix/contracts/fixtures";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.tsx";

afterEach(() => window.history.replaceState({}, "", "/"));

function mockCatalogueApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === routes.catalogue.url) return Response.json(catalogueExample);
      if (url.startsWith(routes.products.url)) return Response.json(productsExample);
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("App", () => {
  it("redirects the root route to the catalogue", async () => {
    mockCatalogueApi();
    window.history.replaceState({}, "", "/");
    render(<App queryClient={createQueryClient()} />);

    expect(screen.getByRole("link", { name: "CartOptix home" })).toBeDefined();
    expect(
      await screen.findByRole("heading", { name: "Find your everyday essentials." }),
    ).toBeDefined();
    await waitFor(() => expect(window.location.pathname).toBe("/catalogue"));
  });

  it("shows the shared fixed-dataset disclaimer on the catalogue", () => {
    mockCatalogueApi();
    window.history.replaceState({}, "", "/catalogue");
    render(<App queryClient={createQueryClient()} />);

    expect(screen.getByText(SNAPSHOT_DISCLAIMER, { exact: false })).toBeDefined();
  });

  it("keeps the hero product collage unchanged while searching", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === routes.catalogue.url) return Response.json(catalogueExample);
      if (url.startsWith(routes.products.url)) {
        const isSearch = new URL(url, window.location.origin).searchParams.has("q");
        return Response.json(isSearch ? emptyProductsExample : productsExample);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/catalogue");
    const { container } = render(<App queryClient={createQueryClient()} />);

    await waitFor(() =>
      expect(container.querySelectorAll(".catalogue-collage-tile").length).toBeGreaterThan(1),
    );
    expect(container.querySelectorAll(".catalogue-collage-group")).toHaveLength(6);
    const firstGroupTiles = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".catalogue-collage-group:first-child .catalogue-collage-tile",
      ),
    );
    expect(firstGroupTiles.length).toBeGreaterThan(1);
    expect(firstGroupTiles.length % 2).toBe(0);
    for (const [slot, tile] of firstGroupTiles.entries()) {
      expect(tile.style.gridColumn).toBe(String(Math.floor(slot / 2) + 1));
      expect(tile.style.gridRow).toBe(String((slot % 2) + 1));
      if (slot % 2 === 0) {
        const bottomTile = firstGroupTiles.at(slot + 1);
        expect(bottomTile).toBeDefined();
        expect(tile.dataset.productId).not.toBe(bottomTile?.dataset.productId);
      }
    }
    const initialTiles = Array.from(
      container.querySelectorAll<HTMLElement>(".catalogue-collage-tile"),
    ).map((tile) => tile.dataset.productId);
    fireEvent.change(screen.getByRole("textbox", { name: "Search products" }), {
      target: { value: "no matching product" },
    });

    expect(await screen.findByRole("heading", { name: "No matching products" })).toBeDefined();
    const filteredTiles = Array.from(
      container.querySelectorAll<HTMLElement>(".catalogue-collage-tile"),
    ).map((tile) => tile.dataset.productId);
    expect(filteredTiles).toEqual(initialTiles);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("q=no"))).toBe(true);
  });
});
