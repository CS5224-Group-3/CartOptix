import { type Static, Type } from "@sinclair/typebox";
import {
  BasketLineSchema,
  CentsSchema,
  DatasetReferenceSchema,
  IdSchema,
  ProductSchema,
  QuantitySchema,
  RetailerIdSchema,
  SNAPSHOT_DISCLAIMER,
} from "./common.ts";
import { DeliveryRuleAvailabilitySchema, PricedLineSchema, PricedOrderSchema } from "./pricing.ts";
import { closedObject, nullable } from "./schema.ts";

export const CatalogueResponseSchema = closedObject({
  dataset: DatasetReferenceSchema,
  currency: Type.Literal("SGD"),
  disclaimer: Type.Literal(SNAPSHOT_DISCLAIMER),
  retailers: Type.Array(
    closedObject({ retailerId: RetailerIdSchema, name: Type.String({ minLength: 1 }) }),
    { minItems: 3, maxItems: 3 },
  ),
  categories: Type.Array(
    closedObject({ categoryId: IdSchema, name: Type.String({ minLength: 1 }) }),
    {
      minItems: 8,
      maxItems: 8,
    },
  ),
  deliveryScenario: closedObject({
    scenarioId: IdSchema,
    location: Type.String({ minLength: 1 }),
    service: Type.String({ minLength: 1 }),
    membership: Type.Literal("non_member"),
    rules: Type.Array(DeliveryRuleAvailabilitySchema, { minItems: 3, maxItems: 3 }),
  }),
  pricing: closedObject({
    supported: Type.Array(
      Type.Union([Type.Literal("ordinary"), Type.Literal("unconditional_sale")]),
      { minItems: 2, maxItems: 2, uniqueItems: true },
    ),
    excluded: Type.Array(Type.String({ minLength: 1 })),
  }),
});
export type CatalogueResponse = Static<typeof CatalogueResponseSchema>;

export const ProductsQuerySchema = closedObject({
  datasetId: IdSchema,
  q: Type.Optional(Type.String({ minLength: 1, maxLength: 100, pattern: "\\S" })),
  categoryId: Type.Optional(IdSchema),
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000000, default: 1 })),
  pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
});
export type ProductsQuery = Static<typeof ProductsQuerySchema>;
export const ProductsResponseSchema = closedObject({
  dataset: DatasetReferenceSchema,
  products: Type.Array(ProductSchema, { maxItems: 100 }),
  pagination: closedObject({
    page: Type.Integer({ minimum: 1, maximum: 1000000 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    total: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  }),
});
export type ProductsResponse = Static<typeof ProductsResponseSchema>;

export const OffersParamsSchema = closedObject({ id: IdSchema });
export const OffersQuerySchema = closedObject({ datasetId: IdSchema, quantity: QuantitySchema });
export type OffersParams = Static<typeof OffersParamsSchema>;
export type OffersQuery = Static<typeof OffersQuerySchema>;
export const OffersResponseSchema = closedObject({
  dataset: DatasetReferenceSchema,
  product: ProductSchema,
  quantity: QuantitySchema,
  currency: Type.Literal("SGD"),
  disclaimer: Type.Literal(SNAPSHOT_DISCLAIMER),
  offers: Type.Array(
    closedObject({
      listingId: IdSchema,
      retailerId: RetailerIdSchema,
      productUrl: Type.String({ pattern: "^https://", maxLength: 2048 }),
      pricing: PricedLineSchema,
    }),
  ),
});
export type OffersResponse = Static<typeof OffersResponseSchema>;

export const BasketCompareRequestSchema = closedObject({
  datasetId: IdSchema,
  lines: Type.Array(BasketLineSchema, { minItems: 1, maxItems: 50 }),
  maxRetailers: Type.Integer({ minimum: 1, maximum: 3 }),
});
export type BasketCompareRequest = Static<typeof BasketCompareRequestSchema>;

/** Run after structural validation. JSON Schema uniqueItems cannot reject the
 * same product appearing twice with different quantities. */
export function duplicateProductIds(request: BasketCompareRequest): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const line of request.lines) {
    if (seen.has(line.productId)) duplicates.add(line.productId);
    seen.add(line.productId);
  }
  return [...duplicates];
}

