import { routes } from "@cartoptix/contracts";
import {
  catalogueExample,
  productsExample,
  recommendedExample,
} from "@cartoptix/contracts/fixtures";
import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { BasketLine } from "../src/features/basket/model";
import { BASKET_STORAGE_KEY } from "../src/features/basket/storage";
import type { BasketComparisonPresentation } from "../src/features/basket-comparison/model";
import {
  COMPARISON_STORAGE_KEY,
  persistComparison,
  restoreComparison,
} from "../src/features/basket-comparison/persistedComparison";
import { comparisonFixtures } from "./support/fixtures";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

function fixture(name: string): BasketComparisonPresentation {
  const result = comparisonFixtures[name];
  if (!result) throw new Error(`Missing fixture ${name}`);
  return result;
}

// The persisted request and result must describe one submission; use the
// fixture's own basket so the roundtrip is internally consistent.
const fixtureResult = fixture("complete");
const persistedBasket: BasketLine[] = fixtureResult.submittedBasket.products.map(
  ({ productId, quantity }) => ({ productId, quantity }),
);
const persistedSubmission = {
  basket: {
    revision: 3,
    products: fixtureResult.submittedBasket.products,
  },
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("persisted comparison snapshots", () => {
  it("restores the tab's last successful comparison", () => {
    persistComparison(persistedSubmission, fixture("complete"));
    const restored = restoreComparison(persistedBasket);
    expect(restored).not.toBeNull();
    expect(restored?.result).toEqual(fixture("complete"));
    expect(restored?.submitted).toEqual(persistedSubmission);
    // The basket is unchanged since the submission, so the restored revision is current.
    expect(restored?.revisionSeed).toBe(3);
  });

  it("seeds a stale revision when the basket changed after the submission", () => {
    persistComparison(persistedSubmission, fixture("complete"));
    const restored = restoreComparison([{ productId: "fixture-drink", quantity: 1 }]);
    // The result is still returned, for the "previous results" reference rendering.
    expect(restored?.result).toEqual(fixture("complete"));
    expect(restored?.revisionSeed).not.toBe(3);
  });

  it("rejects malformed snapshots without restoring anything", () => {
    expect(restoreComparison(persistedBasket)).toBeNull();
    const persisted = (result: unknown) =>
      JSON.stringify({ version: 1, submitted: persistedSubmission, result });
    const persistedWith = (mutate: (result: Record<string, unknown>) => void) => {
      const result = JSON.parse(JSON.stringify(fixture("complete"))) as Record<string, unknown>;
      mutate(result);
      return JSON.stringify({ version: 1, submitted: persistedSubmission, result });
    };
    const firstLinePricing = (result: Record<string, unknown>) => {
      const option = (result.options as Record<string, unknown>[])[0] as Record<string, unknown>;
      const line = (option.lines as Record<string, unknown>[])[0] as Record<string, unknown>;
      return line.pricing as Record<string, unknown>;
    };
    for (const broken of [
      "not json at all",
      "null",
      JSON.stringify({ version: 2 }),
      JSON.stringify({ version: 1, submitted: persistedSubmission }),
      persisted({ submittedBasket: persistedSubmission.basket, options: "all three" }),
      // An option entry the option card could not render.
      persistedWith((result) => {
        result.options = [{ kind: "partial" }];
      }),
      // A pricing field the breakdown arithmetic cannot use.
      persistedWith((result) => {
        firstLinePricing(result).unitPriceCents = "9";
      }),
      // A fixture label must remain a string for the results page to render it.
      persistedWith((result) => {
        result.fixtureLabel = { unexpected: "object" };
      }),
      // A submitted quantity no basket could hold.
      JSON.stringify({
        version: 1,
        submitted: {
          basket: { revision: 3, products: [{ productId: "fixture-drink", quantity: 99 }] },
        },
        result: fixture("complete"),
      }),
      // Request and result must describe one submission.
      JSON.stringify({
        version: 1,
        submitted: {
          basket: { revision: 3, products: [{ productId: "fixture-drink", quantity: 7 }] },
        },
        result: fixture("complete"),
      }),
    ]) {
      window.sessionStorage.setItem(COMPARISON_STORAGE_KEY, broken);
      expect(restoreComparison(persistedBasket)).toBeNull();
    }
  });
});

/** Stubs the endpoints a shopper flow touches and tracks compare requests. */
function stubComparisonApi() {
  const compare = vi.fn(async () => json(recommendedExample));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === routes.compare.url) return compare();
      if (url === routes.catalogue.url) return json(catalogueExample);
      if (url.startsWith(routes.products.url)) return json(productsExample);
      if (url.includes("/offers?")) {
        const product = productsExample.products.find((candidate) =>
          url.includes(`/${candidate.productId}/`),
        );
        if (product) return json({ product, quantity: 1, offers: [] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }),
  );
  return { compare };
}

