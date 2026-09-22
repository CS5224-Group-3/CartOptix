import { describe, expect, it } from "vitest";
import { priceLine } from "../../src/pricing/line.ts";
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
      const bundle =
        scenario.bundle === undefined
          ? undefined
          : lookup(fixture.bundles, scenario.bundle, "bundle");

      const result = priceLine({
        offer,
        packs: scenario.packs,
        datasetId: fixture.datasetId,
        bundle,
      });

      const expected = scenario.expect;
      expect(result.status).toBe(expected.status);

      if (expected.status === "unavailable" || result.status === "unavailable") {
        if (result.status !== "unavailable" || expected.status !== "unavailable") {
          throw new Error("Expected both the scenario and the result to be unavailable");
        }
        expect(result.reason.code).toBe(expected.code);
        expect(result.reason.detail).not.toBe("");
        return;
      }

      const { line } = result;
      expect(line.packsSubtotal).toBe(expected.packsSubtotal);
      expect(line.undiscountedPacksSubtotal).toBe(expected.undiscountedPacksSubtotal);
      expect(line.total).toBe(expected.total);
      expect(line.packsBreakdown).toEqual(expected.packsBreakdown);
      expect(line.appliedCharges).toEqual(expected.appliedCharges);
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

  it("never prices a bundle above the per-pack route for any supported quantity", () => {
    // PR-05 forbids returning a more expensive result than one that exists, so
    // this holds across the whole 1-20 pack range, not just the fixture cases.
    const offer = lookup(fixture.offers, "rice", "offer");
    const bundle = lookup(fixture.bundles, "riceThreeForThirty", "bundle");

    for (let packs = 1; packs <= 20; packs += 1) {
      const withBundle = priceLine({ offer, packs, datasetId: fixture.datasetId, bundle });
      const withoutBundle = priceLine({ offer, packs, datasetId: fixture.datasetId });

      if (withBundle.status !== "priced" || withoutBundle.status !== "priced") {
        throw new Error(`Expected both routes to price ${packs} packs`);
      }
      expect(withBundle.line.total).toBeLessThanOrEqual(withoutBundle.line.total);
    }
  });

  it("never divides a bundle price into a fraction of a cent", () => {
    // Seven packs against a three-pack bundle is the case a per-pack average
    // would fail: 3000 / 3 is exact, but 3000 / 7 is not.
    const offer = lookup(fixture.offers, "rice", "offer");
    const bundle = lookup(fixture.bundles, "riceThreeForThirty", "bundle");

    const result = priceLine({ offer, packs: 7, datasetId: fixture.datasetId, bundle });
    if (result.status !== "priced") {
      throw new Error("Expected the line to be priced");
    }

    for (const segment of result.line.packsBreakdown) {
      expect(Number.isSafeInteger(segment.amount)).toBe(true);
    }
  });
});
