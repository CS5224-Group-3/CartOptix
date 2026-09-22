import { type Static, Type } from "@sinclair/typebox";
import {
  CentsSchema,
  DatasetReferenceSchema,
  ExcludedPromotionSchema,
  IdSchema,
  PositiveCentsSchema,
  QuantitySchema,
  RetailerIdSchema,
} from "./common.ts";
import { closedObject, nullable } from "./schema.ts";

const ChargeTreatmentSchema = Type.Union([
  Type.Literal("included_in_price"),
  Type.Literal("added_to_price"),
]);

/** A fixed charge on a whole retailer order, such as a bag fee. */
export const OrderChargeSchema = closedObject({
  chargeId: IdSchema,
  label: Type.String({ minLength: 1 }),
  amountCents: CentsSchema,
});
export type OrderCharge = Static<typeof OrderChargeSchema>;

/** Verified per-pack charge rule, before it is applied to a requested quantity. */
export const ItemChargeRuleSchema = closedObject({
  chargeId: IdSchema,
  label: Type.String({ minLength: 1 }),
  amountPerPackCents: CentsSchema,
  treatment: ChargeTreatmentSchema,
});
export type ItemChargeRule = Static<typeof ItemChargeRuleSchema>;

/** The same charge multiplied by quantity: a line total, not a per-pack rate. */
export const AppliedItemChargeSchema = closedObject({
  chargeId: IdSchema,
  label: Type.String({ minLength: 1 }),
  amountCents: CentsSchema,
  treatment: ChargeTreatmentSchema,
});
export type AppliedItemCharge = Static<typeof AppliedItemChargeSchema>;

/** Internal adapter contract: only approved, in-stock, direct-fulfilled offers. */
export const OfferPricingInputSchema = closedObject({
  dataset: DatasetReferenceSchema,
  productId: IdSchema,
  listingId: IdSchema,
  retailerId: RetailerIdSchema,
  quantity: QuantitySchema,
  price: closedObject({
    kind: Type.Union([Type.Literal("ordinary"), Type.Literal("unconditional_sale")]),
    unitPriceCents: PositiveCentsSchema,
    /** Verified merchandise amount before discounts, excluding mandatory charges.
     * Required only when a threshold uses this basis; never inferred from Savings. */
    beforeDiscountMerchandiseUnitCents: nullable(PositiveCentsSchema),
    explanation: Type.String({ minLength: 1 }),
  }),
  itemCharges: Type.Array(ItemChargeRuleSchema),
  excludedPromotions: Type.Array(ExcludedPromotionSchema),
});
export type OfferPricingInput = Static<typeof OfferPricingInputSchema>;

export const SpendingBasisSchema = closedObject({
  merchandise: Type.Union([Type.Literal("before_discount"), Type.Literal("after_discount")]),
  includeItemChargeIds: Type.Array(IdSchema, { uniqueItems: true }),
  includeOrderChargeIds: Type.Array(IdSchema, { uniqueItems: true }),
});

const ThresholdSchema = closedObject({ amountCents: CentsSchema, basis: SpendingBasisSchema });
export const DeliveryRuleSchema = closedObject({
  retailerId: RetailerIdSchema,
  ruleId: IdSchema,
  deliveryFeeCents: CentsSchema,
  freeDelivery: nullable(ThresholdSchema),
  minimumOrder: nullable(ThresholdSchema),
  orderCharges: Type.Array(OrderChargeSchema),
  explanation: Type.String({ minLength: 1 }),
});
export type DeliveryRule = Static<typeof DeliveryRuleSchema>;

export const DeliveryRuleAvailabilitySchema = Type.Union([
  closedObject({ status: Type.Literal("verified"), rule: DeliveryRuleSchema }),
  closedObject({
    status: Type.Literal("unavailable"),
    retailerId: RetailerIdSchema,
    reason: Type.Literal("unverified_delivery_rules"),
  }),
]);

export const PricedLineSchema = closedObject({
  productId: IdSchema,
  listingId: IdSchema,
  retailerId: RetailerIdSchema,
  quantity: QuantitySchema,
  priceKind: Type.Union([Type.Literal("ordinary"), Type.Literal("unconditional_sale")]),
  unitPriceCents: PositiveCentsSchema,
  recordedPriceSubtotalCents: CentsSchema,
  merchandiseSubtotalCents: CentsSchema,
  itemCharges: Type.Array(AppliedItemChargeSchema),
  lineTotalCents: CentsSchema,
  explanation: Type.String({ minLength: 1 }),
  excludedPromotions: Type.Array(ExcludedPromotionSchema),
});
export type PricedLine = Static<typeof PricedLineSchema>;

/** Null means no such constraint; it never means an unknown amount or rule. */
const ThresholdAssessmentSchema = nullable(
  closedObject({
    requiredCents: CentsSchema,
    actualCents: CentsSchema,
    met: Type.Boolean(),
  }),
);
export const PricedOrderSchema = closedObject({
  retailerId: RetailerIdSchema,
  ruleId: IdSchema,
  lines: Type.Array(PricedLineSchema, { minItems: 1, maxItems: 50 }),
  merchandiseSubtotalCents: CentsSchema,
  itemChargesCents: CentsSchema,
  orderCharges: Type.Array(OrderChargeSchema),
  deliveryCents: CentsSchema,
  totalCents: CentsSchema,
  minimumOrder: ThresholdAssessmentSchema,
  freeDelivery: ThresholdAssessmentSchema,
});
export type PricedOrder = Static<typeof PricedOrderSchema>;

/** A retailer order is non-empty and contains one retailer and one dataset. */
export const OrderPricingInputSchema = closedObject({
  dataset: DatasetReferenceSchema,
  retailerId: RetailerIdSchema,
  offers: Type.Array(OfferPricingInputSchema, { minItems: 1, maxItems: 50 }),
  delivery: DeliveryRuleAvailabilitySchema,
});
export type OrderPricingInput = Static<typeof OrderPricingInputSchema>;
export const OrderPricingResultSchema = Type.Union([
  closedObject({ status: Type.Literal("priced"), order: PricedOrderSchema }),
  closedObject({
    status: Type.Literal("minimum_not_met"),
    retailerId: RetailerIdSchema,
    requiredCents: CentsSchema,
    actualCents: CentsSchema,
  }),
  closedObject({
    status: Type.Literal("unavailable"),
    retailerId: RetailerIdSchema,
    reason: Type.Union([
      Type.Literal("unverified_delivery_rules"),
      Type.Literal("missing_threshold_basis"),
    ]),
  }),
]);
export type OrderPricingResult = Static<typeof OrderPricingResultSchema>;

/** Implemented by #8; invalid imported data/overflow throws an operational error. */
export interface PricingKernel {
  priceLine(input: OfferPricingInput): PricedLine;
  priceOrder(input: OrderPricingInput): OrderPricingResult;
}
