import { SNAPSHOT_DISCLAIMER } from "@cartoptix/contracts";
import { catalogueExample, offersExample, productsExample } from "@cartoptix/contracts/fixtures";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.tsx";

afterEach(() => window.history.replaceState({}, "", "/"));

/** The fixture offers repriced for `quantity`: whole deals, remaining packs, added charges. */
function offerResponse(quantity: number) {
  return {
    product: offersExample.product,
    quantity,
    offers: offersExample.offers.map((offer) => {
      const itemCharges = offer.itemCharges.map((charge) => ({
        ...charge,
        amountCents: (charge.amountCents / offersExample.quantity) * quantity,
      }));
      const deal = offer.multibuy;
      const deals = deal ? Math.floor(quantity / deal.packsPerDeal) : 0;
      const dealPacks = deals * (deal?.packsPerDeal ?? 0);
      return {
        ...offer,
        itemCharges,
        multibuy: deal && {
          ...deal,
          timesApplied: deals,
          savingCents: deals * (deal.packsPerDeal * offer.unitPriceCents - deal.dealPriceCents),
        },
        lineTotalCents:
          deals * (deal?.dealPriceCents ?? 0) +
          (quantity - dealPacks) * offer.unitPriceCents +
          itemCharges
            .filter((charge) => !charge.includedInPrice)
            .reduce((total, charge) => total + charge.amountCents, 0),
      };
    }),
  };
}

describe("product offer view", () => {
  it("fetches changed quantities and explains the offer costs and exclusions", async () => {
    const requestedQuantities: number[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/offers?")) {
        const quantity = Number(new URL(url, window.location.origin).searchParams.get("quantity"));
        requestedQuantities.push(quantity);
        return Response.json(offerResponse(quantity));
      }
      if (url === "/api/v1/catalogue") return Response.json(catalogueExample);
      if (url.startsWith("/api/v1/products")) return Response.json(productsExample);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    window.history.replaceState({}, "", `/product/${offersExample.product.productId}`);
    render(<App queryClient={queryClient} />);

    expect(await screen.findAllByText("for 1 pack")).toHaveLength(2);
    expect(requestedQuantities).toContain(1);
    expect(screen.getByText(/For 1 pack; before delivery and order charges/)).toBeDefined();
    expect(screen.getByText("Spend $30 + Free Gift — not included in this estimate")).toBeDefined();
    expect(screen.getByText("Buy 2 for S$7.00")).toBeDefined();
    expect(screen.getByText("Mixing items in this deal may save more")).toBeDefined();
    expect(screen.getByText("S$7.20").closest("s")).not.toBeNull();
    expect(screen.getByText(/S\$6.00 per pack · Sale price/)).toBeDefined();
    expect(screen.getByText(SNAPSHOT_DISCLAIMER, { exact: false })).toBeDefined();
    expect(
      screen.getByRole("link", { name: "View FairPrice product page" }).getAttribute("href"),
    ).toBe("https://example.com/fixture-rice-fairprice");

    fireEvent.click(screen.getByRole("button", { name: "Increase quantity" }));

    expect(await screen.findAllByText("for 2 packs")).toHaveLength(2);
    await waitFor(() => expect(requestedQuantities).toContain(2));
    expect(screen.getByText(/For 2 packs; before delivery and order charges/)).toBeDefined();
    expect(screen.getByText("S$12.30")).toBeDefined();
    expect(screen.getByText("S$7.00")).toBeDefined();
    expect(screen.getByText("1 × deal (2 for S$7.00) · You save S$1.20")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity" }));
    expect(
      await screen.findByText("1 × deal (2 for S$7.00) + 1 × S$4.10 · You save S$1.20"),
    ).toBeDefined();

    const increase = screen.getByRole("button", { name: "Increase quantity" });
    for (let quantity = 4; quantity <= 20; quantity += 1) fireEvent.click(increase);
    expect(screen.getByText("20")).toBeDefined();
    expect(increase).toHaveProperty("disabled", true);
    expect(requestedQuantities).toContain(20);

    const decrease = screen.getByRole("button", { name: "Decrease quantity" });
    for (let quantity = 19; quantity >= 1; quantity -= 1) fireEvent.click(decrease);
    expect(screen.getByText("1")).toBeDefined();
    expect(decrease).toHaveProperty("disabled", true);
  });
});
