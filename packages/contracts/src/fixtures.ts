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
  CompleteOption,
  ErrorResponse,
  OffersResponse,
  ProductsResponse,
  UnavailableOption,
} from "./api.ts";
import type { OrderCharge, PlanLine, Product, RetailerId } from "./common.ts";

export const riceProduct = {
  productId: "fixture-rice",
  categoryId: "rice-noodles",
  name: "Fixture White Rice",
  packSize: "1 × 1 kg",
  imageUrl: null,
  available: true,
} satisfies Product;

export const drinkProduct = {
  productId: "fixture-drink",
  categoryId: "drinks",
  name: "Fixture Plain Drink",
  packSize: "1 × 500 ml",
  imageUrl: null,
  available: true,
} satisfies Product;

export const catalogueExample = {
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
  originalPriceCents: null,
  itemCharges: [],
  lineTotalCents: cents,
  excludedPromotions: [],
});

const complete = (
  retailerId: RetailerId,
  lines: PlanLine[],
  deliveryCents = 0,
  orderCharges: OrderCharge[] = [],
): CompleteOption => ({
  status: "complete",
  retailerId,
  lines,
  orderCharges,
  deliveryCents,
  totalCents:
    lines.reduce((sum, { lineTotalCents }) => sum + lineTotalCents, deliveryCents) +
    orderCharges.reduce((sum, charge) => (charge.waived ? sum : sum + charge.amountCents), 0),
});

/** A synthetic service fee, waived once an order's qualifying spend reaches the threshold. */
const serviceFee = (
  amountCents: number,
  waivedFromCents: number,
  waived: boolean,
): OrderCharge => ({
  label: "Synthetic service fee",
  amountCents,
  waivedFromCents,
  waived,
});

const coldStorageUnverified: UnavailableOption = {
  status: "unavailable",
  retailerId: "cold-storage",
  reasons: [{ code: "delivery_rule_unverified" }],
};

const riceAtFairprice = line("fixture-rice", "fairprice", 400);
const drinkAtFairprice = line("fixture-drink", "fairprice", 250);
const riceAtRedmart = line("fixture-rice", "redmart", 600);
/** A 10-cent container deposit added on top of the 200-cent price. */
const drinkAtRedmart: PlanLine = {
  productId: "fixture-drink",
  quantity: 1,
  listingId: "fixture-drink-redmart",
  productUrl: "https://example.com/fixture-drink-redmart",
  priceKind: "ordinary",
  unitPriceCents: 200,
  originalPriceCents: null,
  itemCharges: [{ label: "Synthetic container deposit", amountCents: 10, includedInPrice: false }],
  lineTotalCents: 210,
  excludedPromotions: [],
};

/** Two packs of rice. FairPrice has a deposit already in its price and an excluded
 * promotion; RedMart adds a handling fee on top. Offers are cheapest first. */
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
      originalPriceCents: null,
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
      originalPriceCents: 720,
      itemCharges: [{ label: "Synthetic handling fee", amountCents: 30, includedInPrice: false }],
      lineTotalCents: 1230,
      excludedPromotions: [],
    },
  ],
} satisfies OffersResponse;

export const basketRequestExample = {
  lines: [
    { productId: "fixture-drink", quantity: 1 },
    { productId: "fixture-rice", quantity: 1 },
  ],
} satisfies BasketCompareRequest;

const redmartComplete = complete("redmart", [drinkAtRedmart, riceAtRedmart]);

/** FairPrice is cheapest, and its 650-cent order reaches the 600-cent threshold that
 * waives its service fee. Cold Storage cannot be priced without a verified delivery rule. */
export const recommendedExample = {
  status: "recommended",
  recommendedRetailerId: "fairprice",
  options: [
    complete("fairprice", [drinkAtFairprice, riceAtFairprice], 0, [serviceFee(399, 600, true)]),
    redmartComplete,
    coldStorageUnverified,
  ],
} satisfies BasketCompareResponse;

/** Only RedMart stocks both products; FairPrice lacks the drink. */
export const oneRetailerCompleteExample = {
  status: "recommended",
  recommendedRetailerId: "redmart",
  options: [
    redmartComplete,
    coldStorageUnverified,
    {
      status: "unavailable",
      retailerId: "fairprice",
      reasons: [{ code: "missing_products", productIds: ["fixture-drink"] }],
    },
  ],
} satisfies BasketCompareResponse;

/** FairPrice's 650-cent order is below its fee's 1,000-cent waiver threshold, and the
 * 160-cent fee makes both totals equal, so the tie is broken by retailer ID, which
 * puts FairPrice before RedMart. */
export const tieExample = {
  status: "recommended",
  recommendedRetailerId: "fairprice",
  options: [
    complete("fairprice", [drinkAtFairprice, riceAtFairprice], 0, [serviceFee(160, 1000, false)]),
    redmartComplete,
    coldStorageUnverified,
  ],
} satisfies BasketCompareResponse;

/** No retailer can supply the whole basket, each for its own reason. */
export const noFeasiblePlanExample = {
  status: "no_feasible_plan",
  options: [
    coldStorageUnverified,
    {
      status: "unavailable",
      retailerId: "fairprice",
      reasons: [{ code: "below_minimum_order", minimumOrderCents: 1500, spendCents: 650 }],
    },
    {
      status: "unavailable",
      retailerId: "redmart",
      reasons: [{ code: "missing_products", productIds: ["fixture-rice"] }],
    },
  ],
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
  /** The retailer limit was removed with split plans (#13). */
  { name: "a retailer limit", value: { ...basketRequestExample, maxRetailers: 2 } },
];

export const duplicateLinesRequest = {
  ...basketRequestExample,
  lines: [
    { productId: "fixture-rice", quantity: 1 },
    { productId: "fixture-rice", quantity: 2 },
  ],
} satisfies BasketCompareRequest;
