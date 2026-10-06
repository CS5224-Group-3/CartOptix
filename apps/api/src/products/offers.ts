import type { Offer } from "@cartoptix/contracts";
import { multiplyCents, type OfferRule, priceLine } from "../pricing/index.ts";

/** Price a product offer through the same rules used by basket comparison.
 * Returns null when the listing is ineligible or cannot be priced. */
export function priceOffer(offer: OfferRule, productUrl: string, quantity: number): Offer | null {
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
    productUrl,
    priceKind: offer.priceKind,
    unitPriceCents: offer.unitPrice,
    itemCharges,
    lineTotalCents: result.line.total,
    excludedPromotions: result.line.disclosures
      .filter((disclosure) => disclosure.code === "promotion-excluded")
      .map((disclosure) => disclosure.detail),
  };
}
