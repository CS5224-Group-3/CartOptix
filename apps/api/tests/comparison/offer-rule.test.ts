import { describe, expect, it } from "vitest";
import { offerRule } from "../../src/comparison/store.ts";
import type { listings } from "../../src/db/schema.ts";

const row: typeof listings.$inferSelect = {
  listingId: "fairprice-1",
  productId: "rice-1kg",
  retailerId: "fairprice",
  sourceRecordId: "fairprice_00000001",
  name: "Rice 1kg",
  specification: "1kg",
  productUrl: "https://www.fairprice.com.sg/product/rice-1kg",
  priceKind: "ordinary",
  unitPriceCents: 350,
  originalPriceCents: null,
  multibuy: { packsPerDeal: 2, dealPriceCents: 655, mixAndMatch: true, percentOff: null },
  excludedPromotions: [],
};

describe("offerRule", () => {
  it("keeps a percentage deal's label", () => {
    const multibuy = { packsPerDeal: 2, dealPriceCents: 1187, mixAndMatch: true, percentOff: 40 };
    expect(offerRule({ ...row, multibuy }).multibuy?.percentOff).toBe(40);
  });

  it("keeps a fixed-price deal", () => {
    expect(offerRule(row).multibuy).toEqual({
      packsPerDeal: 2,
      dealPrice: 655,
      mixAndMatch: true,
      percentOff: null,
    });
  });

  it("leaves out a deal imported before percentOff existed, which may be a percentage deal", () => {
    const { percentOff: _, ...legacy } = row.multibuy ?? {};
    expect(offerRule({ ...row, multibuy: legacy as typeof row.multibuy }).multibuy).toBeNull();
  });
});
