import { routes } from "@cartoptix/contracts";
import { catalogueExample, productsExample } from "@cartoptix/contracts/fixtures";
import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { createFixtureSource } from "../src/features/basket-comparison/fixtureSource";
import { ComparisonFailure, type ComparisonSource } from "../src/features/basket-comparison/model";

afterEach(() => window.history.replaceState({}, "", "/"));

function controlledSource() {
  const releases: (() => void)[] = [];
  const source = vi.fn(
    createFixtureSource({ wait: () => new Promise<void>((resolve) => releases.push(resolve)) }),
  );
  return {
    source,
    async finish() {
      await waitFor(() => expect(releases.length).toBeGreaterThan(0));
      await act(async () => {
        releases.shift()?.();
      });
    },
  };
}

function openApp(source: ComparisonSource, path = "/basket") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith(routes.catalogue.url))
        return new Response(JSON.stringify(catalogueExample));
      if (url.startsWith(routes.products.url)) return new Response(JSON.stringify(productsExample));
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  window.history.pushState({}, "", path);
  render(
    <App
      comparisonSource={source}
      queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    />,
  );
}

function loadScenario(name: RegExp = /Multiple complete retailers/) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function compare() {
  fireEvent.click(screen.getByRole("button", { name: "Compare basket" }));
}
function edit() {
  fireEvent.click(screen.getByRole("link", { name: "Edit basket" }));
}
function increaseRice() {
  fireEvent.click(screen.getByRole("button", { name: "Increase Fixture White Rice" }));
}
function riceQuantity() {
  return screen
    .getByRole("button", { name: "Increase Fixture White Rice" })
    .parentElement?.querySelector("strong")?.textContent;
}
function expectReferenceOnly() {
  expect(screen.queryByText(/^Recommended/)).toBeNull();
  expect(screen.queryByRole("link", { name: /^Visit / })).toBeNull();
  expect(screen.queryByRole("link", { name: /^View Fixture / })).toBeNull();
  expect(screen.getAllByRole("article")).toHaveLength(3);
  expect(screen.getAllByText(/1 kg.*Quantity: 1 pack/)).toHaveLength(2);
}

