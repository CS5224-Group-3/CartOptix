/**
 * Synthetic examples for building and testing against the contracts before real
 * endpoints and the curated seed exist. No value is a verified retailer price or rule.
 * Each comparison example is a separate scenario, not an alternative result for
 * the same data.
 */
import type {
  BasketCompareRequest,
  BasketCompareResponse,
  CatalogueResponse,
  ErrorResponse,
  OffersResponse,
  Order,
  Plan,
  ProductsResponse,
} from "./api.ts";
import type { PlanLine, Product, RetailerId } from "./common.ts";

export const fixtureDatasetId = "fixture-v1";

export const riceProduct = {
  productId: "fixture-rice",
  categoryId: "rice-noodles",
  name: "Fixture rice",
  brand: "Fixture",
  variant: "White rice",
  packSize: "1 × 1 kg",
  imageUrl: null,
} satisfies Product;

export const drinkProduct = {
  productId: "fixture-drink",
  categoryId: "drinks",
  name: "Fixture drink",
  brand: "Fixture",
  variant: "Plain",
  packSize: "1 × 500 ml",
  imageUrl: null,
} satisfies Product;

export const catalogueExample = {
  dataset: { datasetId: fixtureDatasetId, dataKind: "synthetic" },
  retailers: [
    { retailerId: "cold-storage", name: "Cold Storage" },
    { retailerId: "fairprice", name: "FairPrice" },
    { retailerId: "redmart", name: "RedMart" },
  ],
  categories: [
    { categoryId: "drinks", name: "Drinks" },
    { categoryId: "rice-noodles", name: "Rice & Noodles" },
  ],
  delivery: {
    scenario: "Synthetic Singapore address, standard delivery, non-member pricing.",
    rules: [
      { retailerId: "cold-storage", status: "unavailable" },
      {
        retailerId: "fairprice",
        status: "verified",
        deliveryFeeCents: 0,
        freeDeliveryFromCents: null,
        minimumOrderCents: null,
        note: "Synthetic free delivery.",
      },
      {
        retailerId: "redmart",
        status: "verified",
        deliveryFeeCents: 0,
        freeDeliveryFromCents: null,
        minimumOrderCents: null,
        note: "Synthetic free delivery.",
      },
    ],
  },
} satisfies CatalogueResponse;

export const productsExample = {
  products: [drinkProduct, riceProduct],
  total: 2,
} satisfies ProductsResponse;

/** No match is a successful empty result, not an error. */
export const emptyProductsExample = {
  products: [],
  total: 0,
} satisfies ProductsResponse;

const line = (productId: string, retailerId: RetailerId, cents: number): PlanLine => ({
  productId,
  quantity: 1,
  listingId: `${productId}-${retailerId}`,
  productUrl: `https://example.com/${productId}-${retailerId}`,
  priceKind: "ordinary",
  unitPriceCents: cents,
  itemCharges: [],
  lineTotalCents: cents,
  excludedPromotions: [],
});

const order = (retailerId: RetailerId, lines: PlanLine[], deliveryCents = 0): Order => ({
  retailerId,
  lines,
  orderCharges: [],
  deliveryCents,
  totalCents: lines.reduce((sum, { lineTotalCents }) => sum + lineTotalCents, deliveryCents),
});

const plan = (...orders: Order[]): Plan => ({
  orders,
  totalCents: orders.reduce((sum, { totalCents }) => sum + totalCents, 0),
});

const riceAtFairprice = line("fixture-rice", "fairprice", 400);
const riceAtRedmart = line("fixture-rice", "redmart", 600);
const drinkAtRedmart = line("fixture-drink", "redmart", 200);

/** Two packs of rice: one offer has a deposit already in its price and an
 * excluded promotion. Offers are cheapest first. */
