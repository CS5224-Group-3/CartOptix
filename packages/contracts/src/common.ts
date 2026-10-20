import Type, { type Static } from "typebox";
import { closedObject, nullable } from "./schema.ts";

/** Base path for the versioned HTTP API. */
export const API_BASE_PATH = "/api/v1";

/**
 * Opaque, case-sensitive ID. Never infer dates or product identity from it.
 * Limited to URL-safe characters because product IDs appear in request paths.
 */
export const IdSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._~-]*$",
});
export const CentsSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
/** A usable price: the spec rejects zero prices as purchasable offers. */
export const PositiveCentsSchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });

/** Rendered as an href or src, so only https links are accepted. The API does not
 * validate most responses, so the importer (#4) must also check each product
 * link against its retailer's allowed domains. */
export const HttpsUrlSchema = Type.String({ pattern: "^https://", maxLength: 2048 });
/** Basket limits (J2), shared so the web client enforces the same bounds as the API. */
export const MAX_BASKET_LINES = 50;
export const MIN_PACKS_PER_LINE = 1;
export const MAX_PACKS_PER_LINE = 20;

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

/** Shown near every comparison. BCRS container deposits are not modelled in the MVP:
 * the same 10¢ per container applies at every retailer, so it cannot change which retailer
 * wins, but totals would otherwise understate checkout. */
export const DEPOSIT_NOTICE =
  "Totals exclude the refundable 10¢ container deposit charged at checkout.";

export const ProductSchema = closedObject({
  productId: IdSchema,
  categoryId: IdSchema,
  /** Display name, carrying brand and variant, e.g. "Kellogg's Rice Krispies Cereal 130g".
   * The API derives it from the seed's representative listing name. */
  name: Type.String({ minLength: 1 }),
  /** Exact pack configuration as displayed, e.g. "900 g" or "100 x 2g". The API
   * derives it from normalized eligible listing specifications. */
  packSize: Type.String({ minLength: 1 }),
  /** False when the curated product has no published retailer listing. */
  available: Type.Boolean(),
  imageUrl: nullable(HttpsUrlSchema),
});
export type Product = Static<typeof ProductSchema>;

/**
 * A mandatory charge on a line, e.g. a deposit, as a total for the line's packs.
 * `includedInPrice: true` means the unit price already contains it, so it is shown
 * but not added; `false` means it is added on top of the unit price.
 */
export const ItemChargeSchema = closedObject({
  label: Type.String({ minLength: 1 }),
  amountCents: CentsSchema,
  includedInPrice: Type.Boolean(),
});

/**
 * A fixed charge on a whole retailer order, e.g. a service fee. A waived charge is
 * shown but not added to the order total, so the breakdown still reconciles.
 */
export const OrderChargeSchema = closedObject({
  label: Type.String({ minLength: 1 }),
  /** The charge's normal amount, even when waived. */
  amountCents: CentsSchema,
  /** Qualifying spend at or above which the charge is waived; null if never waived. */
  waivedFromCents: nullable(CentsSchema),
  /** Whether this order reached the waiver threshold. The API decides, because the
   * qualifying-spend basis is a pricing rule, not a display rule. */
  waived: Type.Boolean(),
});
export type OrderCharge = Static<typeof OrderChargeSchema>;

/** Cost of the requested packs at one retailer, before delivery. */
const lineCost = {
  listingId: IdSchema,
  productUrl: HttpsUrlSchema,
  priceKind: Type.Union([Type.Literal("ordinary"), Type.Literal("unconditional_sale")]),
  unitPriceCents: PositiveCentsSchema,
  /** The pre-sale price of an `unconditional_sale` listing, shown struck through;
   * null for ordinary prices. Display only: totals never use it (PR-03). */
  originalPriceCents: nullable(PositiveCentsSchema),
  itemCharges: Type.Array(ItemChargeSchema),
  /** Unit price × quantity, plus every charge with `includedInPrice: false`. */
  lineTotalCents: PositiveCentsSchema,
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
