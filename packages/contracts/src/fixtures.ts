/** Synthetic examples only. No values represent verified retailer prices/rules. */
import type {
  BasketCompareRequest,
  BasketCompareResponse,
  CatalogueResponse,
  OffersResponse,
  ProductsResponse,
} from "./api.ts";
import {
  type DatasetReference,
  type Product,
  type RetailerId,
  SNAPSHOT_DISCLAIMER,
} from "./common.ts";
import type {
  DeliveryRule,
  OfferPricingInput,
  OrderPricingInput,
  OrderPricingResult,
  PricedLine,
  PricedOrder,
} from "./pricing.ts";

export const fixtureDataset = {
  datasetId: "fixture-v1",
  deliveryRuleVersion: "fixture-delivery-v1",
  dataKind: "synthetic",
} satisfies DatasetReference;

export const fixtureProducts = [
  {
    productId: "fixture-rice",
    categoryId: "rice-noodles",
    name: "Fixture rice",
    brand: "Fixture",
    variant: "White rice",
    pack: { unitCount: 1, sizePerUnit: "1", unit: "kg", display: "1 × 1 kg" },
    imageUrl: null,
  },
  {
    productId: "fixture-drink",
    categoryId: "drinks",
    name: "Fixture drink",
    brand: "Fixture",
    variant: "Plain",
    pack: { unitCount: 1, sizePerUnit: "500", unit: "ml", display: "1 × 500 ml" },
    imageUrl: null,
  },
] as const satisfies Product[];

export const fixtureDeliveryRule = (retailerId: RetailerId): DeliveryRule => ({
  retailerId,
  ruleId: `fixture-${retailerId}-delivery`,
  deliveryFeeCents: 0,
  freeDelivery: null,
  minimumOrder: null,
  orderCharges: [],
  explanation: "Synthetic free delivery; not a verified retailer rule.",
});

export const catalogueExample = {
  dataset: fixtureDataset,
  currency: "SGD",
  disclaimer: SNAPSHOT_DISCLAIMER,
  retailers: [
    { retailerId: "redmart", name: "RedMart" },
    { retailerId: "fairprice", name: "FairPrice" },
    { retailerId: "cold-storage", name: "Cold Storage" },
  ],
  categories: [
    { categoryId: "rice-noodles", name: "Rice & Noodles" },
    { categoryId: "drinks", name: "Drinks" },
    { categoryId: "dairy", name: "Dairy" },
    { categoryId: "breakfast", name: "Breakfast Foods" },
    { categoryId: "canned-packaged", name: "Canned & Packaged Food" },
    { categoryId: "snacks", name: "Snacks" },
    { categoryId: "household-cleaning", name: "Household Cleaning" },
    { categoryId: "toiletries-personal-care", name: "Toiletries & Personal Care" },
  ],
  deliveryScenario: {
    scenarioId: "fixture-standard",
    location: "Synthetic serviceable Singapore location",
    service: "Synthetic standard delivery",
    membership: "non_member",
    rules: ["redmart", "fairprice", "cold-storage"].map((id) => ({
      status: "verified" as const,
      rule: fixtureDeliveryRule(id as RetailerId),
    })),
  },
  pricing: {
    supported: ["ordinary", "unconditional_sale"],
    excluded: [
      "Multibuys, cross-product offers, memberships, vouchers, payment-method discounts and gifts.",
    ],
  },
} satisfies CatalogueResponse;

export const productsExample = {
  dataset: fixtureDataset,
  products: [fixtureProducts[1], fixtureProducts[0]],
  pagination: { page: 1, pageSize: 20, total: 2 },
} satisfies ProductsResponse;
export const emptyProductsExample = {
  dataset: fixtureDataset,
  products: [],
  pagination: { page: 1, pageSize: 20, total: 0 },
} satisfies ProductsResponse;

