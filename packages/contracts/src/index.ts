/**
 * Types exchanged between apps/api and apps/web.
 *
 * Every shape crossing the HTTP boundary is declared here once, so neither side
 * redefines the other's payloads. See AGENTS.md for the contract-first workflow.
 *
 * This package currently exports types only. Runtime values (for example request
 * validation schemas) may be added later; the build already emits JavaScript.
 */

/** Base path for the versioned HTTP API. */
export const API_BASE_PATH = "/api/v1";

/** Whether the API process is running. */
export interface LivenessResponse {
  status: "ok";
}

/** Whether the API can serve requests, including its PostgreSQL dependency. */
export interface ReadinessResponse {
  /** "ok" only when every checked dependency is reachable. */
  status: "ok" | "unavailable";
  checks: {
    /** Result of a real query against PostgreSQL, not a connection guess. */
    database: DependencyCheck;
  };
}

export interface DependencyCheck {
  status: "ok" | "unavailable";
  /** Populated only when the check fails, for operator diagnosis. */
  detail?: string;
}

// ---------------------------------------------------------------------------
// Pricing
//
// Shapes returned by the shared pricing module and rendered by the web client:
// product-offer comparison and basket comparison both explain a price with
// these types. Drafted here for issue #8; issue #5 owns the surrounding route
// contracts and may fold this section into a wider schema.
//
// The module's *inputs* (seed offers, promotions, delivery rules) never cross
// the HTTP boundary and are deliberately not declared here.
// ---------------------------------------------------------------------------

/**
 * A monetary amount in whole Singapore cents.
 *
 * Every calculation uses integers (PR-05). Dollars and floating point never
 * appear in a payload, because repeated float arithmetic cannot represent
 * cents exactly and a basket sums many lines.
 */
export type Cents = number;

/** Maximum distinct product lines in one basket. */
export const MAX_BASKET_LINES = 50;

/** Inclusive range of whole packs a single line may request. */
export const MIN_PACKS_PER_LINE = 1;
export const MAX_PACKS_PER_LINE = 20;

/** Inclusive range a shopper may choose as their maximum retailer count. */
export const MIN_RETAILER_LIMIT = 1;
export const MAX_RETAILER_LIMIT = 3;

/**
 * Something true of a price that the shopper must be told.
 *
 * Disclosures are how the product rules stay honest: a promotion we could not
 * verify is disclosed rather than silently applied or silently dropped
 * (PR-03).
 */
export interface PricingDisclosure {
  code: PricingDisclosureCode;
  /** Shopper-facing sentence, supplied by curation rather than composed here. */
  detail: string;
}

export type PricingDisclosureCode =
  /** The source data described a promotion whose terms were not verified. */
  | "promotion-excluded"
  /** A verified mandatory charge is already inside the recorded price. */
  | "charge-included-in-price";

/** How the cost of one line's packs was reached. */
export type PackPricing =
  /** Packs charged individually at the verified ordinary or sale price. */
  | {
      kind: "unit";
      packs: number;
      unitPrice: Cents;
      amount: Cents;
    }
  /**
   * Whole bundles at a fixed bundle price. Bundles are never divided into a
   * per-pack price, so no fractional cent can arise (section 4).
   */
  | {
      kind: "bundle";
      bundles: number;
      /** Packs in one bundle. */
      packsPerBundle: number;
      bundlePrice: Cents;
      amount: Cents;
    };

/** A verified mandatory charge added on top of the recorded price. */
export interface AppliedCharge {
  /** Curation's description, for example "Beverage container deposit". */
  label: string;
  /** Amount for one pack, or null for a charge levied once per order. */
  perPack: Cents | null;
  amount: Cents;
}

/** The cost of one product line at one retailer, with its explanation. */
export interface PricedLine {
  productId: string;
  retailerId: string;
  listingId: string;
  packs: number;
  /** Cost of the packs themselves, before charges the price excludes. */
  packsSubtotal: Cents;
  /** Every segment of `packsSubtotal`, in the order it was applied. */
  packsBreakdown: PackPricing[];
  /**
   * What the packs would have cost at the per-pack price, with no bundle
   * applied. Equal to `packsSubtotal` unless a bundle promotion was applied.
   *
   * This is the module's own arithmetic, not the source "original price" or
   * "savings" text, which are descriptive evidence and never priced (PR-03).
   * Retailers whose thresholds measure an undiscounted amount use this.
   */
  undiscountedPacksSubtotal: Cents;
  /** Charges added because the recorded price does not already include them. */
  appliedCharges: AppliedCharge[];
  /** `packsSubtotal` plus every applied charge. */
  total: Cents;
  disclosures: PricingDisclosure[];
}

/** What the shopper pays to have one retailer's order delivered. */
export interface DeliveryCharge {
  amount: Cents;
  /** True when the order reached the retailer's free-delivery threshold. */
  free: boolean;
  /** Null when the retailer offers no free-delivery threshold. */
  freeThreshold: Cents | null;
  /** The amount measured against the threshold, which may exclude charges. */
  measuredAmount: Cents;
}

/** One retailer's complete order: its lines, its charges and its total. */
export interface PricedRetailerOrder {
  retailerId: string;
  lines: PricedLine[];
  /** Sum of every line total. */
  itemsTotal: Cents;
  delivery: DeliveryCharge;
  /** Verified order-level charges that are not delivery, if any. */
  appliedCharges: AppliedCharge[];
  /** `itemsTotal` plus delivery plus order-level charges. */
  total: Cents;
  /** Line disclosures merged with any raised by the order's own rules. */
  disclosures: PricingDisclosure[];
}

/**
 * Why a retailer cannot fulfil this order as requested.
 *
 * This is a property of the basket, not of the data: the same retailer priced
 * a different basket successfully. The optimiser rejects such a candidate and
 * may report `proven_infeasible` (section 4).
 */
export interface OrderInfeasibility {
  code: "minimum-order-not-met";
  detail: string;
  /** Extra spend that would satisfy the retailer's minimum order. */
  shortfall: Cents;
}

/**
 * Why no total could be calculated at all.
 *
 * An unverified delivery rule or an unresolved mandatory charge must never
 * become zero, because a zero would understate a total and could support a
 * fabricated savings claim (PR-04).
 */
export interface PricingUnavailable {
  code: PricingUnavailableCode;
  detail: string;
}

export type PricingUnavailableCode =
  /** The retailer's delivery rule for the recorded scenario is unverified. */
  | "delivery-rule-unverified"
  /** A mandatory charge applies but its amount is unresolved. */
  | "charge-unresolved"
  /** The offer is not eligible for use, so it has no usable price. */
  | "offer-ineligible"
  /** The request itself is outside the supported limits. */
  | "invalid-request";

/** The result of pricing one line: a price, or an explained absence of one. */
export type LinePricingResult =
  | { status: "priced"; line: PricedLine }
  | { status: "unavailable"; reason: PricingUnavailable };

/**
 * The result of pricing one retailer's order.
 *
 * `infeasible` and `unavailable` stay distinct so the API can tell a proven
 * blocker apart from missing data (section 4, result semantics).
 */
export type RetailerOrderPricingResult =
  | { status: "priced"; order: PricedRetailerOrder }
  | { status: "infeasible"; reason: OrderInfeasibility }
  | { status: "unavailable"; reason: PricingUnavailable };
