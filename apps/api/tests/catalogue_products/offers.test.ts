import { describe, expect, it } from "vitest";
import type { OfferRule } from "../../src/pricing/index.ts";
import { priceOffer } from "../../src/products/offers.ts";

const listing = { productUrl: "https://fairprice.com.sg/product/rice", originalPriceCents: null };

const baseOffer: OfferRule = {
  listingId: "offer-rice",
  productId: "rice",
  retailerId: "fairprice",
  priceKind: "ordinary",
  unitPrice: 410,
  eligible: true,
  charges: [
    { label: "Pack deposit", amount: 10, includedInPrice: true },
    { label: "Handling fee", amount: 5, includedInPrice: false },
  ],
  excludedPromotions: [{ detail: "Unverified multibuy terms" }],
};

describe("product offer pricing", () => {
  it("uses shared line pricing and exposes excluded promotion disclosures", () => {
    const offer = priceOffer(baseOffer, listing, 3);

    expect(offer).toEqual({
      retailerId: "fairprice",
      listingId: "offer-rice",
      productUrl: "https://fairprice.com.sg/product/rice",
      priceKind: "ordinary",
      unitPriceCents: 410,
      originalPriceCents: null,
      itemCharges: [
        { label: "Pack deposit", amountCents: 30, includedInPrice: true },
        { label: "Handling fee", amountCents: 15, includedInPrice: false },
      ],
      lineTotalCents: 1245,
      excludedPromotions: ["Unverified multibuy terms"],
    });
  });

  it("carries a sale's original price for display without changing the total", () => {
    const offer = priceOffer(
      { ...baseOffer, priceKind: "unconditional_sale", charges: [] },
      { ...listing, originalPriceCents: 500 },
      2,
    );
    expect(offer).toMatchObject({
      priceKind: "unconditional_sale",
      unitPriceCents: 410,
      originalPriceCents: 500,
      lineTotalCents: 820,
    });
  });

  it("omits an ineligible offer", () => {
    expect(priceOffer({ ...baseOffer, eligible: false }, listing, 1)).toBeNull();
  });

  it("omits an offer with an unresolved mandatory charge", () => {
    expect(
      priceOffer(
        {
          ...baseOffer,
          charges: [{ label: "Unknown fee", amount: null, includedInPrice: false }],
        },
        listing,
        1,
      ),
    ).toBeNull();
  });
});