export const offersExample = {
  product: riceProduct,
  quantity: 2,
  offers: [
    {
      retailerId: "fairprice",
      listingId: "fixture-rice-fairprice",
      productUrl: "https://example.com/fixture-rice-fairprice",
      priceKind: "ordinary",
      unitPriceCents: 410,
      itemCharges: [{ label: "Synthetic deposit", amountCents: 20, includedInPrice: true }],
      lineTotalCents: 820,
      excludedPromotions: ["Unverified multibuy offer"],
    },
    {
      retailerId: "redmart",
      listingId: "fixture-rice-redmart",
      productUrl: "https://example.com/fixture-rice-redmart",
      priceKind: "unconditional_sale",
      unitPriceCents: 600,
      itemCharges: [],
      lineTotalCents: 1200,
      excludedPromotions: [],
    },
  ],
} satisfies OffersResponse;

export const basketRequestExample = {
  lines: [
    { productId: "fixture-drink", quantity: 1 },
    { productId: "fixture-rice", quantity: 1 },
  ],
  maxRetailers: 2,
} satisfies BasketCompareRequest;

const redmartBaseline = plan(order("redmart", [drinkAtRedmart, riceAtRedmart]));

/** Splitting saves 200 cents against the single-retailer baseline. */
export const splitWinsExample = {
  status: "best_found",
  searchLimitReached: false,
  baseline: redmartBaseline,
  bestSplit: plan(order("fairprice", [riceAtFairprice]), order("redmart", [drinkAtRedmart])),
  recommended: "split",
  savingsCents: 200,
} satisfies BasketCompareResponse;

/** A split exists but a 500-cent delivery fee makes it dearer, so one retailer wins. */
export const singleRetailerWinsExample = {
  status: "best_found",
  searchLimitReached: false,
  baseline: redmartBaseline,
  bestSplit: plan(order("fairprice", [riceAtFairprice], 500), order("redmart", [drinkAtRedmart])),
  recommended: "baseline",
  savingsCents: 0,
} satisfies BasketCompareResponse;

/** No retailer stocks both products, so savings are unavailable, not zero. */
export const missingBaselineExample = {
  status: "best_found",
  searchLimitReached: false,
  baseline: null,
  bestSplit: plan(order("fairprice", [riceAtFairprice]), order("redmart", [drinkAtRedmart])),
  recommended: "split",
  savingsCents: null,
} satisfies BasketCompareResponse;

export const noPlanFoundExample = {
  status: "no_plan_found",
  searchLimitReached: true,
} satisfies BasketCompareResponse;

export const provenInfeasibleExample = {
  status: "proven_infeasible",
  blocker: { code: "no_eligible_offer", productIds: ["fixture-rice"] },
} satisfies BasketCompareResponse;

/** 400: sent instead of merging a product listed twice. */
export const duplicateLinesExample = {
  error: { code: "invalid_request", message: "Each product may appear only once." },
} satisfies ErrorResponse;

/** 5xx: a retryable failure, distinct from every business outcome above. */
export const serviceErrorExample = {
  error: { code: "service_error", message: "The service is temporarily unavailable." },
} satisfies ErrorResponse;

/** Requests the schema must reject. Duplicate lines are checked separately. */
export const invalidBasketRequests: { name: string; value: unknown }[] = [
  { name: "empty basket", value: { ...basketRequestExample, lines: [] } },
  {
    name: "51 lines",
    value: {
      ...basketRequestExample,
      lines: Array.from({ length: 51 }, (_, i) => ({ productId: `product-${i}`, quantity: 1 })),
    },
  },
  ...[0, 21, 1.5].map((quantity) => ({
    name: `quantity ${quantity}`,
    value: { ...basketRequestExample, lines: [{ productId: "fixture-rice", quantity }] },
  })),
  ...[0, 4].map((maxRetailers) => ({
    name: `maxRetailers ${maxRetailers}`,
    value: { ...basketRequestExample, maxRetailers },
  })),
  { name: "missing maxRetailers", value: { lines: basketRequestExample.lines } },
];

export const duplicateLinesRequest = {
  ...basketRequestExample,
  lines: [
    { productId: "fixture-rice", quantity: 1 },
    { productId: "fixture-rice", quantity: 2 },
  ],
} satisfies BasketCompareRequest;
