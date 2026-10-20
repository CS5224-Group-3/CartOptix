// Verifies the main web application renders its expected initial UI.
import { SNAPSHOT_DISCLAIMER } from "@cartoptix/contracts";
import { catalogueExample, productsExample, routes } from "@cartoptix/contracts";
import { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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
      await screen.findByRole("heading", { name: "Build a basket from exact products." }),
    ).toBeDefined();
    await waitFor(() => expect(window.location.pathname).toBe("/catalogue"));
  });

  it("shows the shared fixed-dataset disclaimer on the catalogue", () => {
    mockCatalogueApi();
    window.history.replaceState({}, "", "/catalogue");
    render(<App queryClient={createQueryClient()} />);

    expect(screen.getByText(SNAPSHOT_DISCLAIMER, { exact: false })).toBeDefined();
  });
});
