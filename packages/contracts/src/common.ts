import { type Static, Type } from "@sinclair/typebox";
import { closedObject, nullable } from "./schema.ts";

/** Opaque, case-sensitive IDs; never infer dates or product identity from them. */
export const IdSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
});
export const CentsSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
export const PositiveCentsSchema = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
export const QuantitySchema = Type.Integer({ minimum: 1, maximum: 20 });
export const RetailerIdSchema = Type.Union([
  Type.Literal("redmart"),
  Type.Literal("fairprice"),
  Type.Literal("cold-storage"),
]);
export type RetailerId = Static<typeof RetailerIdSchema>;

export const SNAPSHOT_DISCLAIMER =
  "Prototype using a fixed retailer dataset. Prices and availability may have changed. Confirm details on the retailer's website.";
export const DatasetReferenceSchema = closedObject({
  datasetId: IdSchema,
  deliveryRuleVersion: IdSchema,
  dataKind: Type.Union([Type.Literal("curated"), Type.Literal("synthetic")]),
});
export type DatasetReference = Static<typeof DatasetReferenceSchema>;

export const BasketLineSchema = closedObject({ productId: IdSchema, quantity: QuantitySchema });
export type BasketLine = Static<typeof BasketLineSchema>;

export const ExcludedPromotionSchema = closedObject({
  description: Type.String({ minLength: 1 }),
  reason: Type.Union([
    Type.Literal("unverified_terms"),
    Type.Literal("unsupported_conditions"),
    Type.Literal("multibuy_not_adopted"),
  ]),
});

export const ProductSchema = closedObject({
  productId: IdSchema,
  categoryId: IdSchema,
  name: Type.String({ minLength: 1 }),
  brand: Type.String({ minLength: 1 }),
  variant: Type.String({ minLength: 1 }),
  pack: closedObject({
    /** Count of contained units in one purchasable pack, not requested packs. */
    unitCount: Type.Integer({ minimum: 1 }),
    sizePerUnit: Type.String({ minLength: 1 }),
    unit: Type.String({ minLength: 1 }),
    display: Type.String({ minLength: 1 }),
  }),
  imageUrl: nullable(Type.String({ pattern: "^https://", maxLength: 2048 })),
});
export type Product = Static<typeof ProductSchema>;
