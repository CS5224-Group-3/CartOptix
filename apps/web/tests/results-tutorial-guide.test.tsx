import { routes } from "@cartoptix/contracts";
import {
  basketRequestExample,
  catalogueExample,
  productsExample,
} from "@cartoptix/contracts/fixtures";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { BASKET_STORAGE_KEY } from "../src/features/basket/storage";
import { comparisonFixtures } from "./support/fixtures";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(BASKET_STORAGE_KEY);
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});

function openComparison(scenario = "complete") {
  window.localStorage.setItem(BASKET_STORAGE_KEY, JSON.stringify(basketRequestExample.lines));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(routes.catalogue.url)) return Response.json(catalogueExample);
      if (url.startsWith(routes.products.url)) return Response.json(productsExample);
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  window.history.replaceState({}, "", "/basket");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["product-index"], productsExample.products);
  render(
    <App
      comparisonSource={async () => {
        const result = comparisonFixtures[scenario];
        if (!result) throw new Error("Missing comparison fixture");
        return structuredClone(result);
      }}
      queryClient={queryClient}
    />,
  );
}

describe("results tutorial guide", () => {
  it("explains retailer columns, the first product, pricing, sign-in, and editing the basket", async () => {
    openComparison();
    fireEvent.click(screen.getByRole("button", { name: "Compare basket" }));
    expect(
      await screen.findByRole("heading", { name: "Retailer basket comparison" }),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    expect(screen.getByRole("heading", { name: "What to do next" })).toBeDefined();
    const dialog = within(screen.getByRole("dialog"));
    const next = () => fireEvent.click(dialog.getByRole("button", { name: "Next" }));

    next();
    expect(screen.getByRole("heading", { name: "Compare the three retailers" })).toBeDefined();
    expect(document.querySelectorAll("#results-retailer-row .matrix__retailer")).toHaveLength(3);

    next();
    expect(
      screen.getByRole("heading", { name: "Some retailer baskets are incomplete" }),
    ).toBeDefined();

    next();
    expect(screen.getByRole("heading", { name: "Your first selected product" })).toBeDefined();
    const firstProduct = document.querySelector("#results-first-product");
    expect(firstProduct?.textContent).toContain(
      comparisonFixtures.complete?.submittedBasket.products[0]?.name,
    );
    expect(firstProduct?.querySelectorAll(".matrix__cell")).toHaveLength(3);

    next();
    expect(
      screen.getByRole("heading", { name: "Confirm the product with a retailer" }),
    ).toBeDefined();
    expect(firstProduct?.querySelector(".text-link")).not.toBeNull();

    next();
    expect(screen.getByRole("heading", { name: "Understand the price breakdown" })).toBeDefined();
    const pricing = document.querySelector("#results-price-breakdown");
    expect(pricing?.textContent).toContain("Product subtotal");
    expect(pricing?.textContent).toContain("Delivery");
    expect(pricing?.textContent).toContain("Estimated total");

    next();
    expect(
      screen.getByRole("heading", { name: "Sign in on the retailer's website" }),
    ).toBeDefined();
    expect(document.querySelector("#results-signin-row")).not.toBeNull();

    next();
    expect(screen.getByRole("heading", { name: "Edit your basket" })).toBeDefined();
    expect(document.querySelector("#results-edit-basket")).not.toBeNull();

    fireEvent.click(dialog.getByRole("button", { name: "Finish" }));
    fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    expect(screen.getByRole("heading", { name: "What to do next" })).toBeDefined();
  });

  it("adds the incomplete basket explanation after the retailer columns", async () => {
    openComparison("unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Compare basket" }));
    await screen.findByRole("heading", { name: "Retailer basket comparison" });
    fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    const dialog = within(screen.getByRole("dialog"));
    const next = () => fireEvent.click(dialog.getByRole("button", { name: "Next" }));

    next();
    expect(screen.getByRole("heading", { name: "Compare the three retailers" })).toBeDefined();
    next();
    expect(
      screen.getByRole("heading", { name: "Some retailer baskets are incomplete" }),
    ).toBeDefined();
    expect(document.querySelector("#results-retailer-row .matrix__retailer--muted")).not.toBeNull();
    next();
    expect(screen.getByRole("heading", { name: "Your first selected product" })).toBeDefined();
  });

  it("guides shoppers to their basket when no comparison is available", async () => {
    cleanup();
    window.localStorage.removeItem(BASKET_STORAGE_KEY);
    window.history.replaceState({}, "", "/results");
    render(
      <App queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    expect(screen.getByRole("heading", { name: "What to do next" })).toBeDefined();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Go to your basket" })).toBeDefined();
    expect(document.querySelector("#results-empty-basket")).not.toBeNull();
  });
});
