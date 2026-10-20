import { describe, expect, it } from "vitest";
import { priceLine } from "../../src/pricing/line.ts";
import { PricingContractError } from "../../src/pricing/results.ts";
import { loadLineFixture, lookup } from "./fixtures.ts";

/**
 * Drives every line scenario in `fixtures/line-scenarios.json`.
 *
 * The fixture owns the expected amounts; this file only wires them to the
 * module, so adding a case is a data change.
 */

const fixture = loadLineFixture();

describe("priceLine", () => {
  for (const scenario of fixture.scenarios) {
    it(scenario.name, () => {
      const offer = lookup(fixture.offers, scenario.offer, "offer");
      const result = priceLine({ offer, packs: scenario.packs });
      const expected = scenario.expect;

      expect(result.status).toBe(expected.status);

      if (expected.status === "unavailable") {
        if (result.status !== "unavailable") {
          throw new Error("Expected the line to be unavailable");
        }
        expect(result.reason.code).toBe(expected.code);
        expect(result.reason.detail).not.toBe("");
        return;
      }

      if (result.status !== "priced") {
        throw new Error("Expected the line to be priced");
      }
      const { line } = result;
      expect(line.priceKind).toBe(offer.priceKind);
      expect(line.retailerId).toBe(offer.retailerId);
      expect(line.packsSubtotal).toBe(expected.packsSubtotal);
      expect(line.total).toBe(expected.total);
      expect(line.packsBreakdown).toEqual(expected.packsBreakdown);
      expect(line.appliedCharges).toEqual(expected.appliedCharges);
      expect(line.multibuy).toEqual(expected.multibuy);
      expect(line.unitPrice).toBe(offer.unitPrice);
      expect(line.disclosures.map((disclosure) => disclosure.code)).toEqual(
        expected.disclosureCodes,
      );

      // The explanation must add up to the number shown, or the breakdown is
      // decoration rather than evidence.
      const breakdown = line.packsBreakdown.reduce((sum, segment) => sum + segment.amount, 0);
      const charges = line.appliedCharges.reduce((sum, charge) => sum + charge.amount, 0);
      expect(breakdown).toBe(line.packsSubtotal);
      expect(line.packsSubtotal + charges).toBe(line.total);
      expect(Number.isSafeInteger(line.total)).toBe(true);
    });
  }

  it("prices every supported quantity without drift", () => {
    const offer = lookup(fixture.offers, "milk", "offer");

    for (let packs = 1; packs <= 20; packs += 1) {
      const result = priceLine({ offer, packs });
      if (result.status !== "priced") {
        throw new Error(`Expected ${packs} packs to price`);
      }
      expect(result.line.total).toBe(offer.unitPrice * packs);
      expect(Number.isSafeInteger(result.line.total)).toBe(true);
    }
  });

  describe("caller mistakes", () => {
    // These are not pricing outcomes. The API validates a request against the
    // contract schema before pricing runs, so reaching the module with one is
    // a bug, and a thrown error keeps the result union to real outcomes.
    const offer = lookup(fixture.offers, "milk", "offer");

    for (const packs of [0, -1, 21, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      it(`throws rather than pricing ${packs} packs`, () => {
        expect(() => priceLine({ offer, packs })).toThrow(PricingContractError);
      });
    }

    it("throws rather than stacking a multibuy on a sale price", () => {
      const chicken = lookup(fixture.offers, "chicken", "offer");
      const stacked = { ...chicken, priceKind: "unconditional_sale" as const };
      expect(() => priceLine({ offer: stacked, packs: 2 })).toThrow(PricingContractError);
    });
  });
});
