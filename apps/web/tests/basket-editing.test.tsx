import { routes, type Product } from "@cartoptix/contracts";
import {
  basketRequestExample,
  catalogueExample,
  offersExample,
  productsExample,
  recommendedExample,
} from "@cartoptix/contracts/fixtures";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { BASKET_STORAGE_KEY } from "../src/features/basket/storage";

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

function openApp(path = "/catalogue", productList: Product[] = productsExample.products) {
  const compareRequests: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === routes.catalogue.url) return json(catalogueExample);
    if (url.includes("/offers?")) {
      const productId = url.split("/").at(-2);
      const product = productList.find((item) => item.productId === productId);
      const quantity = Number(new URL(url, "http://localhost").searchParams.get("quantity"));
      return json({ ...offersExample, product, quantity, offers: [] });
    }
    if (url.startsWith(routes.products.url))
      return json({ products: productList, total: productList.length });
    if (url === routes.compare.url && init?.method === "POST") {
      compareRequests.push(String(init.body));
      return json(recommendedExample);
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", path);
  const view = render(
    <App
      queryClient={
        new QueryClient({
          defaultOptions: { queries: { retry: false, staleTime: Infinity } },
        })
      }
    />,
  );
  return { ...view, compareRequests, fetchMock };
}

async function addBothCatalogueProducts() {
  const addButtons = await screen.findAllByRole("button", { name: /^Add$/ });
  for (const button of addButtons) fireEvent.click(button);
  fireEvent.click(screen.getByRole("link", { name: /^Basket / }));
  await screen.findByRole("heading", { name: "Exact products you selected" });
}

beforeEach(() => window.sessionStorage.removeItem(BASKET_STORAGE_KEY));
afterEach(() => {
  window.sessionStorage.removeItem(BASKET_STORAGE_KEY);
  window.history.replaceState({}, "", "/");
});

