import type { Cents } from "@cartoptix/contracts";

/**
 * The seed-shaped inputs the pricing module calculates from.
 *
 * These mirror the logical data model (technical spec section 3) as the pricing
 * kernel needs it, not as the database stores it. They never cross the HTTP
 * boundary, so they stay here rather than in `@cartoptix/contracts`; the data
 * workstream (#4) owns how rows become these values.
 *
 * Every rule here is already *verified by curation*. This module applies rules;
 * it does not judge evidence. What it will not do is invent a value curation
 * left unresolved — hence the explicit `null`s below, which mean "unresolved"
 * and force an unavailable result rather than a zero.
 */

/** A retailer's listing of one canonical product, priced for this dataset. */
export interface OfferRule {
  listingId: string;
  productId: string;
  retailerId: string;
  /**
   * Verified ordinary or unconditional sale price for one pack.
   *
   * This is the price a shopper actually pays today. Any source "original
   * price" or "savings" text is descriptive evidence only and is deliberately
   * absent from this type, so no code path can subtract a discount twice
   * (PR-03).
   */
  unitPrice: Cents;
  /** False when curation excluded the offer; such an offer has no usable price. */
  eligible: boolean;
  /** Charges that apply per pack of this listing. */
  charges: MandatoryChargeRule[];
  /**
   * Promotions the source described but curation did not approve.
   *
   * Present so the shopper can be told an extra promotion exists but is not
   * reflected in the price (PR-03).
   */
  excludedPromotions: ExcludedPromotionRule[];
}

/**
 * A mandatory charge such as a beverage container deposit.
 *
 * `includedInPrice` is what prevents double-counting: when the recorded price
 * already contains the deposit, the charge is disclosed but never added
 * (PR-04).
 */
export interface MandatoryChargeRule {
  label: string;
  /** Null when curation could not resolve the amount. Never treated as zero. */
  amount: Cents | null;
  includedInPrice: boolean;
}

export interface ExcludedPromotionRule {
  /** Curation's shopper-facing reason, for example "multibuy terms unverified". */
  detail: string;
}

/**
 * An approved same-product multibuy: N qualifying packs for a fixed price.
 *
 * Multibuys are optional for the MVP (PR-03) and none is approved yet, so in
 * practice no offer carries one. The rule is modelled and tested now so that
 * adopting one later is a data change rather than a code change.
 *
 * The bundle price is charged whole. Nothing divides it by `packsPerBundle`,
 * so no rounding rule is needed and none is invented (section 4).
 */
export interface BundlePromotionRule {
  listingId: string;
  /** Packs that must be bought together to trigger `bundlePrice`. */
  packsPerBundle: number;
  /** Price for one whole bundle. */
  bundlePrice: Cents;
  /**
   * How many bundles one order may claim. Null means no verified cap.
   *
   * Unlimited repetition is never inferred from "Any N" wording; a null here
   * means curation verified that no cap applies (PR-03).
   */
  maxBundles: number | null;
  /**
   * Dataset this rule was approved for.
   *
   * Eligibility comes from the approved seed, never the runtime clock, so the
   * same basket and seed price identically as the calendar advances (PR-03).
   */
  datasetId: string;
  /**
   * Validity wording captured from the source, kept as internal provenance.
   *
   * It is never parsed, compared against a date, or shown to a shopper: doing
   * so would turn captured text into a live-validity claim (PR-03, PR-06).
   */
  capturedValidityTerms?: string;
}

/**
 * One retailer's delivery rule for the single documented Singapore scenario:
 * a declared serviceable location, standard delivery, non-member pricing
 * (PR-04).
 */
export interface DeliveryRule {
  retailerId: string;
  datasetId: string;
  /**
   * False when the rule for this scenario is not verified.
   *
   * An unverified rule makes a complete total impossible for that retailer. It
   * must never be read as free delivery (PR-04).
   */
  verified: boolean;
  /** Standard delivery fee. Null means unresolved, never free. */
  fee: Cents | null;
  /** Spend at or above which delivery is free. Null when none is offered. */
  freeDeliveryThreshold: Cents | null;
  /** Order value the retailer requires before it will deliver at all. */
  minimumOrder: Cents | null;
  /** Which amount the retailer measures against its thresholds. */
  thresholdBasis: ThresholdBasis;
  /** Verified order-level charges that are not the delivery fee. */
  orderCharges: MandatoryChargeRule[];
}

/**
 * What a retailer counts toward its free-delivery threshold and minimum order.
 *
 * Retailers differ here, so each rule carries its own basis rather than the
 * module assuming a shared convention (PR-04).
 */
export interface ThresholdBasis {
  /**
   * `paid` counts what the shopper pays for items.
   *
   * `undiscounted` counts the packs at their per-pack price before any bundle
   * promotion this module applied. It does not mean the source "original
   * price" column, which is descriptive evidence and is never used to compute
   * anything (PR-03).
   */
  amount: "paid" | "undiscounted";
  /** Whether mandatory item charges count toward the thresholds. */
  includesMandatoryCharges: boolean;
}
