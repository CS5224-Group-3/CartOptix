import { routes } from "@cartoptix/contracts";
import { catalogueExample, productsExample } from "@cartoptix/contracts/fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { Route, Switch } from "wouter";
import {
  AppShell,
  BasketPage,
  BasketProvider,
  CataloguePage,
  ResultsPage,
  useBasket,
} from "../src/App";
import { createFixtureSource } from "../src/features/basket-comparison/fixtureSource";
import type { ComparisonSource } from "../src/features/basket-comparison/model";

export function BasketTestControls() {
  const { loadComparisonScenario } = useBasket();
  return (
    <fieldset>
      <legend>Basket test controls</legend>
      <button type="button" onClick={() => loadComparisonScenario("complete")}>
        Load complete demo basket
      </button>
      <button type="button" onClick={() => loadComparisonScenario("unavailable")}>
        Load one retailer demo basket
      </button>
    </fieldset>
  );
}

export function openBasketHarness(path = "/basket", source?: ComparisonSource) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith(routes.catalogue.url))
      return new Response(JSON.stringify(catalogueExample), { status: 200 });
    if (url.startsWith(routes.products.url))
      return new Response(JSON.stringify(productsExample), { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", path);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["product-index"], productsExample.products);
  const comparisonSource = source ?? createFixtureSource({ wait: () => Promise.resolve() });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <BasketProvider source={comparisonSource}>
        <AppShell>
          <BasketTestControls />
          <Switch>
            <Route path="/basket" component={BasketPage} />
            <Route path="/catalogue" component={CataloguePage} />
            <Route path="/results" component={ResultsPage} />
          </Switch>
        </AppShell>
      </BasketProvider>
    </QueryClientProvider>,
  );
  return { ...view, fetchMock };
}
