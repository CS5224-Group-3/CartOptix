import { routes } from "@cartoptix/contracts";
import {
  basketRequestExample,
  catalogueExample,
  productsExample,
} from "@cartoptix/contracts/fixtures";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { BASKET_STORAGE_KEY } from "../src/features/basket/storage";

afterEach(() => {
  window.localStorage.removeItem(BASKET_STORAGE_KEY);
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});

function openBasket(lines: { productId: string; quantity: number }[] = []) {
  window.localStorage.setItem(BASKET_STORAGE_KEY, JSON.stringify(lines));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(routes.catalogue.url)) {
        return new Response(JSON.stringify(catalogueExample), { status: 200 });
      }
      if (url.startsWith(routes.products.url)) {
        return new Response(JSON.stringify(productsExample), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  window.history.replaceState({}, "", "/basket");
  render(<App queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />);
}

describe("basket tutorial guide", () => {
  it("shows a Browse products step for an empty basket and can be replayed", async () => {
    openBasket();
    expect(await screen.findByRole("heading", { name: "Your basket is empty" })).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    expect(screen.getByRole("heading", { name: "Add products to your basket" })).toBeDefined();
    expect(document.querySelector(".basket-empty a[href='/catalogue']")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Compare your basket" })).toBeDefined();
    expect(document.querySelector("#compare-basket")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    expect(screen.getByRole("heading", { name: "Add products to your basket" })).toBeDefined();
  });

  it("explains populated basket items and the comparison button", async () => {
    openBasket(basketRequestExample.lines);
    expect(await screen.findByRole("heading", { name: "Review your basket" })).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    expect(screen.getByRole("heading", { name: "Review your basket items" })).toBeDefined();
    expect(document.querySelector(".basket-card .basket-row")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Compare your basket" })).toBeDefined();
    expect(document.querySelector("#compare-basket")).not.toBeNull();
  });
});