const line = (productId: string, retailerId: RetailerId, cents: number): PricedLine => ({
  productId,
  retailerId,
  listingId: `${productId}-${retailerId}`,
  quantity: 1,
  priceKind: "ordinary",
  unitPriceCents: cents,
  recordedPriceSubtotalCents: cents,
  merchandiseSubtotalCents: cents,
  itemCharges: [],
  lineTotalCents: cents,
  explanation: "One pack at the verified fixture price.",
  excludedPromotions: [],
});
const riceRedmart = line("fixture-rice", "redmart", 600);
const riceFairprice = line("fixture-rice", "fairprice", 400);
const drinkRedmart = line("fixture-drink", "redmart", 200);
const order = (retailerId: RetailerId, lines: PricedLine[], total: number): PricedOrder => ({
  retailerId,
  ruleId: `fixture-${retailerId}-delivery`,
  lines,
  merchandiseSubtotalCents: total,
  itemChargesCents: 0,
  orderCharges: [],
  deliveryCents: 0,
  totalCents: total,
  minimumOrder: null,
  freeDelivery: null,
});
const baseline = {
  orders: [order("redmart", [drinkRedmart, riceRedmart], 800)],
  retailerCount: 1,
  totalCents: 800,
};
const split = {
  orders: [order("fairprice", [riceFairprice], 400), order("redmart", [drinkRedmart], 200)],
  retailerCount: 2,
  totalCents: 600,
};

export const offersExample = {
  dataset: fixtureDataset,
  product: fixtureProducts[0],
  quantity: 1,
  currency: "SGD",
  disclaimer: SNAPSHOT_DISCLAIMER,
  offers: [riceFairprice, riceRedmart].map((pricing) => ({
    listingId: pricing.listingId,
    retailerId: pricing.retailerId,
    productUrl: `https://example.com/${pricing.listingId}`,
    pricing,
  })),
} satisfies OffersResponse;

export const basketRequestExample = {
  datasetId: fixtureDataset.datasetId,
  lines: [
    { productId: "fixture-rice", quantity: 1 },
    { productId: "fixture-drink", quantity: 1 },
  ],
  maxRetailers: 2,
} satisfies BasketCompareRequest;
const context = {
  dataset: fixtureDataset,
  request: basketRequestExample,
  currency: "SGD" as const,
  disclaimer: SNAPSHOT_DISCLAIMER,
} as const;
const unavailableBaseline = {
  status: "unavailable" as const,
  plan: null,
  savingsCents: null,
  reason: "no_feasible_single_retailer" as const,
};

export const bestFoundExample = {
  ...context,
  status: "best_found",
  searchLimitReached: false,
  recommendation: split,
  bestSplit: split,
  baseline: { status: "available", plan: baseline, savingsCents: 200 },
} satisfies BasketCompareResponse;
export const noSplitImprovementExample = {
  ...context,
  status: "best_found",
  searchLimitReached: true,
  request: { ...basketRequestExample, maxRetailers: 1 },
  recommendation: baseline,
  bestSplit: null,
  baseline: { status: "available", plan: baseline, savingsCents: 0 },
} satisfies BasketCompareResponse;
// These are separate fixture scenarios, not alternate outcomes over the same seed.
const missingBaselineDataset = { ...fixtureDataset, datasetId: "fixture-no-baseline" };
export const missingBaselineExample = {
  ...context,
  dataset: missingBaselineDataset,
  request: { ...basketRequestExample, datasetId: missingBaselineDataset.datasetId },
  status: "best_found",
  searchLimitReached: true,
  recommendation: split,
  bestSplit: split,
  baseline: unavailableBaseline,
} satisfies BasketCompareResponse;
export const noPlanFoundExample = {
  ...context,
  dataset: { ...fixtureDataset, datasetId: "fixture-search-exhausted" },
  request: { ...basketRequestExample, datasetId: "fixture-search-exhausted" },
  status: "no_plan_found",
  searchLimitReached: true,
  recommendation: null,
  bestSplit: null,
  baseline: unavailableBaseline,
  explanation: "No valid plan found within the search budget; feasibility was not disproved.",
} satisfies BasketCompareResponse;
export const provenInfeasibleExample = {
  ...context,
  dataset: { ...fixtureDataset, datasetId: "fixture-missing-offer" },
  request: { ...basketRequestExample, datasetId: "fixture-missing-offer" },
  status: "proven_infeasible",
  recommendation: null,
  bestSplit: null,
  baseline: unavailableBaseline,
  blocker: {
    code: "no_eligible_offer",
    productIds: ["fixture-rice"],
    explanation: "The requested rice has no eligible offer in this fixture dataset.",
  },
} satisfies BasketCompareResponse;

