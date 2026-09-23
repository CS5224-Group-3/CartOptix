import Type, { type Static } from "typebox";
import {
  CentsSchema,
  IdSchema,
  OfferSchema,
  OrderChargeSchema,
  PlanLineSchema,
  ProductSchema,
  QuantitySchema,
  RetailerIdSchema,
} from "./common.ts";
import { closedObject, nullable } from "./schema.ts";

// Catalogue

export const DeliveryRuleSchema = Type.Union([
  closedObject({
    retailerId: RetailerIdSchema,
    status: Type.Literal("verified"),
    deliveryFeeCents: CentsSchema,
    /** Null means no free-delivery threshold, not an unknown one. */
    freeDeliveryFromCents: nullable(CentsSchema),
    /** Null means no minimum order, not an unknown one. */
    minimumOrderCents: nullable(CentsSchema),
    note: Type.String({ minLength: 1 }),
  }),
  /** Unknown rules are never presented as a zero fee. */
  closedObject({ retailerId: RetailerIdSchema, status: Type.Literal("unavailable") }),
]);
export type DeliveryRule = Static<typeof DeliveryRuleSchema>;

export const CatalogueResponseSchema = closedObject({
  /** The active seed version, for disclosure and evaluation records. Clients do
   * not send it back: the server prices every request from the active dataset. */
  dataset: closedObject({
    datasetId: IdSchema,
    /** Synthetic fixtures must be distinguishable from the curated seed (PR-02). */
    dataKind: Type.Union([Type.Literal("curated"), Type.Literal("synthetic")]),
  }),
  retailers: Type.Array(closedObject({ retailerId: RetailerIdSchema, name: Type.String() })),
  categories: Type.Array(closedObject({ categoryId: IdSchema, name: Type.String() })),
  delivery: closedObject({
    /** The single declared scenario, e.g. location, standard service, non-member. */
    scenario: Type.String({ minLength: 1 }),
    rules: Type.Array(DeliveryRuleSchema),
  }),
});
export type CatalogueResponse = Static<typeof CatalogueResponseSchema>;

// Products and offers

export const ProductsQuerySchema = closedObject({
  q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  categoryId: Type.Optional(IdSchema),
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
});
export type ProductsQuery = Static<typeof ProductsQuerySchema>;

export const ProductsResponseSchema = closedObject({
  products: Type.Array(ProductSchema),
  /** Matches before pagination. */
  total: Type.Integer({ minimum: 0 }),
});
export type ProductsResponse = Static<typeof ProductsResponseSchema>;

export const OffersParamsSchema = closedObject({ id: IdSchema });
export const OffersQuerySchema = closedObject({ quantity: QuantitySchema });
export type OffersParams = Static<typeof OffersParamsSchema>;
export type OffersQuery = Static<typeof OffersQuerySchema>;

export const OffersResponseSchema = closedObject({
  product: ProductSchema,
  quantity: QuantitySchema,
  /** Eligible offers only, cheapest first. Empty when the product has none. */
  offers: Type.Array(OfferSchema),
});
export type OffersResponse = Static<typeof OffersResponseSchema>;

// Basket comparison

export const BasketCompareRequestSchema = closedObject({
  lines: Type.Array(closedObject({ productId: IdSchema, quantity: QuantitySchema }), {
    minItems: 1,
    maxItems: 50,
  }),
  maxRetailers: Type.Integer({ minimum: 1, maximum: 3 }),
});
export type BasketCompareRequest = Static<typeof BasketCompareRequestSchema>;

/** Product IDs listed more than once. The API rejects such baskets rather than
 * merging them; JSON Schema cannot express this rule. */
export function duplicateProductIds(request: BasketCompareRequest): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { productId } of request.lines) {
    if (seen.has(productId)) duplicates.add(productId);
    seen.add(productId);
  }
  return [...duplicates];
}

export const OrderSchema = closedObject({
  retailerId: RetailerIdSchema,
  lines: Type.Array(PlanLineSchema, { minItems: 1 }),
  orderCharges: Type.Array(OrderChargeSchema),
  deliveryCents: CentsSchema,
  totalCents: CentsSchema,
});
export type Order = Static<typeof OrderSchema>;

export const PlanSchema = closedObject({
  orders: Type.Array(OrderSchema, { minItems: 1, maxItems: 3 }),
  totalCents: CentsSchema,
});
export type Plan = Static<typeof PlanSchema>;

export const BasketCompareResponseSchema = Type.Union([
  closedObject({
    /** A validated plan; optimality is not claimed. */
    status: Type.Literal("best_found"),
    searchLimitReached: Type.Boolean(),
    /** Cheapest complete single-retailer plan, or null if none exists. */
    baseline: nullable(PlanSchema),
    /** Best permitted plan using two or more retailers, or null if none was found. */
    bestSplit: nullable(PlanSchema),
    /** Which plan to highlight; it is never null and never costs more than the baseline. */
    recommended: Type.Union([Type.Literal("baseline"), Type.Literal("split")]),
    /** Baseline minus recommended total; null when there is no baseline. */
    savingsCents: nullable(CentsSchema),
  }),
  closedObject({
    /** Impossibility is established, not merely unfound. */
    status: Type.Literal("proven_infeasible"),
    blocker: closedObject({
      code: Type.Literal("no_eligible_offer"),
      productIds: Type.Array(IdSchema, { minItems: 1 }),
    }),
  }),
  closedObject({
    /** Search found no valid plan but did not prove that none exists. */
    status: Type.Literal("no_plan_found"),
    searchLimitReached: Type.Boolean(),
  }),
]);
export type BasketCompareResponse = Static<typeof BasketCompareResponseSchema>;

// Errors

/**
 * Every non-2xx response. Codes exist only where the client behaves differently:
 * fix the input, show "not found", or offer a retry.
 */
export const ErrorResponseSchema = closedObject({
  error: closedObject({
    code: Type.Union([
      Type.Literal("invalid_request"),
      Type.Literal("not_found"),
      Type.Literal("service_error"),
    ]),
    message: Type.String({ minLength: 1 }),
  }),
});
export type ErrorResponse = Static<typeof ErrorResponseSchema>;

// Routes

/**
 * Method, path and success schemas for each shopper endpoint, for Fastify route
 * registration. Error bodies use ErrorResponseSchema via the API's error handler;
 * they are not listed here because Fastify would also serialise its own
 * validation errors with them.
 */
export const routes = {
  catalogue: {
    method: "GET",
    url: "/api/v1/catalogue",
    schema: { response: { 200: CatalogueResponseSchema } },
  },
  products: {
    method: "GET",
    url: "/api/v1/products",
    schema: { querystring: ProductsQuerySchema, response: { 200: ProductsResponseSchema } },
  },
  offers: {
    method: "GET",
    url: "/api/v1/products/:id/offers",
    schema: {
      params: OffersParamsSchema,
      querystring: OffersQuerySchema,
      response: { 200: OffersResponseSchema },
    },
  },
  compare: {
    method: "POST",
    url: "/api/v1/basket/compare",
    schema: { body: BasketCompareRequestSchema, response: { 200: BasketCompareResponseSchema } },
  },
} as const;