describe("comparison lifecycle", () => {
  it("shows pending progress, blocks duplicate submissions and navigates on success", async () => {
    const control = controlledSource();
    openApp(control.source);
    loadScenario();
    compare();
    expect(screen.getByRole("status").textContent).toContain("Comparing submitted basket");
    const pending = screen.getByRole("button", { name: "Comparing..." }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    fireEvent.click(pending);
    await waitFor(() => expect(control.source).toHaveBeenCalledTimes(1));
    expect(window.location.pathname).toBe("/basket");
    await control.finish();
    expect(window.location.pathname).toBe("/results");
    expect(screen.getByRole("heading", { name: "Retailer basket comparison" })).toBeDefined();
    expect(screen.getByText(/^Recommended/)).toBeDefined();
    expect(screen.queryByText(/earlier basket state/)).toBeNull();
  });

  it("stores a late success without redirecting a shopper who left the comparison flow", async () => {
    const control = controlledSource();
    openApp(control.source);
    loadScenario();
    compare();
    fireEvent.click(screen.getByRole("link", { name: "Browse products" }));
    expect(window.location.pathname).toBe("/catalogue");
    await control.finish();
    expect(window.location.pathname).toBe("/catalogue");
    expect(screen.queryByRole("heading", { name: "Retailer basket comparison" })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: /^Basket/ }));
    fireEvent.click(screen.getByRole("link", { name: "View current results" }));
    expect(window.location.pathname).toBe("/results");
    expect(screen.getByText(/^Recommended/)).toBeDefined();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(control.source).toHaveBeenCalledTimes(1);
  });

  it("does not restore automatic navigation merely because the shopper returns before completion", async () => {
    const control = controlledSource();
    openApp(control.source);
    loadScenario();
    compare();
    fireEvent.click(screen.getByRole("link", { name: "Browse products" }));
    fireEvent.click(screen.getByRole("link", { name: /^Basket/ }));
    await control.finish();
    expect(window.location.pathname).toBe("/basket");
    expect(screen.getByRole("link", { name: "View current results" })).toBeDefined();
    // A fresh submission receives its own navigation permission.
    compare();
    await control.finish();
    expect(window.location.pathname).toBe("/results");
    expect(screen.getByText(/^Recommended/)).toBeDefined();
  });

  it("also preserves a successful retry without redirecting after navigation away", async () => {
    const control = controlledSource();
    openApp(control.source);
    loadScenario(/Temporary failure, then success/);
    compare();
    await control.finish();
    fireEvent.click(screen.getByRole("button", { name: "Retry comparison" }));
    fireEvent.click(screen.getByRole("link", { name: "Browse products" }));
    await control.finish();
    expect(window.location.pathname).toBe("/catalogue");
    fireEvent.click(screen.getByRole("link", { name: /^Basket/ }));
    fireEvent.click(screen.getByRole("link", { name: "View current results" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/^Recommended/)).toBeDefined();
    expect(control.source).toHaveBeenCalledTimes(2);
  });

  it("keeps a retryable service failure visible across navigation", async () => {
    const control = controlledSource();
    openApp(control.source);
    loadScenario(/Repeated service failure/);
    compare();
    await control.finish();
    expect(screen.getByRole("alert").textContent).toContain("This is a service failure");
    expect(screen.getByRole("button", { name: "Retry comparison" })).toBeDefined();
    expect(riceQuantity()).toBe("1");
    act(() => {
      window.history.pushState({}, "", "/results");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("heading", { name: "Comparison unsuccessful" })).toBeDefined();
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.queryByText("No feasible purchasing plan available")).toBeNull();
    expect(screen.queryByText(/^Recommended/)).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Back to basket editing" }));
    expect(screen.getByRole("alert")).toBeDefined();
    expect(riceQuantity()).toBe("1");
  });

  it("retries the submitted snapshot once, blocks duplicate retries and succeeds", async () => {
    const control = controlledSource();
    openApp(control.source);
    loadScenario(/Temporary failure, then success/);
    compare();
    await control.finish();
    fireEvent.click(screen.getByRole("button", { name: "Retry comparison" }));
    const pending = screen.getByRole("button", { name: "Retrying..." }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    fireEvent.click(pending);
    await waitFor(() => expect(control.source).toHaveBeenCalledTimes(2));
    expect(control.source.mock.calls[1]?.[0]).toEqual(control.source.mock.calls[0]?.[0]);
    await control.finish();
    expect(window.location.pathname).toBe("/results");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/^Recommended/)).toBeDefined();
    edit();
    expect(riceQuantity()).toBe("1");
  });

  it("keeps an unsuccessful retry as a persistent error", async () => {
    const control = controlledSource();
    openApp(control.source);
    loadScenario(/Repeated service failure/);
    compare();
    await control.finish();
    fireEvent.click(screen.getByRole("button", { name: "Retry comparison" }));
    await control.finish();
    expect(control.source).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByRole("button", { name: "Retry comparison" })).toBeDefined();
    expect(screen.queryByText(/^Recommended/)).toBeNull();
    expect(riceQuantity()).toBe("1");
  });

  it("shows no retry action for a non-retryable failure", async () => {
    const control = controlledSource();
    openApp(control.source);
    loadScenario(/Non-retryable service failure/);
    compare();
    await control.finish();
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to basket editing" })).toBeDefined();
    expect(riceQuantity()).toBe("1");
  });

  it.each([
    [/Only one complete retailer/, "Unavailable"],
    [/No feasible purchasing plan/, "No feasible purchasing plan available"],
  ])("keeps %s as a business outcome", async (label, outcome) => {
    const control = controlledSource();
    openApp(control.source);
    loadScenario(label);
    compare();
    await control.finish();
    expect(screen.getAllByText(outcome)[0]).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("retains a successful breakdown after editing but removes current purchase and recommendation actions", async () => {
    const control = controlledSource();
    openApp(control.source);
    loadScenario();
    compare();
    await control.finish();
    edit();
    increaseRice();
    fireEvent.click(screen.getByRole("link", { name: "View previous" }));
    expect(screen.getByRole("status").textContent).toContain("earlier basket state");
    expectReferenceOnly();
    edit();
    expect(riceQuantity()).toBe("2");
  });

  it("treats the eventual response as stale when the basket is edited while pending", async () => {
    const control = controlledSource();
    openApp(control.source);
    loadScenario();
    compare();
    increaseRice();
    expect(riceQuantity()).toBe("2");
    await control.finish();
    expect(window.location.pathname).toBe("/results");
    expect(screen.getByRole("status").textContent).toContain("earlier basket state");
    expectReferenceOnly();
    expect(control.source.mock.calls[0]?.[0].basket.products[0]?.quantity).toBe(1);
    edit();
    expect(riceQuantity()).toBe("2");
  });

  it("a retry after edits neither overwrites the basket nor makes its old snapshot current", async () => {
    const control = controlledSource();
    openApp(control.source);
    loadScenario(/Temporary failure, then success/);
    compare();
    await control.finish();
    increaseRice();
    expect(screen.getByRole("alert").textContent).toContain(
      "Retry uses the previously submitted basket",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry comparison" }));
    await control.finish();
    expectReferenceOnly();
    expect(screen.getByRole("status").textContent).toContain("earlier basket state");
    expect(control.source.mock.calls[1]?.[0]).toEqual(control.source.mock.calls[0]?.[0]);
    edit();
    expect(riceQuantity()).toBe("2");
  });

  it("failed retry cannot turn the retained stale success into a current recommendation", async () => {
    const control = controlledSource();
    openApp(control.source);
    loadScenario();
    compare();
    await control.finish();
    edit();
    loadScenario(/Repeated service failure/);
    compare();
    await control.finish();
    fireEvent.click(screen.getByRole("link", { name: "View previous results" }));
    expectReferenceOnly();
    fireEvent.click(screen.getByRole("button", { name: "Retry comparison" }));
    expectReferenceOnly();
    await control.finish();
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByRole("status").textContent).toContain("earlier basket state");
    expectReferenceOnly();
    edit();
    expect(riceQuantity()).toBe("1");
  });

  it("a service failure for an unchanged basket does not endorse an earlier success", async () => {
    const control = controlledSource();
    const source = vi
      .fn<ComparisonSource>()
      .mockImplementationOnce(control.source)
      .mockRejectedValue(new ComparisonFailure("Synthetic service failure", true));
    openApp(source);
    loadScenario();
    compare();
    await control.finish();
    edit();
    compare();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("link", { name: "View previous results" }));
    expect(screen.queryByText(/earlier basket state/)).toBeNull();
    expect(screen.getByText(/Previous successful comparison, for reference only/)).toBeDefined();
    expectReferenceOnly();
  });

  it("changing scenarios while pending cannot start an overlapping request", async () => {
    const control = controlledSource();
    openApp(control.source);
    loadScenario();
    compare();
    loadScenario(/Only one complete retailer/);
    fireEvent.click(screen.getByRole("button", { name: "Comparing..." }));
    await control.finish();
    expect(control.source).toHaveBeenCalledTimes(1);
    expectReferenceOnly();
    expect(screen.getAllByText("Unavailable")).toHaveLength(1);
    edit();
    compare();
    await control.finish();
    expect(control.source).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(screen.queryByText(/earlier basket state/)).toBeNull();
    expect(screen.getByText(/^Recommended/)).toBeDefined();
  });

  it("direct results navigation without a request still shows no comparison yet", () => {
    const source = vi.fn<ComparisonSource>();
    openApp(source, "/results");
    expect(screen.getByRole("heading", { name: "No comparison yet" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Go to basket" })).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(source).not.toHaveBeenCalled();
  });
});