export const datasetConflictExample = {
  error: {
    code: "dataset_conflict",
    message: "Refresh the catalogue and revalidate the basket before retrying.",
    retryable: false,
    requestedDatasetId: "fixture-v0",
    activeDatasetId: "fixture-v1",
  },
} as const;
export const databaseFailureExample = {
  error: {
    code: "dependency_unavailable",
    message: "The catalogue service is temporarily unavailable.",
    retryable: true,
  },
} as const;
export const duplicateLinesErrorExample = {
  error: {
    code: "invalid_request",
    message: "Each product must appear once.",
    retryable: false,
    issues: [{ path: "/lines/1/productId", message: "Duplicate productId: fixture-rice" }],
  },
} as const;

export const pricingInputExample: OfferPricingInput = {
  dataset: fixtureDataset,
  productId: "fixture-drink",
  listingId: "fixture-drink-redmart",
  retailerId: "redmart",
  quantity: 2,
  price: {
    kind: "unconditional_sale",
    unitPriceCents: 210,
    beforeDiscountMerchandiseUnitCents: 250,
    explanation: "Two fixture packs at 210 cents, each including a 10-cent deposit.",
  },
  itemCharges: [
    {
      chargeId: "deposit",
      label: "Fixture deposit",
      amountPerPackCents: 10,
      treatment: "included_in_price",
    },
    {
      chargeId: "handling",
      label: "Fixture pack handling",
      amountPerPackCents: 5,
      treatment: "added_to_price",
    },
  ],
  excludedPromotions: [{ description: "Unverified multibuy", reason: "multibuy_not_adopted" }],
};
export const pricedLineExample: PricedLine = {
  productId: "fixture-drink",
  listingId: "fixture-drink-redmart",
  retailerId: "redmart",
  quantity: 2,
  priceKind: "unconditional_sale",
  unitPriceCents: 210,
  recordedPriceSubtotalCents: 420,
  merchandiseSubtotalCents: 400,
  itemCharges: [
    {
      chargeId: "deposit",
      label: "Fixture deposit",
      amountCents: 20,
      treatment: "included_in_price",
    },
    {
      chargeId: "handling",
      label: "Fixture pack handling",
      amountCents: 10,
      treatment: "added_to_price",
    },
  ],
  lineTotalCents: 430,
  explanation: pricingInputExample.price.explanation,
  excludedPromotions: pricingInputExample.excludedPromotions,
};
const afterDiscount = {
  merchandise: "after_discount" as const,
  includeItemChargeIds: [],
  includeOrderChargeIds: [],
};
const bagCharge = { chargeId: "bag", label: "Fixture bag charge", amountCents: 10 };
const redmartRule: DeliveryRule = {
  ...fixtureDeliveryRule("redmart"),
  deliveryFeeCents: 300,
  minimumOrder: { amountCents: 400, basis: afterDiscount },
  freeDelivery: { amountCents: 500, basis: afterDiscount },
  orderCharges: [bagCharge],
};
export const orderPricingInputExample: OrderPricingInput = {
  dataset: fixtureDataset,
  retailerId: "redmart",
  offers: [pricingInputExample],
  delivery: { status: "verified", rule: redmartRule },
};
const pricedOrderExample: PricedOrder = {
  retailerId: "redmart",
  ruleId: "fixture-redmart-delivery",
  lines: [pricedLineExample],
  merchandiseSubtotalCents: 400,
  itemChargesCents: 30,
  orderCharges: [bagCharge],
  deliveryCents: 300,
  totalCents: 740,
  minimumOrder: { requiredCents: 400, actualCents: 400, met: true },
  freeDelivery: { requiredCents: 500, actualCents: 400, met: false },
};
export const orderPricingResultExample: OrderPricingResult = {
  status: "priced",
  order: pricedOrderExample,
};