/** Renders a fresh page: a new client, like a browser reload, at the given path. */
function mount(path: string) {
  window.history.replaceState({}, "", path);
  return render(
    <App
      queryClient={
        new QueryClient({
          defaultOptions: { queries: { retry: false, staleTime: Infinity } },
        })
      }
    />,
  );
}

async function compareBasket() {
  const view = mount("/catalogue");
  for (const button of await screen.findAllByRole("button", { name: "Add" }))
    fireEvent.click(button);
  fireEvent.click(screen.getByRole("link", { name: /^Basket / }));
  await screen.findByRole("button", { name: "Compare basket" });
  fireEvent.click(screen.getByRole("button", { name: "Compare basket" }));
  await screen.findByRole("heading", { name: "Retailer basket comparison" });
  return view;
}

describe("comparison restored across a results-page reload", () => {
  it("shows the completed comparison again after a reload, without re-requesting it", async () => {
    const { compare } = stubComparisonApi();
    const first = await compareBasket();
    expect(screen.getAllByText(/^Recommended/)).toHaveLength(1);
    first.unmount();

    const requestsBefore = compare.mock.calls.length;
    const second = mount("/results");
    expect(
      await screen.findByRole("heading", { name: "Retailer basket comparison" }),
    ).toBeDefined();
    expect(screen.queryByRole("heading", { name: "No comparison yet" })).toBeNull();
    expect(screen.getAllByText(/^Recommended/)).toHaveLength(1);
    expect(compare.mock.calls.length).toBe(requestsBefore);
    second.unmount();
  });

  it("shows the restored comparison as reference when the basket changed meanwhile", async () => {
    stubComparisonApi();
    const first = await compareBasket();
    first.unmount();

    // Another browser session edited the shared basket before this tab reloads.
    window.localStorage.setItem(
      BASKET_STORAGE_KEY,
      JSON.stringify([{ productId: "fixture-drink", quantity: 1 }]),
    );
    mount("/results");
    expect(
      await screen.findByRole("heading", { name: "Retailer basket comparison" }),
    ).toBeDefined();
    expect(screen.getByText("Your basket changed.")).toBeDefined();
    expect(
      screen.getByText(
        "This comparison belongs to an earlier basket state. Recalculate after editing your basket; the previous result is shown for reference.",
      ),
    ).toBeDefined();
  });

  it("marks a restored comparison stale after the shopper edits the basket", async () => {
    stubComparisonApi();
    const first = await compareBasket();
    first.unmount();

    const second = mount("/basket");
    await screen.findByRole("link", { name: "View current results" });
    fireEvent.click(await screen.findByRole("button", { name: "Increase Fixture Plain Drink" }));
    fireEvent.click(await screen.findByRole("link", { name: "View previous results" }));
    expect(await screen.findByText("Your basket changed.")).toBeDefined();
    second.unmount();
  });

  it("keeps the no-comparison state when the snapshot is unreadable", async () => {
    stubComparisonApi();
    const first = await compareBasket();
    first.unmount();

    window.sessionStorage.setItem(COMPARISON_STORAGE_KEY, "most certainly not json");
    mount("/results");
    expect(await screen.findByRole("heading", { name: "No comparison yet" })).toBeDefined();
    expect(screen.getByText("Build a basket and run a new estimate first.")).toBeDefined();
  });
});
