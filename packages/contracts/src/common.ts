import Type, { type Static } from "typebox";
import { closedObject, nullable } from "./schema.ts";

/** Opaque, case-sensitive ID. Never infer dates or product identity from it. */
export const IdSchema = Type.String({ minLength: 1, maxLength: 128 });
export const CentsSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
/** Basket limits (J2), shared so the web client enforces the same bounds as the API. */
export const MAX_BASKET_LINES = 50;
export const MIN_PACKS_PER_LINE = 1;
export const MAX_PACKS_PER_LINE = 20;
export const MIN_RETAILER_LIMIT = 1;
export const MAX_RETAILER_LIMIT = 3;

/** Whole packs of one product. */
export const QuantitySchema = Type.Integer({
  minimum: MIN_PACKS_PER_LINE,
  maximum: MAX_PACKS_PER_LINE,
});
export const RetailerIdSchema = Type.Union([
  Type.Literal("redmart"),
  Type.Literal("fairprice"),
  Type.Literal("cold-storage"),
]);
export type RetailerId = Static<typeof RetailerIdSchema>;

/** Shown near every comparison (PR-06). A constant, so it is not repeated in responses. */
export const SNAPSHOT_DISCLAIMER =
  "Prototype using a fixed retailer dataset. Prices and availability may have changed. Confirm details on the retailer's website.";

export const ProductSchema = closedObject({
  productId: IdSchema,
  categoryId: IdSchema,
  name: Type.String({ minLength: 1 }),
  brand: Type.String({ minLength: 1 }),
  variant: Type.String({ minLength: 1 }),
  /** Exact pack configuration as displayed, e.g. "2 × 180 g". */
  packSize: Type.String({ minLength: 1 }),
  imageUrl: nullable(Type.String()),
});
export type Product = Static<typeof ProductSchema>;

/** A mandatory charge on a line, e.g. a deposit. `includedInPrice` charges are
 * already part of `lineTotalCents` and are shown for disclosure only. */
export const ItemChargeSchema = closedObject({
  label: Type.String({ minLength: 1 }),
  amountCents: CentsSchema,
  includedInPrice: Type.Boolean(),
});

/** A fixed charge on a whole retailer order, e.g. a bag fee. */
export const OrderChargeSchema = closedObject({
  label: Type.String({ minLength: 1 }),
  amountCents: CentsSchema,
});

/** Cost of the requested packs at one retailer, before delivery. */
const lineCost = {
  listingId: IdSchema,
  productUrl: Type.String({ minLength: 1 }),
  priceKind: Type.Union([Type.Literal("ordinary"), Type.Literal("unconditional_sale")]),
  unitPriceCents: CentsSchema,
  itemCharges: Type.Array(ItemChargeSchema),
  lineTotalCents: CentsSchema,
  /** Promotions seen but not applied, e.g. unverified multibuys. */
  excludedPromotions: Type.Array(Type.String({ minLength: 1 })),
};

export const OfferSchema = closedObject({ retailerId: RetailerIdSchema, ...lineCost });
export type Offer = Static<typeof OfferSchema>;

export const PlanLineSchema = closedObject({
  productId: IdSchema,
  quantity: QuantitySchema,
  ...lineCost,
});
export type PlanLine = Static<typeof PlanLineSchema>;
