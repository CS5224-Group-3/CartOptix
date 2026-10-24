import { MAX_PACKS_PER_LINE, MIN_PACKS_PER_LINE } from "@cartoptix/contracts";
import { isCents, multiplyCents, sumCents } from "./money.ts";
import {
  type AppliedCharge,
  type LineMultibuy,
  type LinePricingResult,
  type PackPricing,
  PricingContractError,
  type PricingDisclosure,
} from "./results.ts";
import type { OfferRule } from "./rules.ts";

/**
 * Cost of one product line at one retailer.
 *
 * Pure and synchronous: the same inputs always produce the same output, and
 * nothing here reads the clock, the database or the environment. Both product
 * offer comparison and basket comparison call this, so a price shown next to
 * an offer is the same price the basket total is built from.
 *
 * Scope is the verified ordinary or unconditional sale price, plus the
 * listing's same-product multibuy when the line has enough packs (PR-03).
 */

export interface PriceLineInput {
  offer: OfferRule;
  /** Whole packs requested, within the supported range. */
  packs: number;
}

export function priceLine({ offer, packs }: PriceLineInput): LinePricingResult {
  // A quantity outside the supported range is a caller mistake, not a pricing
  // outcome: the API validates it against the request schema first.
  if (!Number.isInteger(packs) || packs < MIN_PACKS_PER_LINE || packs > MAX_PACKS_PER_LINE) {
    throw new PricingContractError(
      `A line must request ${MIN_PACKS_PER_LINE}–${MAX_PACKS_PER_LINE} whole packs, not ${packs}`,
    );
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

  const multibuy = lineMultibuy(offer, packs);
  const dealPacks = multibuy ? multibuy.deals * multibuy.packsPerDeal : 0;
  const packsBreakdown: PackPricing[] = [];
  if (multibuy && multibuy.deals > 0) {
    packsBreakdown.push({
      kind: "multibuy",
      deals: multibuy.deals,
      packsPerDeal: multibuy.packsPerDeal,
      dealPrice: multibuy.dealPrice,
      amount: multiplyCents(multibuy.dealPrice, multibuy.deals),
    });
  }
  if (packs > dealPacks) {
    packsBreakdown.push({
      kind: "unit",
      packs: packs - dealPacks,
      unitPrice: offer.unitPrice,
      amount: multiplyCents(offer.unitPrice, packs - dealPacks),
    });
  }
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
      priceKind: offer.priceKind,
      unitPrice: offer.unitPrice,
      packs,
      multibuy,
      packsSubtotal,
      packsBreakdown,
      appliedCharges: charges.applied,
      total: packsSubtotal + sumCents(charges.applied.map((charge) => charge.amount)),
      disclosures,
    },
  };
}

/**
 * Whole deals in the line, counted against this listing's packs only (PR-03).
 * A deal that is not cheaper than its packs at the unit price is ignored;
 * curation should already have excluded it.
 */
function lineMultibuy(offer: OfferRule, packs: number): LineMultibuy | null {
  const rule = offer.multibuy;
  if (!rule) return null;
  const { packsPerDeal, dealPrice } = rule;
  if (
    !Number.isInteger(packsPerDeal) ||
    packsPerDeal < 2 ||
    !isCents(dealPrice) ||
    dealPrice <= 0
  ) {
    throw new PricingContractError(`Offer ${offer.listingId} has an invalid multibuy`);
  }
  if (offer.priceKind === "unconditional_sale") {
    throw new PricingContractError(`Offer ${offer.listingId} stacks a multibuy on a sale price`);
  }
  const perDealSaving = multiplyCents(offer.unitPrice, packsPerDeal) - dealPrice;
  if (perDealSaving <= 0) return null;
  const deals = Math.floor(packs / packsPerDeal);
  return {
    packsPerDeal,
    dealPrice,
    mixAndMatch: rule.mixAndMatch,
    deals,
    saving: multiplyCents(perDealSaving, deals),
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