export const PlanSchema = closedObject({
  orders: Type.Array(PricedOrderSchema, { minItems: 1, maxItems: 3 }),
  retailerCount: Type.Integer({ minimum: 1, maximum: 3 }),
  totalCents: CentsSchema,
});
export type Plan = Static<typeof PlanSchema>;
const resultContext = {
  dataset: DatasetReferenceSchema,
  request: BasketCompareRequestSchema,
  currency: Type.Literal("SGD"),
  disclaimer: Type.Literal(SNAPSHOT_DISCLAIMER),
};
const baselineAvailable = closedObject({
  status: Type.Literal("available"),
  plan: PlanSchema,
  savingsCents: CentsSchema,
});
const baselineUnavailable = closedObject({
  status: Type.Literal("unavailable"),
  plan: Type.Null(),
  savingsCents: Type.Null(),
  reason: Type.Literal("no_feasible_single_retailer"),
});
export const BasketCompareResponseSchema = Type.Union([
  closedObject({
    ...resultContext,
    status: Type.Literal("best_found"),
    searchLimitReached: Type.Boolean(),
    recommendation: PlanSchema,
    bestSplit: nullable(PlanSchema),
    baseline: Type.Union([baselineAvailable, baselineUnavailable]),
  }),
  closedObject({
    ...resultContext,
    status: Type.Literal("proven_infeasible"),
    recommendation: Type.Null(),
    bestSplit: Type.Null(),
    baseline: baselineUnavailable,
    blocker: closedObject({
      code: Type.Union([
        Type.Literal("no_eligible_offer"),
        Type.Literal("retailer_limit"),
        Type.Literal("exhaustive_check"),
      ]),
      productIds: Type.Array(IdSchema, { uniqueItems: true }),
      explanation: Type.String({ minLength: 1 }),
    }),
  }),
  closedObject({
    ...resultContext,
    status: Type.Literal("no_plan_found"),
    recommendation: Type.Null(),
    bestSplit: Type.Null(),
    baseline: baselineUnavailable,
    searchLimitReached: Type.Boolean(),
    explanation: Type.String({ minLength: 1 }),
  }),
]);
export type BasketCompareResponse = Static<typeof BasketCompareResponseSchema>;

export const ValidationErrorSchema = closedObject({
  error: closedObject({
    code: Type.Literal("invalid_request"),
    message: Type.String({ minLength: 1 }),
    retryable: Type.Literal(false),
    issues: Type.Array(
      closedObject({ path: Type.String(), message: Type.String({ minLength: 1 }) }),
    ),
  }),
});
export const NotFoundErrorSchema = closedObject({
  error: closedObject({
    code: Type.Literal("not_found"),
    message: Type.String({ minLength: 1 }),
    retryable: Type.Literal(false),
  }),
});
export const DatasetConflictSchema = closedObject({
  error: closedObject({
    code: Type.Literal("dataset_conflict"),
    message: Type.String({ minLength: 1 }),
    retryable: Type.Literal(false),
    requestedDatasetId: IdSchema,
    activeDatasetId: IdSchema,
  }),
});
export const ServiceUnavailableErrorSchema = closedObject({
  error: closedObject({
    code: Type.Union([
      Type.Literal("dependency_unavailable"),
      Type.Literal("dataset_unavailable"),
      Type.Literal("capacity_exceeded"),
    ]),
    message: Type.String({ minLength: 1 }),
    retryable: Type.Literal(true),
  }),
});
export const InternalErrorSchema = closedObject({
  error: closedObject({
    code: Type.Union([Type.Literal("calculation_failed"), Type.Literal("internal_error")]),
    message: Type.String({ minLength: 1 }),
    retryable: Type.Literal(true),
  }),
});
export const OperationalErrorSchema = Type.Union([
  ServiceUnavailableErrorSchema,
  InternalErrorSchema,
]);
export const ApiErrorSchema = Type.Union([
  ValidationErrorSchema,
  NotFoundErrorSchema,
  DatasetConflictSchema,
  OperationalErrorSchema,
]);
export type ApiError = Static<typeof ApiErrorSchema>;

export const OutboundClickRequestSchema = closedObject({
  datasetId: IdSchema,
  retailerId: RetailerIdSchema,
  productId: IdSchema,
  listingId: IdSchema,
});
export type OutboundClickRequest = Static<typeof OutboundClickRequestSchema>;
