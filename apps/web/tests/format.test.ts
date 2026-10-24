import type { Multibuy } from "@cartoptix/contracts";
import { describe, expect, it } from "vitest";
import { multibuyNotes } from "../src/lib/format";

const percentage: Multibuy = {
  packsPerDeal: 2,
  dealPriceCents: 1187,
  mixAndMatch: false,
  percentOff: 40,
  timesApplied: 0,
  savingCents: 0,
};
const rounding = "The retailer rounds this percentage, so the checkout may differ by a few cents";

describe("multibuyNotes for a percentage deal", () => {
  it("hints in the retailer's wording on the product page", () => {
    expect(multibuyNotes(percentage, 1, 989, true)).toEqual(["Buy 2, save 40%", rounding]);
  });

  it("says nothing below the deal in the basket", () => {
    expect(multibuyNotes(percentage, 1, 989)).toEqual([]);
  });

  it("describes an applied deal as an estimate", () => {
    const applied = { ...percentage, timesApplied: 1, savingCents: 791 };
    expect(multibuyNotes(applied, 3, 989)).toEqual([
      "1 × deal (2 save 40%) + 1 × S$9.89 · You save about S$7.91",
      rounding,
    ]);
  });
});