describe("shopper basket editing", () => {
  it("shows a static basket backdrop through ten products and scrolls from eleven", async () => {
    const productList = Array.from({ length: 6 }, () => productsExample.products)
      .flat()
      .slice(0, 11)
      .map((product, index) => ({
        ...product,
        productId: `basket-product-${index}`,
        name: `Basket Product ${index}`,
        imageUrl: `/images/basket-product-${index}.webp`,
      }));
    const storeLines = (count: number) => {
      window.sessionStorage.setItem(
        BASKET_STORAGE_KEY,
        JSON.stringify(productList.slice(0, count).map(({ productId }) => ({ productId, quantity: 1 }))),
      );
    };

    const emptyBasket = openApp("/basket", productList);
    await screen.findByRole("heading", { name: "Your basket is empty" });
    const emptyTrack = emptyBasket.container.querySelector(".basket-product-hero__track");
    expect(emptyTrack?.classList.contains("basket-product-hero__track--static")).toBe(true);
    expect(emptyBasket.container.querySelectorAll(".basket-product-hero__brand-mark")).toHaveLength(12);
    expect(screen.queryByText(/distinct lines.*whole packs/)).toBeNull();
    emptyBasket.unmount();

    storeLines(10);
    const staticBasket = openApp("/basket", productList);
    await waitFor(() =>
      expect(
        staticBasket.container.querySelectorAll(".basket-product-hero__tile img"),
      ).toHaveLength(10),
    );
    const headingRow = staticBasket.container.querySelector(
      ".basket-product-hero__heading-row",
    );
    expect(headingRow?.querySelector("h1")?.textContent).toBe("Review your basket");
    expect(headingRow?.querySelector(".basket-header__meta")?.textContent).toBe(
      "10items10packs",
    );
    const staticTrack = staticBasket.container.querySelector(".basket-product-hero__track");
    expect(staticTrack?.classList.contains("basket-product-hero__track--static")).toBe(true);
    expect(staticBasket.container.querySelectorAll(".basket-product-hero__group")).toHaveLength(1);
    expect(staticBasket.container.querySelectorAll(".basket-product-hero__brand-mark")).toHaveLength(0);
    staticBasket.unmount();

    storeLines(11);
    const scrollingBasket = openApp("/basket", productList);
    await waitFor(() =>
      expect(
        scrollingBasket.container.querySelectorAll(".basket-product-hero__tile img"),
      ).toHaveLength(22),
    );
    const scrollingTrack = scrollingBasket.container.querySelector(".basket-product-hero__track");
    expect(scrollingTrack?.classList.contains("basket-product-hero__track--scrolling")).toBe(true);
    expect(scrollingBasket.container.querySelectorAll(".basket-product-hero__group")).toHaveLength(2);
    expect(scrollingBasket.container.querySelectorAll(".basket-product-hero__brand-mark")).toHaveLength(0);
    scrollingBasket.unmount();
  });

  it("opens product details from basket title and image without changing the basket", async () => {
    openApp();
    await addBothCatalogueProducts();

    // Both product links must point to the existing details route.
    const titleLink = screen.getByRole("link", {
      name: "Fixture Plain Drink",
    });
    const imageLink = screen.getByRole("link", {
      name: "View details for Fixture Plain Drink",
    });

    expect(titleLink.getAttribute("href")).toBe("/product/fixture-drink");
    expect(imageLink.getAttribute("href")).toBe("/product/fixture-drink");

    // Clicking the product title opens its details page.
    fireEvent.click(titleLink);
    await screen.findByRole("heading", { name: "Fixture Plain Drink" });
    expect(window.location.pathname).toBe("/product/fixture-drink");

    // Return to the basket.
    fireEvent.click(screen.getByRole("link", { name: /^Basket / }));
    await screen.findByRole("heading", {
      name: "Exact products you selected",
    });

    // Clicking the product image opens the same details page.
    fireEvent.click(
      screen.getByRole("link", {
        name: "View details for Fixture Plain Drink",
      }),
    );
    await screen.findByRole("heading", { name: "Fixture Plain Drink" });
    expect(window.location.pathname).toBe("/product/fixture-drink");

    // Verify the basket still contains the original products and quantities.
    expect(JSON.parse(window.sessionStorage.getItem(BASKET_STORAGE_KEY) ?? "null")).toEqual([
      { productId: "fixture-drink", quantity: 1 },
      { productId: "fixture-rice", quantity: 1 },
    ]);
  });
  it("adds products, changes a line quantity and removes only the selected product", async () => {
    openApp();
    await addBothCatalogueProducts();

    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(2);
    expect(
      (screen.getByRole("button", { name: "Decrease Fixture Plain Drink" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Increase Fixture Plain Drink" }));
    expect(
      screen
        .getByRole("button", { name: "Increase Fixture Plain Drink" })
        .parentElement?.querySelector("strong")?.textContent,
    ).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "Remove Fixture Plain Drink" }));

    expect(screen.queryByRole("button", { name: "Remove Fixture Plain Drink" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Fixture White Rice" })).toBeDefined();
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(1);
  });

  it("restores the exact basket and quantities after the app remounts in the same tab", async () => {
    const firstLoad = openApp();
    await addBothCatalogueProducts();
    fireEvent.click(screen.getByRole("button", { name: "Compare basket" }));
    await screen.findByRole("heading", { name: "Retailer basket comparison" });
    fireEvent.click(screen.getByRole("link", { name: "Edit basket" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase Fixture Plain Drink" }));
    await waitFor(() =>
      expect(JSON.parse(window.sessionStorage.getItem(BASKET_STORAGE_KEY) ?? "null")).toEqual([
        { productId: "fixture-drink", quantity: 2 },
        { productId: "fixture-rice", quantity: 1 },
      ]),
    );
    firstLoad.unmount();

    openApp("/basket");

    const drinkIncrease = await screen.findByRole("button", {
      name: "Increase Fixture Plain Drink",
    });
    expect(drinkIncrease.parentElement?.querySelector("strong")?.textContent).toBe("2");
    expect(
      screen
        .getByRole("button", { name: "Increase Fixture White Rice" })
        .parentElement?.querySelector("strong")?.textContent,
    ).toBe("1");
    expect(document.querySelectorAll(".basket-row")).toHaveLength(2);
    expect(JSON.parse(window.sessionStorage.getItem(BASKET_STORAGE_KEY) ?? "null")).toEqual([
      { productId: "fixture-drink", quantity: 2 },
      { productId: "fixture-rice", quantity: 1 },
    ]);
  });

  it("warns when session storage rejects a basket edit", async () => {
    const firstLoad = openApp();
    await addBothCatalogueProducts();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage quota exceeded");
    });

    fireEvent.click(screen.getByRole("button", { name: "Increase Fixture Plain Drink" }));

    expect(screen.getByText("Basket changes may not survive a reload.")).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "Increase Fixture Plain Drink" })
        .parentElement?.querySelector("strong")?.textContent,
    ).toBe("2");
    expect(JSON.parse(window.sessionStorage.getItem(BASKET_STORAGE_KEY) ?? "null")).toEqual([
      { productId: "fixture-drink", quantity: 1 },
      { productId: "fixture-rice", quantity: 1 },
    ]);
    firstLoad.unmount();

    openApp("/basket");

    const restoredDrink = await screen.findByRole("button", {
      name: "Increase Fixture Plain Drink",
    });
    expect(restoredDrink.parentElement?.querySelector("strong")?.textContent).toBe("1");
  });

  it("persists a removal and does not restore the removed line after remount", async () => {
    const firstLoad = openApp();
    await addBothCatalogueProducts();
    fireEvent.click(screen.getByRole("button", { name: "Remove Fixture Plain Drink" }));

    expect(JSON.parse(window.sessionStorage.getItem(BASKET_STORAGE_KEY) ?? "null")).toEqual([
      { productId: "fixture-rice", quantity: 1 },
    ]);
    firstLoad.unmount();

    openApp("/basket");

    expect(
      await screen.findByRole("button", { name: "Increase Fixture White Rice" }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Remove Fixture Plain Drink" })).toBeNull();
    expect(JSON.parse(window.sessionStorage.getItem(BASKET_STORAGE_KEY) ?? "null")).toEqual([
      { productId: "fixture-rice", quantity: 1 },
    ]);
  });

  it("does not restore synthetic demo products as a normal basket after reload", async () => {
    const firstLoad = openApp("/basket");
    fireEvent.click(screen.getByRole("button", { name: /Multiple complete retailers/ }));
    expect(window.sessionStorage.getItem(BASKET_STORAGE_KEY)).toBeNull();
    firstLoad.unmount();

    openApp("/basket");

    expect(await screen.findByText("Your basket is empty")).toBeDefined();
    expect(screen.queryByText("Product details unavailable")).toBeNull();
    expect(window.sessionStorage.getItem(BASKET_STORAGE_KEY)).toBeNull();
  });

  it("does not persist synthetic lines when a demo basket is edited", async () => {
    const firstLoad = openApp("/basket");
    fireEvent.click(screen.getByRole("button", { name: /Multiple complete retailers/ }));
    fireEvent.click(screen.getByRole("button", { name: "Increase Fixture White Rice" }));

    expect(window.sessionStorage.getItem(BASKET_STORAGE_KEY)).toBeNull();
    firstLoad.unmount();

    openApp("/basket");

    expect(await screen.findByText("Your basket is empty")).toBeDefined();
    expect(screen.queryByText("Product details unavailable")).toBeNull();
  });

  it("preserves the saved real basket while a demo scenario is loaded", async () => {
    const savedBasket = [{ productId: "fixture-drink", quantity: 2 }];
    window.sessionStorage.setItem(BASKET_STORAGE_KEY, JSON.stringify(savedBasket));
    const firstLoad = openApp("/basket");
    fireEvent.click(screen.getByRole("button", { name: /Multiple complete retailers/ }));
    fireEvent.click(screen.getByRole("button", { name: "Increase Fixture White Rice" }));

    expect(JSON.parse(window.sessionStorage.getItem(BASKET_STORAGE_KEY) ?? "null")).toEqual(
      savedBasket,
    );
    firstLoad.unmount();

    openApp("/basket");

    const increaseDrink = await screen.findByRole("button", {
      name: "Increase Fixture Plain Drink",
    });
    expect(increaseDrink.parentElement?.querySelector("strong")?.textContent).toBe("2");
    expect(screen.queryByText("Product details unavailable")).toBeNull();
  });

  it("keeps the saved basket when adding a catalogue product after loading a demo", async () => {
    const savedBasket = [{ productId: "fixture-drink", quantity: 2 }];
    window.sessionStorage.setItem(BASKET_STORAGE_KEY, JSON.stringify(savedBasket));
    openApp("/basket");
    fireEvent.click(screen.getByRole("button", { name: /Multiple complete retailers/ }));
    fireEvent.click(screen.getByRole("link", { name: "Add more" }));
    const addButtons = await screen.findAllByRole("button", { name: /^Add$/ });
    const riceAddButton = addButtons[1];
    if (!riceAddButton) throw new Error("Expected a second catalogue product");
    fireEvent.click(riceAddButton);
    fireEvent.click(screen.getByRole("link", { name: /^Basket / }));

    expect(
      await screen.findByRole("button", { name: "Increase Fixture Plain Drink" }),
    ).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "Increase Fixture Plain Drink" })
        .parentElement?.querySelector("strong")?.textContent,
    ).toBe("2");
    expect(screen.getByRole("button", { name: "Increase Fixture White Rice" })).toBeDefined();
    expect(JSON.parse(window.sessionStorage.getItem(BASKET_STORAGE_KEY) ?? "null")).toEqual([
      ...savedBasket,
      { productId: "fixture-rice", quantity: 1 },
    ]);
  });

  it("persists the saved basket plus a catalogue addition when it matches the demo lines", async () => {
    const savedBasket = [{ productId: "fixture-drink", quantity: 1 }];
    window.sessionStorage.setItem(BASKET_STORAGE_KEY, JSON.stringify(savedBasket));
    const firstLoad = openApp("/basket");
    fireEvent.click(screen.getByRole("button", { name: /Multiple complete retailers/ }));
    fireEvent.click(screen.getByRole("link", { name: "Add more" }));
    const addButtons = await screen.findAllByRole("button", { name: /^Add$/ });
    const riceAddButton = addButtons[1];
    if (!riceAddButton) throw new Error("Expected a second catalogue product");
    fireEvent.click(riceAddButton);
    fireEvent.click(screen.getByRole("link", { name: /^Basket / }));

    const expectedBasket = [...savedBasket, { productId: "fixture-rice", quantity: 1 }];
    expect(screen.getByText(/API comparison mode/)).toBeDefined();
    expect(JSON.parse(window.sessionStorage.getItem(BASKET_STORAGE_KEY) ?? "null")).toEqual(
      expectedBasket,
    );
    firstLoad.unmount();

    openApp("/basket");

    expect(
      await screen.findByRole("button", { name: "Increase Fixture Plain Drink" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Increase Fixture White Rice" })).toBeDefined();
    expect(JSON.parse(window.sessionStorage.getItem(BASKET_STORAGE_KEY) ?? "null")).toEqual(
      expectedBasket,
    );
  });

  it("marks results stale when a product is removed after comparison", async () => {
    const { compareRequests } = openApp();
    await addBothCatalogueProducts();
    fireEvent.click(screen.getByRole("button", { name: "Compare basket" }));
    await screen.findByRole("heading", { name: "Retailer basket comparison" });
    fireEvent.click(screen.getByRole("link", { name: "Edit basket" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Fixture Plain Drink" }));

    expect(compareRequests).toHaveLength(1);
    expect(screen.getByText("Your basket changed.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Remove Fixture Plain Drink" })).toBeNull();
  });

  it("marks results stale when a product is added after comparison", async () => {
    const productTemplate = productsExample.products[1];
    if (!productTemplate) throw new Error("Expected a product to use as a catalogue fixture");
    openApp("/catalogue", [
      ...productsExample.products,
      { ...productTemplate, productId: "fixture-oats", name: "Fixture Oats" },
    ]);
    const addButtons = await screen.findAllByRole("button", { name: /^Add$/ });
    const firstAdd = addButtons[0];
    const secondAdd = addButtons[1];
    if (!firstAdd || !secondAdd)
      throw new Error("Expected two products for the initial comparison");
    fireEvent.click(firstAdd);
    fireEvent.click(secondAdd);
    fireEvent.click(screen.getByRole("link", { name: /^Basket / }));
    fireEvent.click(screen.getByRole("button", { name: "Compare basket" }));
    await screen.findByRole("heading", { name: "Retailer basket comparison" });
    fireEvent.click(screen.getByRole("link", { name: "Edit basket" }));
    fireEvent.click(screen.getByRole("link", { name: "Add more" }));
    const catalogueAdds = await screen.findAllByRole("button", { name: /^Add$/ });
    const thirdAdd = catalogueAdds[2];
    if (!thirdAdd) throw new Error("Expected the additional catalogue product");
    fireEvent.click(thirdAdd);
    fireEvent.click(screen.getByRole("link", { name: /^Basket / }));

    expect(screen.getByText("Your basket changed.")).toBeDefined();
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(3);
  });

  it("does not mark the comparison stale when the same demo scenario is loaded again", async () => {
    openApp("/basket");
    const scenario = screen.getByRole("button", { name: /Multiple complete retailers/ });
    fireEvent.click(scenario);
    fireEvent.click(screen.getByRole("button", { name: "Compare basket" }));
    await screen.findByRole("heading", { name: "Retailer basket comparison" });
    fireEvent.click(screen.getByRole("link", { name: "Edit basket" }));
    fireEvent.click(screen.getByRole("button", { name: /Multiple complete retailers/ }));

    expect(screen.queryByText("Your basket changed.")).toBeNull();
  });

  it("marks a previous comparison stale when a normal basket line changes", async () => {
    const { compareRequests } = openApp();
    await addBothCatalogueProducts();
    fireEvent.click(screen.getByRole("button", { name: "Compare basket" }));
    await screen.findByRole("heading", { name: "Retailer basket comparison" });

    expect(compareRequests[0]).toBe(JSON.stringify(basketRequestExample));
    fireEvent.click(screen.getByRole("link", { name: "Edit basket" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase Fixture White Rice" }));

    expect(screen.getByText("Your basket changed.")).toBeDefined();
    fireEvent.click(screen.getByRole("link", { name: "View previous" }));
    expect(screen.getByRole("status").textContent).toContain("earlier basket state");
    expect(screen.queryByText(/^Recommended/)).toBeNull();
  });

  it("explains how to recover when adding a product would exceed 50 lines", async () => {
    window.sessionStorage.setItem(
      BASKET_STORAGE_KEY,
      JSON.stringify(
        Array.from({ length: 50 }, (_, index) => ({
          productId: `saved-product-${index}`,
          quantity: 1,
        })),
      ),
    );
    openApp();
    const addButtons = await screen.findAllByRole("button", { name: /^Add$/ });
    const firstAddButton = addButtons[0];
    if (!firstAddButton) throw new Error("Expected at least one catalogue product");
    fireEvent.click(firstAddButton);

    expect(
      await screen.findByText(/Remove a product from your basket before adding another/),
    ).toBeDefined();
    expect(JSON.parse(window.sessionStorage.getItem(BASKET_STORAGE_KEY) ?? "[]")).toHaveLength(50);
  });

  it("allows the 50th distinct product line", async () => {
    window.sessionStorage.setItem(
      BASKET_STORAGE_KEY,
      JSON.stringify(
        Array.from({ length: 49 }, (_, index) => ({
          productId: `saved-product-${index}`,
          quantity: 1,
        })),
      ),
    );
    openApp();
    const addButtons = await screen.findAllByRole("button", { name: /^Add$/ });
    const firstAddButton = addButtons[0];
    if (!firstAddButton) throw new Error("Expected at least one catalogue product");
    fireEvent.click(firstAddButton);
    fireEvent.click(screen.getByRole("link", { name: /^Basket / }));

    expect(await screen.findAllByRole("button", { name: /^Remove / })).toHaveLength(50);
    expect(JSON.parse(window.sessionStorage.getItem(BASKET_STORAGE_KEY) ?? "[]")).toHaveLength(50);
  });

  it("explains how to recover when adding packs would exceed 20 for one product", async () => {
    window.sessionStorage.setItem(
      BASKET_STORAGE_KEY,
      JSON.stringify([{ productId: "fixture-drink", quantity: 20 }]),
    );
    openApp();
    const addButtons = await screen.findAllByRole("button", { name: /^Add$/ });
    const firstAddButton = addButtons[0];
    if (!firstAddButton) throw new Error("Expected at least one catalogue product");
    fireEvent.click(firstAddButton);
    fireEvent.click(screen.getByRole("link", { name: /^Basket / }));

    expect(await screen.findByText(/This would exceed 20 packs for this product/)).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "Increase Fixture Plain Drink" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Increase Fixture Plain Drink" })
        .parentElement?.querySelector("strong")?.textContent,
    ).toBe("20");
  });

  it("does not allow the quantity control to go below one pack", async () => {
    window.sessionStorage.setItem(
      BASKET_STORAGE_KEY,
      JSON.stringify([{ productId: "fixture-drink", quantity: 1 }]),
    );
    openApp("/basket");

    const decrease = await screen.findByRole("button", {
      name: "Decrease Fixture Plain Drink",
    });
    expect((decrease as HTMLButtonElement).disabled).toBe(true);
    expect(decrease.parentElement?.querySelector("strong")?.textContent).toBe("1");
  });

  it("allows increasing from 19 to 20 packs and disables further increases", async () => {
    window.sessionStorage.setItem(
      BASKET_STORAGE_KEY,
      JSON.stringify([{ productId: "fixture-drink", quantity: 19 }]),
    );
    openApp("/basket");

    const increase = await screen.findByRole("button", {
      name: "Increase Fixture Plain Drink",
    });
    fireEvent.click(increase);

    expect((increase as HTMLButtonElement).disabled).toBe(true);
    expect(increase.parentElement?.querySelector("strong")?.textContent).toBe("20");
    expect(JSON.parse(window.sessionStorage.getItem(BASKET_STORAGE_KEY) ?? "[]")).toEqual([
      { productId: "fixture-drink", quantity: 20 },
    ]);
  });
});
