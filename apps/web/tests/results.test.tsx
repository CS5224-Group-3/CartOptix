// Regression tests for how each comparison outcome from the contract reaches the results page.
// They pin the headline and reason wording only; the full breakdown belongs to #16.
import { type BasketCompareResponse, routes } from "@cartoptix/contracts";
import {
  catalogueExample,
  noFeasiblePlanExample,
  oneRetailerCompleteExample,
  productsExample,
  recommendedExample,
  tieExample,
} from "@cartoptix/contracts/fixtures";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "../src/App.tsx";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

/** Answers each API route with a fixture, and the comparison with `comparison`. */
function stubApi(comparison: BasketCompareResponse) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(routes.catalogue.url)) return json(catalogueExample);
      if (url.startsWith(routes.compare.url)) return json(comparison);
      if (url.startsWith(routes.products.url)) return json(productsExample);
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
}

/** Loads a demo basket, runs the comparison and waits for the results page. */
async function compareWith(comparison: BasketCompareResponse) {
  stubApi(comparison);
  window.history.pushState({}, "", "/basket");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<App queryClient={queryClient} />);
  fireEvent.click(screen.getByRole("button", { name: /Mixed pantry basket/ }));
  fireEvent.click(screen.getByRole("button", { name: /Compare basket/ }));
  await screen.findByRole("heading", { name: "A transparent plan for this basket." });
}

describe("comparison outcomes on the results page", () => {
  it("recommends the cheapest complete retailer", async () => {
    await compareWith(recommendedExample);
    expect(screen.getByRole("heading", { name: "Buy it all at FairPrice" })).toBeDefined();
    expect(screen.getByText(/Delivery charges could not be verified/)).toBeDefined();
  });

  it("shows a waived order charge without adding it", async () => {
    await compareWith(recommendedExample);
    expect(
      screen.getByText(/Synthetic service fee S\$3.99 waived on orders from S\$6.00/),
    ).toBeDefined();
    expect(screen.getAllByText("S$6.50").length).toBeGreaterThan(0);
  });

  it("names the missing product for an unavailable retailer", async () => {
    await compareWith(oneRetailerCompleteExample);
    expect(screen.getByRole("heading", { name: "Buy it all at RedMart" })).toBeDefined();
    expect(await screen.findByText(/No eligible offer for Fixture Plain Drink/)).toBeDefined();
  });

  it("breaks a tie in the order the API returns", async () => {
    await compareWith(tieExample);
    expect(screen.getByRole("heading", { name: "Buy it all at FairPrice" })).toBeDefined();
  });

  it("says no feasible plan exists and gives each retailer's reason", async () => {
    await compareWith(noFeasiblePlanExample);
    expect(
      screen.getByRole("heading", { name: "No feasible purchasing plan available" }),
    ).toBeDefined();
    expect(screen.getByText(/below the S\$15.00 minimum/)).toBeDefined();
    expect(await screen.findByText(/No eligible offer for Fixture White Rice/)).toBeDefined();
    expect(screen.getByText(/Delivery charges could not be verified/)).toBeDefined();
    expect(screen.queryByRole("heading", { name: /Buy it all at/ })).toBeNull();
  });
});
