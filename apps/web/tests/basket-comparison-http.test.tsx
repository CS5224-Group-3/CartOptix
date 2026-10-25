import type { BasketCompareResponse, OffersResponse } from "@cartoptix/contracts";
import { routes } from "@cartoptix/contracts";
import {
  basketRequestExample,
  catalogueExample,
  noFeasiblePlanExample,
  productsExample,
  recommendedExample,
  tieExample,
} from "@cartoptix/contracts/fixtures";
import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { BASKET_STORAGE_KEY } from "../src/features/basket/storage";
import { COMPARISON_STORAGE_KEY } from "../src/features/basket-comparison/persistedComparison";

afterEach(() => {
  window.localStorage.removeItem(BASKET_STORAGE_KEY);
  window.sessionStorage.removeItem(COMPARISON_STORAGE_KEY);
  window.history.replaceState({}, "", "/");
});
/** A retailer's column header, found by name. */
const column = (retailer: string) =>
  screen.getByRole("columnheader", { name: new RegExp(retailer) });
/** The cell a retailer's column holds in a row: cells follow the column headers' order. */
function cellIn(row: HTMLElement, retailer: string) {
  const names = screen
    .getAllByRole("columnheader")
    .slice(1)
    .map((header) => header.textContent ?? "");
  const cell =
    within(row).getAllByRole("cell")[names.findIndex((name) => name.startsWith(retailer))];
  if (!cell) throw new Error(`No ${retailer} cell`);
  return cell;
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function deferred() {
  let resolve: (value: Response) => void = () => {
    throw new Error("Not initialized");
  };
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function open(
  compare = async () => json(recommendedExample),
  lookup?: (url: string) => Promise<Response>,
  seedCache?: (client: QueryClient) => void,
) {
  const posts = vi.fn(compare);
  const offers = vi.fn(
    lookup ??
      (async (url: string) => {
        const product = productsExample.products.find((product) =>
          url.includes(`/${product.productId}/`),
        );
        return json({ product, quantity: 1, offers: [] });
      }),
  );
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === routes.compare.url) return posts();
    if (url.includes("/offers?")) return offers(url);
    if (url === routes.catalogue.url) return json(catalogueExample);
    if (url.startsWith(routes.products.url)) return json(productsExample);
    throw new Error(`Unexpected URL: ${url} ${init?.method}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  seedCache?.(client);
  window.history.replaceState({}, "", "/catalogue");
  const view = render(<App queryClient={client} />);
  for (const button of await screen.findAllByRole("button", { name: "Add" }))
    fireEvent.click(button);
  fireEvent.click(screen.getByRole("link", { name: /^Basket / }));
  return { client, posts, offers, fetchMock, ...view };
}
function compare() {
  fireEvent.click(screen.getByRole("button", { name: "Compare basket" }));
}
async function results() {
  await screen.findByRole("heading", { name: "Retailer basket comparison" });
}
async function clearMetadata(client: QueryClient) {
  await act(async () => {
    client.setQueriesData({ queryKey: ["products"] }, { products: [], total: 0 });
    client.setQueryData(["product-index"], []);
  });
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Increase Fixture White Rice" })).toBeNull(),
  );
}

describe("normal API comparison flow", () => {
  it("compares a catalogue basket with only lines, without an exact demo match", async () => {
    const { posts, offers, fetchMock } = await open();
    expect(screen.getByRole("heading", { name: "Complete retailer baskets" })).toBeDefined();
    compare();
    await results();
    expect(posts).toHaveBeenCalledTimes(1);
    expect(offers).not.toHaveBeenCalled();
    const call = fetchMock.mock.calls.find(([url]) => url === routes.compare.url);
    expect(call?.[1]).toEqual({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(basketRequestExample),
    });
    expect(screen.queryByRole("link", { name: /^Visit / })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: /View Fixture White Rice at FairPrice/ })
        .getAttribute("href"),
    ).toBe(
      recommendedExample.options[0]?.status === "complete"
        ? recommendedExample.options[0].lines[1]?.productUrl
        : "",
    );
    expect(screen.queryByText(/split|savings|How many retailer orders/i)).toBeNull();
    // The manual-checkout guidance is stated once for the whole comparison.
    expect(screen.getAllByText(/complete checkout manually/)).toHaveLength(1);
  });

  it.each([noFeasiblePlanExample, tieExample])(
    "renders API business outcomes and reasons",
    async (response) => {
      await open(async () => json(response));
      compare();
      await results();
      expect(screen.queryByRole("alert")).toBeNull();
      if (response.status === "no_feasible_plan") {
        expect(
          screen.getByRole("heading", { name: "No feasible purchasing plan available" }),
        ).toBeDefined();
        expect(screen.getByText(/Not available at RedMart: Fixture White Rice/)).toBeDefined();
        expect(screen.getByText(/Below FairPrice's S\$15.00 minimum order/)).toBeDefined();
        expect(screen.queryByText(/^Recommended/)).toBeNull();
        // RedMart's partial checkout, labelled as such, with the missing product listed.
        expect(
          within(column("RedMart")).getByText("Estimated total for 1 of 2 items"),
        ).toBeDefined();
        const missing = screen.getByRole("row", { name: /^Fixture White Rice/ });
        expect(within(missing).getByRole("link", { name: "Fixture White Rice" })).toBeDefined();
      } else {
        expect(within(column("FairPrice")).getByText(/Recommended.*joint lowest/)).toBeDefined();
        expect(within(column("RedMart")).queryByText(/^Recommended/)).toBeNull();
        expect(screen.getByText("S$1.60")).toBeDefined();
      }
      const unavailable = within(column("Cold Storage"));
      expect(unavailable.getByText(/delivery charges could not be confirmed/)).toBeDefined();
      expect(unavailable.queryByText(/Estimated total|Recommended/)).toBeNull();
    },
  );

  it("shows unit prices, line charges, waiver and excluded promotions without changing totals", async () => {
    const response: BasketCompareResponse = structuredClone(recommendedExample);
    const first = response.options[0];
    if (first?.status !== "complete" || !first.lines[0]) throw new Error("Missing line");
    first.lines[0].itemCharges = [
      { label: "Included charge", amountCents: 10, includedInPrice: true },
    ];
    first.lines[0].excludedPromotions = ["Members only"];
    first.lines[0].priceKind = "unconditional_sale";
    first.lines[0].originalPriceCents = 290;
    await open(async () => json(response));
    compare();
    await results();
    const line = screen.getByRole("row", { name: /^Fixture Plain Drink/ });
    const fair = within(cellIn(line, "FairPrice"));
    expect(cellIn(line, "FairPrice").querySelector(".matrix__unit")?.textContent).toMatch(
      /1 × .*S\$2\.90.*S\$2\.50 sale/,
    );
    expect(fair.getByText("S$2.90").closest("s")).not.toBeNull();
    expect(fair.getByText(/Included charge: S\$0.10.*included in unit price/)).toBeDefined();
    expect(fair.getByText("Members only — not included in this estimate")).toBeDefined();
    expect(
      screen.getByRole("cell", { name: /S\$3.99 waived on orders from S\$6.00/ }),
    ).toBeDefined();
    // The fee is waived, so the subtotal and the estimated total agree.
    const subtotal = screen.getByRole("row", { name: /^Product subtotal/ });
    const total = screen.getByRole("row", { name: /^Estimated total/ });
    expect(cellIn(subtotal, "FairPrice").textContent).toBe("S$6.50");
    expect(cellIn(total, "FairPrice").textContent).toBe("S$6.50");
    const red = within(cellIn(line, "RedMart"));
    expect(red.getByText(/S\$0.10.*already included in line total/)).toBeDefined();
    expect(red.getByText("S$2.10")).toBeDefined();
    expect(cellIn(subtotal, "RedMart").textContent).toBe("S$8.10");
    expect(cellIn(total, "RedMart").textContent).toBe("S$8.10");
  });

  it("resolves missing metadata before POST and blocks duplicates during lookup", async () => {
    const waiting = deferred();
    const { client, offers, posts } = await open(undefined, async (url) =>
      url.includes("fixture-drink")
        ? waiting.promise
        : json({ product: productsExample.products[1], quantity: 1, offers: [] }),
    );
    await clearMetadata(client);
    compare();
    fireEvent.click(screen.getByRole("button", { name: "Comparing..." }));
    await waitFor(() => expect(offers).toHaveBeenCalledTimes(2));
    expect(posts).not.toHaveBeenCalled();
    await act(async () =>
      waiting.resolve(json({ product: productsExample.products[0], quantity: 1, offers: [] })),
    );
    await results();
    expect(posts).toHaveBeenCalledTimes(1);
    // Named once in the product column, not once per retailer.
    expect(within(screen.getByRole("main")).getAllByText("Fixture Plain Drink")).toHaveLength(1);
  });

  it.each(["comparison-product", "product-index", "products-page", "offers"] as const)(
    "uses cached %s metadata without another lookup",
    async (source) => {
      const { offers } = await open(undefined, undefined, (client) => {
        if (source === "comparison-product") {
          for (const product of productsExample.products)
            client.setQueryData(["comparison-product", product.productId], product);
        } else if (source === "product-index") {
          client.setQueryData(["product-index"], productsExample.products);
        } else if (source === "products-page") {
          client.setQueryData(["products", { page: 99, pageSize: 20 }], {
            products: productsExample.products,
            total: productsExample.products.length,
          });
        } else {
          for (const product of productsExample.products)
            client.setQueryData<OffersResponse>(["offers", product.productId, 3], {
              product,
              quantity: 3,
              offers: [],
            });
        }
      });

      compare();
      await results();

      expect(offers).not.toHaveBeenCalled();
    },
  );

  it("offers a retry after HTTP 429 and succeeds when retried", async () => {
    let rateLimited = true;
    const { posts } = await open(async () => {
      if (rateLimited) {
        rateLimited = false;
        return json({ error: { code: "service_error", message: "Rate limited" } }, 429);
      }
      return json(recommendedExample);
    });

    compare();
    expect(await screen.findByRole("button", { name: "Retry comparison" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Retry comparison" }));
    await results();

    expect(posts).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/^Recommended/)).toBeDefined();
  });

  it("fails safely without POST when metadata cannot be resolved", async () => {
    const { client, posts } = await open(undefined, async () =>
      json({ error: { code: "not_found", message: "Missing" } }, 404),
    );
    await clearMetadata(client);
    compare();
    expect((await screen.findByRole("alert")).textContent).toContain("Missing");
    expect(posts).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Retry comparison" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Back to basket editing" })).toBeNull();
  });

  it("edits during metadata lookup do not change the submitted request", async () => {
    const waiting = deferred();
    const { client, offers, fetchMock } = await open(undefined, async (url) =>
      url.includes("fixture-drink")
        ? waiting.promise
        : json({ product: productsExample.products[1], quantity: 1, offers: [] }),
    );
    await clearMetadata(client);
    compare();
    await waitFor(() => expect(offers).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Increase Fixture White Rice" }));
    await act(async () =>
      waiting.resolve(json({ product: productsExample.products[0], quantity: 1, offers: [] })),
    );
    await results();
    expect(fetchMock.mock.calls.find(([url]) => url === routes.compare.url)?.[1]?.body).toBe(
      JSON.stringify(basketRequestExample),
    );
    expect(screen.getByText(/earlier basket state/)).toBeDefined();
    expect(screen.queryByText(/^Recommended/)).toBeNull();
  });

  it("does not send comparison after unmount during metadata lookup", async () => {
    const waiting = deferred();
    const { client, offers, posts, unmount } = await open(undefined, async (url) =>
      url.includes("fixture-drink")
        ? waiting.promise
        : json({ product: productsExample.products[1], quantity: 1, offers: [] }),
    );
    await clearMetadata(client);
    compare();
    await waitFor(() => expect(offers).toHaveBeenCalledTimes(2));
    unmount();
    await act(async () =>
      waiting.resolve(json({ product: productsExample.products[0], quantity: 1, offers: [] })),
    );
    expect(posts).not.toHaveBeenCalled();
  });

  it("freezes metadata and quantities, marks late responses stale, and blocks duplicate POSTs", async () => {
    const waiting = deferred();
    const { client, posts } = await open(() => waiting.promise);
    compare();
    fireEvent.click(screen.getByRole("button", { name: "Comparing..." }));
    await waitFor(() => expect(posts).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Increase Fixture White Rice" }));
    await act(async () =>
      client.setQueriesData(
        { queryKey: ["products"] },
        {
          ...productsExample,
          products: productsExample.products.map((p) => ({
            ...p,
            name: "Changed name",
            packSize: "Changed pack",
          })),
        },
      ),
    );
    await act(async () => waiting.resolve(json(recommendedExample)));
    await results();
    expect(screen.getByText(/earlier basket state/)).toBeDefined();
    // Named once in the product column, not once per retailer.
    expect(within(screen.getByRole("main")).getAllByText("Fixture White Rice")).toHaveLength(1);
    expect(screen.queryByText("Changed name")).toBeNull();
    expect(screen.queryByText(/^Recommended/)).toBeNull();
    expect(screen.queryByRole("link", { name: /^View Fixture/ })).toBeNull();
  });

  it("retains a late result without redirecting after navigation away", async () => {
    const waiting = deferred();
    const { posts } = await open(() => waiting.promise);
    compare();
    await waitFor(() => expect(posts).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("link", { name: "Browse products" }));
    await act(async () => waiting.resolve(json(recommendedExample)));
    expect(window.location.pathname).toBe("/catalogue");
    fireEvent.click(screen.getByRole("link", { name: /^Basket / }));
    fireEvent.click(screen.getByRole("link", { name: "View current results" }));
    await results();
    expect(posts).toHaveBeenCalledTimes(1);
  });

  it("retries the original resolved basket without reloading metadata", async () => {
    let count = 0;
    const { fetchMock, offers } = await open(async () =>
      ++count === 1
        ? json({ error: { code: "service_error", message: "Unavailable" } }, 500)
        : json(recommendedExample),
    );
    compare();
    fireEvent.click(await screen.findByRole("button", { name: "Retry comparison" }));
    await results();
    expect(
      fetchMock.mock.calls
        .filter(([url]) => url === routes.compare.url)
        .map(([, init]) => init?.body),
    ).toEqual([JSON.stringify(basketRequestExample), JSON.stringify(basketRequestExample)]);
    expect(offers).not.toHaveBeenCalled();
  });

  it("retry after basket edits sends the earlier body and remains stale", async () => {
    let count = 0;
    const { fetchMock } = await open(async () =>
      ++count === 1
        ? json({ error: { code: "service_error", message: "Unavailable" } }, 500)
        : json(recommendedExample),
    );
    compare();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Increase Fixture White Rice" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry comparison" }));
    await results();
    expect(screen.getByText(/earlier basket state/)).toBeDefined();
    expect(
      fetchMock.mock.calls
        .filter(([url]) => url === routes.compare.url)
        .map(([, init]) => init?.body),
    ).toEqual([JSON.stringify(basketRequestExample), JSON.stringify(basketRequestExample)]);
  });

  it("invalid_request does not expose Retry", async () => {
    await open(async () =>
      json({ error: { code: "invalid_request", message: "Invalid basket" } }, 400),
    );
    compare();
    expect((await screen.findByRole("alert")).textContent).toContain("Invalid basket");
    expect(screen.queryByRole("button", { name: "Retry comparison" })).toBeNull();
  });

  it("keeps the basket page free of synthetic scenario controls", async () => {
    await open();
    expect(screen.queryByRole("button", { name: /Multiple complete retailers/ })).toBeNull();
    expect(screen.queryByText(/Demo mode/)).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Compare basket" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it.each(["network", "service_error", "5xx"])(
    "metadata %s failure retries preparation and succeeds",
    async (kind) => {
      let failed = false;
      const { client, posts, offers } = await open(undefined, async (url) => {
        const product = productsExample.products.find((product) => url.includes(product.productId));
        if (url.includes("fixture-drink") && !failed) {
          failed = true;
          if (kind === "network") throw new TypeError("Failed to fetch");
          return kind === "service_error"
            ? json({ error: { code: "service_error", message: "Try later" } }, 500)
            : json({}, 503);
        }
        return json({ product, quantity: 1, offers: [] });
      });
      await clearMetadata(client);
      compare();
      fireEvent.click(await screen.findByRole("button", { name: "Retry comparison" }));
      await results();
      expect(posts).toHaveBeenCalledTimes(1);
      expect(offers.mock.calls.filter(([url]) => url.includes("fixture-drink"))).toHaveLength(2);
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it.each(["invalid_request", "not_found"])("metadata %s does not expose Retry", async (code) => {
    const { client, posts } = await open(undefined, async () =>
      json(
        { error: { code, message: "Cannot resolve product" } },
        code === "not_found" ? 404 : 400,
      ),
    );
    await clearMetadata(client);
    compare();
    expect((await screen.findByRole("alert")).textContent).toContain("Cannot resolve product");
    expect(screen.queryByRole("button", { name: "Retry comparison" })).toBeNull();
    expect(posts).not.toHaveBeenCalled();
  });

  it("invalid metadata remains a non-retryable presentation failure", async () => {
    const { client, posts } = await open(undefined, async () =>
      json({ product: { name: "", packSize: "" } }),
    );
    await clearMetadata(client);
    compare();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "product details could not be verified",
    );
    expect(screen.queryByRole("button", { name: "Retry comparison" })).toBeNull();
    expect(posts).not.toHaveBeenCalled();
  });

  it("metadata retry after edits keeps the original quantities and becomes stale", async () => {
    let failed = false;
    const { client, fetchMock, offers } = await open(undefined, async (url) => {
      if (url.includes("fixture-drink") && !failed) {
        failed = true;
        throw new TypeError("Offline");
      }
      const product = productsExample.products.find((product) => url.includes(product.productId));
      return json({ product, quantity: 1, offers: [] });
    });
    await clearMetadata(client);
    compare();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Increase fixture-drink" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry comparison" }));
    await results();
    expect(
      fetchMock.mock.calls
        .filter(([url]) => url === routes.compare.url)
        .map(([, init]) => init?.body),
    ).toEqual([JSON.stringify(basketRequestExample)]);
    expect(offers.mock.calls.every(([url]) => url.endsWith("quantity=1"))).toBe(true);
    expect(screen.getByText(/earlier basket state/)).toBeDefined();
    expect(screen.queryByText(/^Recommended/)).toBeNull();
  });

  it("retains resolved product metadata for editing and a second comparison", async () => {
    const { client, posts, offers } = await open();
    await clearMetadata(client);
    compare();
    await results();
    expect(offers).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("link", { name: "Edit basket" }));
    const main = within(screen.getByRole("main"));
    for (const product of productsExample.products) {
      expect(main.getByText(product.name)).toBeDefined();
      expect(main.getByText(product.packSize)).toBeDefined();
    }
    expect(main.queryByText("Product details unavailable")).toBeNull();
    compare();
    await results();
    expect(posts).toHaveBeenCalledTimes(2);
    expect(offers).toHaveBeenCalledTimes(2);
  });
});
