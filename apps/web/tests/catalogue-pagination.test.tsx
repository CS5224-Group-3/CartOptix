import { catalogueExample } from "@cartoptix/contracts/fixtures";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

afterEach(() => window.history.replaceState({}, "", "/"));

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const allProducts = Array.from({ length: 250 }, (_, index) => ({
  productId: `p${String(index + 1).padStart(3, "0")}`,
  categoryId: catalogueExample.categories[0]?.categoryId ?? "drinks",
  name: `Product ${index + 1}`,
  packSize: "1 kg",
  available: true,
  imageUrl: null,
}));
// These cases render a 100-card page; allow for contention when all jsdom suites run together.
const LARGE_CATALOGUE_RENDER_TIMEOUT_MS = 30_000;

function productsPage(url: string) {
  const params = new URL(url, "http://localhost").searchParams;
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 20);
  const start = (page - 1) * pageSize;
  return { products: allProducts.slice(start, start + pageSize), total: allProducts.length };
}

function openCatalogue() {
  const gate: { hold?: Promise<void>; release?: () => void } = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/catalogue")) return json(catalogueExample);
      if (gate.hold && url.includes("page=2")) await gate.hold;
      return json(productsPage(url));
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  window.history.replaceState({}, "", "/catalogue");
  render(<App queryClient={client} />);
  return gate;
}

const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("catalogue pagination", () => {
  it("reports the match count, not the number of cards on the page", async () => {
    openCatalogue();
    expect(await screen.findByText("Page 1 of 3")).toBeDefined();
    expect(screen.getByText("products found", { exact: false }).textContent).toContain("250");
    expect(screen.getByRole("link", { name: "View Product 1" })).toBeDefined();
    expect(screen.queryByRole("link", { name: "View Product 101" })).toBeNull();
  });

  it(
    "steps through pages with Next and Previous",
    async () => {
      openCatalogue();
      await screen.findByText("Page 1 of 3");
      expect(button("Previous").disabled).toBe(true);

      fireEvent.click(button("Next"));
      expect(await screen.findByRole("link", { name: "View Product 101" })).toBeDefined();
      expect(screen.getByText("Page 2 of 3")).toBeDefined();

      fireEvent.click(button("Previous"));
      expect(await screen.findByRole("link", { name: "View Product 1" })).toBeDefined();
      expect(screen.getByText("Page 1 of 3")).toBeDefined();
    },
    LARGE_CATALOGUE_RENDER_TIMEOUT_MS,
  );

  it(
    "jumps to the last page, which is the only way to reach its products",
    async () => {
      openCatalogue();
      await screen.findByText("Page 1 of 3");

      fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "3" } });
      fireEvent.click(button("Go"));

      expect(await screen.findByRole("link", { name: "View Product 201" })).toBeDefined();
      expect(screen.getByText("Page 3 of 3")).toBeDefined();
      expect(button("Next").disabled).toBe(true);
    },
    LARGE_CATALOGUE_RENDER_TIMEOUT_MS,
  );

  it(
    "holds the controls and marks the grid busy while the next page loads",
    async () => {
      const gate = openCatalogue();
      await screen.findByText("Page 1 of 3");
      gate.hold = new Promise<void>((resolve) => {
        gate.release = resolve;
      });

      fireEvent.click(button("Next"));

      await waitFor(() => expect(button("Next").disabled).toBe(true));
      expect(button("Previous").disabled).toBe(true);
      expect(button("Go").disabled).toBe(true);
      expect(document.querySelector(".product-grid")?.getAttribute("aria-busy")).toBe("true");
      // Inert also stops keyboard activation of the previous page's cards.
      expect(document.querySelector(".product-grid")?.hasAttribute("inert")).toBe(true);
      expect(screen.getByRole("link", { name: "View Product 1" })).toBeDefined();

      gate.release?.();
      expect(await screen.findByRole("link", { name: "View Product 101" })).toBeDefined();
      expect(document.querySelector(".product-grid")?.getAttribute("aria-busy")).toBe("false");
      expect(document.querySelector(".product-grid")?.hasAttribute("inert")).toBe(false);
      expect(button("Previous").disabled).toBe(false);
    },
    LARGE_CATALOGUE_RENDER_TIMEOUT_MS,
  );
});
