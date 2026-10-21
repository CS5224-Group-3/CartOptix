import Type, { type Static } from "typebox";
import {
  API_BASE_PATH,
  CentsSchema,
  IdSchema,
  MAX_BASKET_LINES,
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
  retailers: Type.Array(
    closedObject({ retailerId: RetailerIdSchema, name: Type.String({ minLength: 1 }) }),
  ),
  categories: Type.Array(
    closedObject({ categoryId: IdSchema, name: Type.String({ minLength: 1 }) }),
  ),
  delivery: closedObject({
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
    maxItems: MAX_BASKET_LINES,
  }),
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

/** Why a retailer cannot supply the complete basket. */
export const UnavailableReasonSchema = Type.Union([
  /** The retailer has no eligible offer for these basket products. */
  closedObject({
    code: Type.Literal("missing_products"),
    productIds: Type.Array(IdSchema, { minItems: 1 }),
  }),
  /** The order's qualifying spend is below the retailer's minimum order. */
  closedObject({
    code: Type.Literal("below_minimum_order"),
    minimumOrderCents: CentsSchema,
    spendCents: CentsSchema,
  }),
  /** The retailer's delivery rule is unverified, so a complete total cannot be
   * calculated; it is never priced as a zero fee. */
  closedObject({ code: Type.Literal("delivery_rule_unverified") }),
]);
export type UnavailableReason = Static<typeof UnavailableReasonSchema>;

/** The complete basket as one retailer order. `Order` is the breakdown shared by
 * every complete option; `CompleteOption` adds its status. */
const orderFields = {
  retailerId: RetailerIdSchema,
  lines: Type.Array(PlanLineSchema, { minItems: 1 }),
  orderCharges: Type.Array(OrderChargeSchema),
  deliveryCents: CentsSchema,
  /** Line totals, plus charges that are not waived, plus delivery. */
  totalCents: CentsSchema,
};

export const OrderSchema = closedObject(orderFields);
export type Order = Static<typeof OrderSchema>;

export const CompleteOptionSchema = closedObject({
  status: Type.Literal("complete"),
  ...orderFields,
});
export type CompleteOption = Static<typeof CompleteOptionSchema>;

export const UnavailableOptionSchema = closedObject({
  status: Type.Literal("unavailable"),
  retailerId: RetailerIdSchema,
  reasons: Type.Array(UnavailableReasonSchema, { minItems: 1 }),
  /**
   * What checking out the lines this retailer can supply would cost, as if the
   * shopper did so: with delivery and order charges for that spend. Its total
   * is an estimate for an incomplete or unacceptable order, never ranked
   * against or recommended over a complete option. Absent when the retailer
   * can supply no line or its delivery rule is unverified.
   */
  partialOrder: Type.Optional(OrderSchema),
});
export type UnavailableOption = Static<typeof UnavailableOptionSchema>;

export const RetailerOptionSchema = Type.Union([CompleteOptionSchema, UnavailableOptionSchema]);
export type RetailerOption = Static<typeof RetailerOptionSchema>;

/** One option per retailer: complete options first, cheapest first, then
 * unavailable ones, fewest missing products first. Ties between equal totals,
 * and between equal missing counts, follow retailer ID in code-point order
 * ("cold-storage" < "fairprice" < "redmart"). The API orders them; schemas
 * cannot compare totals. */
const options = (item: typeof RetailerOptionSchema | typeof UnavailableOptionSchema) =>
  Type.Array(item, { minItems: 1, maxItems: 3 });

export const BasketCompareResponseSchema = Type.Union([
  /** At least one retailer can supply the complete basket. The recommendation is
   * the cheapest complete option, with ties broken by retailer ID, so it is always
   * the first option. */
  closedObject({
    status: Type.Literal("recommended"),
    recommendedRetailerId: RetailerIdSchema,
    options: options(RetailerOptionSchema),
  }),
  /** No retailer can supply the complete basket; each option gives its reasons. */
  closedObject({
    status: Type.Literal("no_feasible_plan"),
    options: options(UnavailableOptionSchema),
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

// Outbound clicks

/**
 * A click through to a retailer's product page (PR-07).
 *
 * Only the listing is sent. The server reads the retailer and product from
 * that listing and stamps its own clock, so a caller cannot attribute a click
 * to a retailer of its choosing, and an unknown listing cannot create an
 * event.
 *
 * Deliberately carries no user identity, session or device field: this feature
 * measures link use, not people.
 */
export const OutboundClickRequestSchema = closedObject({ listingId: IdSchema });
export type OutboundClickRequest = Static<typeof OutboundClickRequestSchema>;

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
    url: `${API_BASE_PATH}/catalogue`,
    schema: { response: { 200: CatalogueResponseSchema } },
  },
  products: {
    method: "GET",
    url: `${API_BASE_PATH}/products`,
    schema: { querystring: ProductsQuerySchema, response: { 200: ProductsResponseSchema } },
  },
  offers: {
    method: "GET",
    url: `${API_BASE_PATH}/products/:id/offers`,
    schema: {
      params: OffersParamsSchema,
      querystring: OffersQuerySchema,
      response: { 200: OffersResponseSchema },
    },
  },
  compare: {
    method: "POST",
    url: `${API_BASE_PATH}/basket/compare`,
    schema: { body: BasketCompareRequestSchema, response: { 200: BasketCompareResponseSchema } },
  },
  /**
   * Always answers 204 with no body, whatever happened, following the GA
   * Measurement Protocol. A client cannot act on a tracking failure, so there
   * is nothing useful to tell it; failures are logged server side and reported
   * from there (#22). This is the one route that does not use `ErrorResponse`.
   */
  outboundClick: {
    method: "POST",
    url: `${API_BASE_PATH}/events/outbound-click`,
    schema: { body: OutboundClickRequestSchema, response: { 204: Type.Null() } },
  },
} as const;
