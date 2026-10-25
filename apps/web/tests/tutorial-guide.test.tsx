import { catalogueExample } from "@cartoptix/contracts/fixtures";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

afterEach(() => window.history.replaceState({}, "", "/"));

function openCatalogue() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/catalogue"))
        return new Response(JSON.stringify(catalogueExample), { status: 200 });
      return new Response(
        JSON.stringify({
          products: [
            {
              productId: "milk",
              categoryId: catalogueExample.categories[0]?.categoryId ?? "drinks",
              name: "Milk",
              packSize: "1 L",
              available: true,
              imageUrl: null,
            },
          ],
          total: 1,
        }),
        { status: 200 },
      );
    }),
  );
  window.history.replaceState({}, "", "/catalogue");
  render(
    <App
      queryClient={
        new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
      }
    />,
  );
}

describe("catalogue tutorial guide", () => {
  it("starts on first visit and can be skipped", async () => {
    window.localStorage.removeItem("cartoptix:tutorial:completed:v1");
    openCatalogue();
    expect(await screen.findByRole("dialog")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Welcome to CartOptix" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Skip guide" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.localStorage.getItem("cartoptix:tutorial:completed:v1")).toBe("true");
  });

  it("explains search, products and filters, and can be replayed", async () => {
    window.localStorage.setItem("cartoptix:tutorial:completed:v1", "true");
    openCatalogue();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    expect(screen.getByRole("heading", { name: "Welcome to CartOptix" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Search the catalogue" })).toBeDefined();
    expect(document.querySelector(".tutorial-spotlight")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Explore products" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Narrow your search" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Replay this guide any time" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