/** Hand-calculated boundary vectors for #8, not results from an implemented kernel. */
export const pricingBoundaryExamples = [
  {
    name: "below minimum",
    merchandiseCents: 399,
    minimumCents: 400,
    freeAtCents: 500,
    expectedStatus: "minimum_not_met",
    expectedDeliveryCents: null,
  },
  {
    name: "at minimum",
    merchandiseCents: 400,
    minimumCents: 400,
    freeAtCents: 500,
    expectedStatus: "priced",
    expectedDeliveryCents: 300,
  },
  {
    name: "below free delivery",
    merchandiseCents: 499,
    minimumCents: 400,
    freeAtCents: 500,
    expectedStatus: "priced",
    expectedDeliveryCents: 300,
  },
  {
    name: "at free delivery",
    merchandiseCents: 500,
    minimumCents: 400,
    freeAtCents: 500,
    expectedStatus: "priced",
    expectedDeliveryCents: 0,
  },
] as const;

/** Input/output pairs for #8. These are fixture expectations, not an implemented kernel. */
const thresholdBasisCases: {
  name: string;
  input: OrderPricingInput;
  expected: OrderPricingResult;
}[] = [
  {
    // Two packs are worth 500 cents before discounts, against 400 after.
    name: "verified before-discount free-delivery basis",
    input: {
      ...orderPricingInputExample,
      delivery: {
        status: "verified",
        rule: {
          ...redmartRule,
          freeDelivery: {
            amountCents: 500,
            basis: { ...afterDiscount, merchandise: "before_discount" },
          },
        },
      },
    },
    expected: {
      status: "priced",
      order: {
        ...pricedOrderExample,
        deliveryCents: 0,
        totalCents: 440,
        freeDelivery: { requiredCents: 500, actualCents: 500, met: true },
      },
    },
  },
  {
    name: "missing before-discount basis cannot be guessed",
    input: {
      ...orderPricingInputExample,
      offers: [
        {
          ...pricingInputExample,
          price: { ...pricingInputExample.price, beforeDiscountMerchandiseUnitCents: null },
        },
      ],
      delivery: {
        status: "verified",
        rule: {
          ...redmartRule,
          freeDelivery: {
            amountCents: 500,
            basis: { ...afterDiscount, merchandise: "before_discount" },
          },
        },
      },
    },
    expected: {
      status: "unavailable",
      retailerId: "redmart",
      reason: "missing_threshold_basis",
    },
  },
  {
    // 400 merchandise + 30 item charges + 10 bag charge reaches the 440 threshold.
    name: "explicit item and fixed order charges count toward threshold",
    input: {
      ...orderPricingInputExample,
      delivery: {
        status: "verified",
        rule: {
          ...redmartRule,
          freeDelivery: {
            amountCents: 440,
            basis: {
              ...afterDiscount,
              includeItemChargeIds: ["deposit", "handling"],
              includeOrderChargeIds: ["bag"],
            },
          },
        },
      },
    },
    expected: {
      status: "priced",
      order: {
        ...pricedOrderExample,
        deliveryCents: 0,
        totalCents: 440,
        freeDelivery: { requiredCents: 440, actualCents: 440, met: true },
      },
    },
  },
];

