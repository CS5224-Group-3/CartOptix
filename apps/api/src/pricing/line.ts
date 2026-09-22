import {
  type AppliedCharge,
  type Cents,
  type LinePricingResult,
  MAX_PACKS_PER_LINE,
  MIN_PACKS_PER_LINE,
  type PackPricing,
  type PricingDisclosure,
} from "@cartoptix/contracts";
import { isCents, multiplyCents, sumCents } from "./money.ts";
import type { BundlePromotionRule, OfferRule } from "./rules.ts";

/**
 * Cost of one product line at one retailer.
 *
 * Pure and synchronous: the same inputs always produce the same output, and
 * nothing here reads the clock, the database or the environment. Both product
 * offer comparison and basket comparison call this, so a price shown next to
 * an offer is the same price the basket total is built from.
 */

export interface PriceLineInput {
  offer: OfferRule;
  /** Whole packs requested. */
  packs: number;
  /** The active dataset, used to reject a promotion approved for another seed. */
  datasetId: string;
  /**
   * An approved bundle promotion for this listing, when curation adopted one.
   *
   * No multibuy is approved for the MVP seed yet (PR-03), so this is normally
   * absent and every line is priced at the verified per-pack price.
   */
  bundle?: BundlePromotionRule;
}

export function priceLine(input: PriceLineInput): LinePricingResult {
  const { offer, packs, datasetId } = input;

  if (!Number.isInteger(packs) || packs < MIN_PACKS_PER_LINE || packs > MAX_PACKS_PER_LINE) {
    return {
      status: "unavailable",
      reason: {
        code: "invalid-request",
        detail: `A line must request ${MIN_PACKS_PER_LINE}–${MAX_PACKS_PER_LINE} whole packs, not ${packs}`,
      },
    };
  }

  if (!offer.eligible) {
    return {
      status: "unavailable",
      reason: {
        code: "offer-ineligible",
        detail: `Offer ${offer.listingId} is not eligible for use`,
      },
    };
  }

  // A usable price is strictly positive. A zero or negative price is a data
  // fault, and pricing a line at zero would understate every total built on it.
  if (!isCents(offer.unitPrice) || offer.unitPrice <= 0) {
    return {
      status: "unavailable",
      reason: {
        code: "offer-ineligible",
        detail: `Offer ${offer.listingId} has no usable positive price in cents`,
      },
    };
  }

  const charges = applyCharges(offer, packs);
  if (charges.status === "unavailable") {
    return charges;
  }

  const packsBreakdown = choosePackPricing(offer, packs, datasetId, input.bundle);
  const packsSubtotal = sumCents(packsBreakdown.map((segment) => segment.amount));

  const disclosures: PricingDisclosure[] = [
    ...charges.disclosures,
    ...offer.excludedPromotions.map((promotion): PricingDisclosure => {
      return { code: "promotion-excluded", detail: promotion.detail };
    }),
  ];

  return {
    status: "priced",
    line: {
      productId: offer.productId,
      retailerId: offer.retailerId,
      listingId: offer.listingId,
      packs,
      packsSubtotal,
      packsBreakdown,
      undiscountedPacksSubtotal: multiplyCents(offer.unitPrice, packs),
      appliedCharges: charges.applied,
      total: packsSubtotal + sumCents(charges.applied.map((charge) => charge.amount)),
      disclosures,
    },
  };
}

type ChargeResult =
  | { status: "ok"; applied: AppliedCharge[]; disclosures: PricingDisclosure[] }
  | Extract<LinePricingResult, { status: "unavailable" }>;

/**
 * Splits a listing's mandatory charges into what is added and what is merely
 * disclosed.
 *
 * A charge already inside the recorded price is disclosed but never added,
 * which is what stops a deposit being counted twice (PR-04). A charge whose
 * amount curation could not resolve makes the line unpriceable; it must never
 * fall through as zero.
 */
function applyCharges(offer: OfferRule, packs: number): ChargeResult {
  const applied: AppliedCharge[] = [];
  const disclosures: PricingDisclosure[] = [];

  for (const charge of offer.charges) {
    if (charge.amount === null || !isCents(charge.amount) || charge.amount < 0) {
      return {
        status: "unavailable",
        reason: {
          code: "charge-unresolved",
          detail: `Mandatory charge "${charge.label}" on offer ${offer.listingId} has no resolved amount`,
        },
      };
    }

    if (charge.includedInPrice) {
      disclosures.push({
        code: "charge-included-in-price",
        detail: `${charge.label} is already included in this price`,
      });
      continue;
    }

    applied.push({
      label: charge.label,
      perPack: charge.amount,
      amount: multiplyCents(charge.amount, packs),
    });
  }

  return { status: "ok", applied, disclosures };
}

/**
 * Prices the packs themselves, using a bundle only when it genuinely costs
 * less.
 *
 * The technical spec asks for eligible bundles to be *compared*, not assumed
 * beneficial, and PR-05 forbids returning a more expensive plan than one that
 * exists. So both routes are costed and the cheaper wins; an exact tie keeps
 * the per-pack route, whose explanation is simpler. Bundles are charged whole,
 * with remaining packs at the per-pack price, so nothing is ever divided into
 * a fraction of a cent.
 */
function choosePackPricing(
  offer: OfferRule,
  packs: number,
  datasetId: string,
  bundle: BundlePromotionRule | undefined,
): PackPricing[] {
  const unitOnly: PackPricing[] = [
    {
      kind: "unit",
      packs,
      unitPrice: offer.unitPrice,
      amount: multiplyCents(offer.unitPrice, packs),
    },
  ];

  if (bundle === undefined || !bundleApplies(bundle, offer, datasetId, packs)) {
    return unitOnly;
  }

  const affordableBundles = Math.floor(packs / bundle.packsPerBundle);
  const bundles =
    bundle.maxBundles === null ? affordableBundles : Math.min(affordableBundles, bundle.maxBundles);
  if (bundles < 1) {
    return unitOnly;
  }

  const remainder = packs - bundles * bundle.packsPerBundle;
  const withBundle: PackPricing[] = [
    {
      kind: "bundle",
      bundles,
      packsPerBundle: bundle.packsPerBundle,
      bundlePrice: bundle.bundlePrice,
      amount: multiplyCents(bundle.bundlePrice, bundles),
    },
  ];
  if (remainder > 0) {
    withBundle.push({
      kind: "unit",
      packs: remainder,
      unitPrice: offer.unitPrice,
      amount: multiplyCents(offer.unitPrice, remainder),
    });
  }

  return total(withBundle) < total(unitOnly) ? withBundle : unitOnly;
}

/**
 * Whether an approved bundle rule may be applied to this line.
 *
 * Eligibility is decided entirely by the approved seed: the rule must belong
 * to this listing and this dataset. The rule's captured validity wording is
 * never consulted, and neither is the current date, so advancing the clock
 * cannot activate or expire a promotion (PR-03).
 */
function bundleApplies(
  bundle: BundlePromotionRule,
  offer: OfferRule,
  datasetId: string,
  packs: number,
): boolean {
  return (
    bundle.listingId === offer.listingId &&
    bundle.datasetId === datasetId &&
    Number.isInteger(bundle.packsPerBundle) &&
    bundle.packsPerBundle > 0 &&
    bundle.packsPerBundle <= packs &&
    isCents(bundle.bundlePrice) &&
    bundle.bundlePrice > 0 &&
    (bundle.maxBundles === null || (Number.isInteger(bundle.maxBundles) && bundle.maxBundles > 0))
  );
}

function total(segments: readonly PackPricing[]): Cents {
  return sumCents(segments.map((segment) => segment.amount));
}
