import { routes } from "@cartoptix/contracts";
import { catalogueExample, offersExample } from "@cartoptix/contracts/fixtures";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

afterEach(() => {
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});

function openProductGuide(offers: typeof offersExample.offers = offersExample.offers) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(routes.offers.url.replace(":id", offersExample.product.productId))) {
        const quantity = Number(new URL(url, window.location.origin).searchParams.get("quantity"));
        return Response.json({ ...offersExample, quantity, offers });
      }
      if (url.startsWith(routes.catalogue.url)) return Response.json(catalogueExample);
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  window.history.replaceState({}, "", `/product/${offersExample.product.productId}`);
  return render(
    <App queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />,
  );
}

function nextGuideStep() {
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
}

describe("product tutorial guide", () => {
  it("explains quantity, retailer offers, retailer links, adding packs, and viewing the basket", async () => {
    const { container } = openProductGuide();
    expect(await screen.findByRole("heading", { name: offersExample.product.name })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    expect(screen.getByRole("heading", { name: "Choose how many packs you need" })).toBeDefined();
    expect(container.querySelector("#product-quantity")).not.toBeNull();

    nextGuideStep();
    expect(screen.getByRole("heading", { name: "Compare the three retailers" })).toBeDefined();
    expect(container.querySelectorAll("#product-offers .offer-row")).toHaveLength(3);

    nextGuideStep();
    expect(screen.getByRole("heading", { name: "Open a retailer product page" })).toBeDefined();
    expect(
      container.querySelector(".offer-row:not(.offer-row--muted) a.icon-button"),
    ).not.toBeNull();

    nextGuideStep();
    expect(screen.getByRole("heading", { name: "Add these packs to your basket" })).toBeDefined();
    expect(container.querySelector("#add-to-basket")).not.toBeNull();

    nextGuideStep();
    expect(screen.getByRole("heading", { name: "View your basket" })).toBeDefined();
    expect(container.querySelector("#view-basket")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    expect(screen.getByRole("heading", { name: "Choose how many packs you need" })).toBeDefined();
  });

  it("omits the retailer-link step when the product has no eligible offers", async () => {
    const { container } = openProductGuide([]);
    expect(await screen.findByRole("heading", { name: offersExample.product.name })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    nextGuideStep();
    expect(screen.getByRole("heading", { name: "Compare the three retailers" })).toBeDefined();
    expect(screen.getByText(/None has an eligible offer/)).toBeDefined();

    nextGuideStep();
    expect(screen.getByRole("heading", { name: "Add these packs to your basket" })).toBeDefined();
    expect(container.querySelector(".offer-row a.icon-button")).toBeNull();
  });
});