export const orderPricingCases: {
  name: string;
  input: OrderPricingInput;
  expected: OrderPricingResult;
}[] = [
  {
    name: "included deposit, added handling, fixed bag fee",
    input: orderPricingInputExample,
    expected: orderPricingResultExample,
  },
  ...pricingBoundaryExamples.map((example) => {
    const pricedLine = line("fixture-rice", "redmart", example.merchandiseCents);
    const input: OrderPricingInput = {
      dataset: fixtureDataset,
      retailerId: "redmart",
      offers: [
        {
          dataset: fixtureDataset,
          productId: pricedLine.productId,
          listingId: pricedLine.listingId,
          retailerId: "redmart",
          quantity: 1,
          price: {
            kind: "ordinary",
            unitPriceCents: example.merchandiseCents,
            beforeDiscountMerchandiseUnitCents: null,
            explanation: pricedLine.explanation,
          },
          itemCharges: [],
          excludedPromotions: [],
        },
      ],
      delivery: {
        status: "verified",
        rule: { ...redmartRule, orderCharges: [] },
      },
    };
    const expected: OrderPricingResult =
      example.expectedStatus === "minimum_not_met"
        ? {
            status: "minimum_not_met",
            retailerId: "redmart",
            requiredCents: example.minimumCents,
            actualCents: example.merchandiseCents,
          }
        : {
            status: "priced",
            order: {
              ...order("redmart", [pricedLine], example.merchandiseCents),
              deliveryCents: example.expectedDeliveryCents,
              totalCents: example.merchandiseCents + example.expectedDeliveryCents,
              minimumOrder: {
                requiredCents: example.minimumCents,
                actualCents: example.merchandiseCents,
                met: true,
              },
              freeDelivery: {
                requiredCents: example.freeAtCents,
                actualCents: example.merchandiseCents,
                met: example.expectedDeliveryCents === 0,
              },
            },
          };
    return { name: example.name, input, expected };
  }),
  {
    name: "unknown delivery rule cannot become zero",
    input: {
      ...orderPricingInputExample,
      delivery: {
        status: "unavailable",
        retailerId: "redmart",
        reason: "unverified_delivery_rules",
      },
    },
    expected: { status: "unavailable", retailerId: "redmart", reason: "unverified_delivery_rules" },
  },
  ...thresholdBasisCases,
];

/** Transport-invalid and semantic-invalid requests shared with API/UI tests. */
export const invalidBasketExamples: {
  name: string;
  kind: "schema" | "duplicates";
  value: unknown;
}[] = [
  { name: "empty basket", kind: "schema", value: { ...basketRequestExample, lines: [] } },
  {
    name: "51 distinct products",
    kind: "schema",
    value: {
      ...basketRequestExample,
      lines: Array.from({ length: 51 }, (_, i) => ({ productId: `fixture-${i}`, quantity: 1 })),
    },
  },
  ...[0, 21, 1.5, "2", null, true].map((quantity) => ({
    name: `invalid quantity ${JSON.stringify(quantity)}`,
    kind: "schema" as const,
    value: { ...basketRequestExample, lines: [{ productId: "fixture-rice", quantity }] },
  })),
  ...[0, 4, 1.5, "2"].map((maxRetailers) => ({
    name: `invalid retailer limit ${JSON.stringify(maxRetailers)}`,
    kind: "schema" as const,
    value: { ...basketRequestExample, maxRetailers },
  })),
  {
    name: "client-submitted price",
    kind: "schema",
    value: { ...basketRequestExample, totalCents: 1 },
  },
  {
    name: "missing dataset",
    kind: "schema",
    value: { lines: basketRequestExample.lines, maxRetailers: 2 },
  },
  {
    name: "duplicate product with different quantities",
    kind: "duplicates",
    value: {
      ...basketRequestExample,
      lines: [
        { productId: "fixture-rice", quantity: 1 },
        { productId: "fixture-rice", quantity: 2 },
      ],
    },
  },
];
