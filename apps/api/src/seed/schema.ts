/**
 * The curated seed file: the input to `importSeed`, not an HTTP payload.
 *
 * It holds what technical spec section 5 requires the seed to supply, and
 * reuses the contract's ID, URL and money schemas so seed values are valid API
 * values. Checks JSON Schema cannot express (references, uniqueness, link hosts)
 * are in `validate.ts`.
 */
import {
  CentsSchema,
  HttpsUrlSchema,
  IdSchema,
  PositiveCentsSchema,
  RetailerIdSchema,
} from "@cartoptix/contracts";
import Type, { type Static, type TProperties } from "typebox";

export const SEED_SCHEMA_VERSION = 1;

const closed = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const text = Type.String({ minLength: 1 });
const nullableCents = Type.Union([CentsSchema, Type.Null()]);

const VerifiedDeliveryRule = closed({
  retailerId: RetailerIdSchema,
  status: Type.Literal("verified"),
  deliveryFeeCents: CentsSchema,
  /** Null means no free-delivery threshold is offered. */
  freeDeliveryFromCents: nullableCents,
  /** Null means no minimum order. */
  minimumOrderCents: nullableCents,
  /** Whether mandatory item charges count toward the thresholds (pricing module). */
  thresholdIncludesMandatoryCharges: Type.Boolean(),
  orderCharges: Type.Array(
    closed({
      label: text,
      amountCents: CentsSchema,
      /** Spend at or above which the charge is waived; null if never waived. */
      waivedFromCents: nullableCents,
    }),
  ),
  note: text,
  /** Where the rule was verified; internal evidence, never shown. */
  sources: Type.Array(HttpsUrlSchema, { minItems: 1 }),
});

const UnverifiedDeliveryRule = closed({
  retailerId: RetailerIdSchema,
  status: Type.Literal("unverified"),
  note: Type.Optional(text),
});

export const SeedSchema = closed({
  schemaVersion: Type.Literal(SEED_SCHEMA_VERSION),
  retailers: Type.Array(
    closed({
      retailerId: RetailerIdSchema,
      name: text,
      /** Hosts a product link may use, e.g. "www.fairprice.com.sg". */
      productUrlHosts: Type.Array(text, { minItems: 1 }),
    }),
  ),
  categories: Type.Array(closed({ categoryId: IdSchema, name: text })),
  delivery: closed({
    rules: Type.Array(Type.Union([VerifiedDeliveryRule, UnverifiedDeliveryRule])),
  }),
  products: Type.Array(
    closed({
      productId: IdSchema,
      categoryId: IdSchema,
      representativeName: text,
      imageUrl: Type.Union([HttpsUrlSchema, Type.Null()]),
    }),
    { minItems: 1 },
  ),
  /** Published listings only, each with its eligible offer. */
  listings: Type.Array(
    closed({
      listingId: IdSchema,
      productId: IdSchema,
      retailerId: RetailerIdSchema,
      /** Provenance back to the source export row. */
      sourceRecordId: text,
      name: text,
      specification: text,
      productUrl: HttpsUrlSchema,
      priceKind: Type.Union([Type.Literal("ordinary"), Type.Literal("unconditional_sale")]),
      unitPriceCents: PositiveCentsSchema,
      excludedPromotions: Type.Array(text),
    }),
    { minItems: 1 },
  ),
});

export type Seed = Static<typeof SeedSchema>;
