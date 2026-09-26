// Regression tests for how each comparison outcome from the contract reaches the results page.
// They pin the headline and savings wording only; the full breakdown belongs to #16 and #17.
import { type BasketCompareResponse, routes } from "@cartoptix/contracts";
import {
  baselineOnlyExample,
  catalogueExample,
  missingBaselineExample,
  noPlanFoundExample,
  productsExample,
  provenInfeasibleExample,
  splitWinsExample,
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
  fireEvent.click(screen.getByRole("button", { name: /Split saves money/ }));
  fireEvent.click(screen.getByRole("button", { name: /Compare basket/ }));
  await screen.findByRole("heading", { name: "A transparent plan for this basket." });
}

describe("comparison outcomes on the results page", () => {
  it("shows the saving when a split beats the baseline", async () => {
    await compareWith(splitWinsExample);
    expect(screen.getByRole("heading", { name: "Split your basket" })).toBeDefined();
    expect(screen.getByText("Save S$2.00")).toBeDefined();
  });

  it("marks savings unavailable when there is no single-retailer baseline", async () => {
    await compareWith(missingBaselineExample);
    expect(screen.getByRole("heading", { name: "Split your basket" })).toBeDefined();
    expect(screen.getByText("Savings unavailable — no single-retailer baseline")).toBeDefined();
    expect(screen.queryByText(/^Save S\$/)).toBeNull();
  });

  it("keeps one retailer when no split plan exists", async () => {
    await compareWith(baselineOnlyExample);
    expect(screen.getByRole("heading", { name: "Keep it with one retailer" })).toBeDefined();
    expect(screen.getByText("No split plan to compare")).toBeDefined();
  });

  it("keeps one retailer when the split only ties", async () => {
    await compareWith(tieExample);
    expect(screen.getByRole("heading", { name: "Keep it with one retailer" })).toBeDefined();
    expect(screen.getByText("No lower split total")).toBeDefined();
  });

  it("does not claim impossibility when the search stopped at its limit", async () => {
    await compareWith(noPlanFoundExample);
    expect(screen.getByRole("heading", { name: "No valid plan found." })).toBeDefined();
    expect(
      screen.getByText(/search stopped at its limit, so a valid plan may still exist/),
    ).toBeDefined();
    expect(screen.queryByRole("heading", { name: "This basket cannot be completed." })).toBeNull();
  });

  it("names the blocking product when the basket is proven impossible", async () => {
    await compareWith(provenInfeasibleExample);
    expect(screen.getByRole("heading", { name: "This basket cannot be completed." })).toBeDefined();
    expect(
      await screen.findByText(/No retailer has an eligible offer for Fixture White Rice/),
    ).toBeDefined();
  });
});
