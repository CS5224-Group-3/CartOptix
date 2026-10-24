import type { Multibuy, Offer } from "@cartoptix/contracts";
import { multiplyCents, type OfferRule, type PricedLine, priceLine } from "../pricing/index.ts";

/** A priced line's deal on the wire; shared with basket comparison. */
export function toWireMultibuy({ multibuy }: PricedLine): Multibuy | null {
  return (
    multibuy && {
      packsPerDeal: multibuy.packsPerDeal,
      dealPriceCents: multibuy.dealPrice,
      mixAndMatch: multibuy.mixAndMatch,
      percentOff: multibuy.percentOff,
      timesApplied: multibuy.deals,
      savingCents: multibuy.saving,
    }
  );
}

/** Price a product offer through the same rules used by basket comparison.
 * Returns null when the listing is ineligible or cannot be priced. */
export function priceOffer(
  offer: OfferRule,
  listing: Pick<Offer, "productUrl" | "originalPriceCents">,
  quantity: number,
): Offer | null {
  const result = priceLine({ offer, packs: quantity });
  if (result.status !== "priced") return null;

  const itemCharges = offer.charges.flatMap(({ label, amount, includedInPrice }) =>
    amount === null
      ? []
      : [{ label, amountCents: multiplyCents(amount, quantity), includedInPrice }],
  );
  if (itemCharges.length !== offer.charges.length) return null;

  return {
    retailerId: offer.retailerId,
    listingId: offer.listingId,
    productUrl: listing.productUrl,
    priceKind: offer.priceKind,
    unitPriceCents: offer.unitPrice,
    originalPriceCents: listing.originalPriceCents,
    multibuy: toWireMultibuy(result.line),
    itemCharges,
    lineTotalCents: result.line.total,
    excludedPromotions: result.line.disclosures
      .filter((disclosure) => disclosure.code === "promotion-excluded")
      .map((disclosure) => disclosure.detail),
  };
}
