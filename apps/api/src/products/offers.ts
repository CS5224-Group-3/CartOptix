import type { Offer } from "@cartoptix/contracts";

export function priceOffer(offer: Offer, quantity: number): Offer {
  const additionalCharges = offer.itemCharges
    .filter((charge) => !charge.includedInPrice)
    .reduce((total, charge) => total + charge.amountCents, 0);
  return { ...offer, lineTotalCents: offer.unitPriceCents * quantity + additionalCharges };
}
