import type { PricedLine } from "@cartoptix/contracts";
import { describe, expect, it } from "vitest";
import { priceLine } from "../../src/pricing/line.ts";
import { priceRetailerOrder } from "../../src/pricing/order.ts";
import type { DeliveryRule } from "../../src/pricing/rules.ts";
import { loadOrderFixture, lookup } from "./fixtures.ts";

/** Drives every order scenario in `fixtures/order-scenarios.json`. */

const fixture = loadOrderFixture();

function priceLines(scenario: { lines: { offer: string; packs: number }[] }): PricedLine[] {
  return scenario.lines.map(({ offer, packs }) => {
    const result = priceLine({
      offer: lookup(fixture.offers, offer, "offer"),
      packs,
      datasetId: fixture.datasetId,
    });
    if (result.status !== "priced") {
      throw new Error(`Fixture line "${offer}" should price cleanly: ${result.reason.detail}`);
    }
    return result.line;
  });
}

describe("priceRetailerOrder", () => {
  for (const scenario of fixture.scenarios) {
    it(scenario.name, () => {
      const delivery = lookup(fixture.retailers, scenario.retailer, "retailer");

      const result = priceRetailerOrder({
        retailerId: delivery.retailerId,
        lines: priceLines(scenario),
        delivery,
        datasetId: fixture.datasetId,
      });

      const expected = scenario.expect;
      expect(result.status).toBe(expected.status);

      if (expected.status === "unavailable") {
        if (result.status !== "unavailable") {
          throw new Error("Expected the order to be unavailable");
        }
        expect(result.reason.code).toBe(expected.code);
        expect(result.reason.detail).not.toBe("");
        return;
      }

      if (expected.status === "infeasible") {
        if (result.status !== "infeasible") {
          throw new Error("Expected the order to be infeasible");
        }
        expect(result.reason.code).toBe(expected.code);
        expect(result.reason.shortfall).toBe(expected.shortfall);
        expect(result.reason.shortfall).toBeGreaterThan(0);
        return;
      }

      if (result.status !== "priced") {
        throw new Error("Expected the order to be priced");
      }
      const { order } = result;
      expect(order.itemsTotal).toBe(expected.itemsTotal);
      expect(order.delivery.measuredAmount).toBe(expected.measuredAmount);
      expect(order.delivery.amount).toBe(expected.delivery.amount);
      expect(order.delivery.free).toBe(expected.delivery.free);
      expect(order.appliedCharges).toEqual(expected.appliedCharges);
      expect(order.total).toBe(expected.total);
      expect(order.disclosures.map((disclosure) => disclosure.code)).toEqual(
        expected.disclosureCodes,
      );

      const charges = order.appliedCharges.reduce((sum, charge) => sum + charge.amount, 0);
      expect(order.itemsTotal + order.delivery.amount + charges).toBe(order.total);
      expect(Number.isSafeInteger(order.total)).toBe(true);
    });
  }

  it("measures the threshold on the undiscounted amount when the retailer does", () => {
    // The only case where the basis changes the answer is a discounted line:
    // the shopper pays 7250, but the packs list at 8750. A retailer measuring
    // the undiscounted amount gives free delivery here and one measuring the
    // paid amount does not, so the basis cannot be assumed shared (PR-04).
    const offer = {
      listingId: "zeta-rice",
      productId: "rice-5kg",
      retailerId: "zeta",
      unitPrice: 1250,
      eligible: true,
      charges: [],
      excludedPromotions: [],
    };
    const bundle = {
      listingId: "zeta-rice",
      packsPerBundle: 3,
      bundlePrice: 3000,
      maxBundles: null,
      datasetId: fixture.datasetId,
    };
    const priced = priceLine({ offer, packs: 7, datasetId: fixture.datasetId, bundle });
    if (priced.status !== "priced") {
      throw new Error("Expected the discounted line to price");
    }
    expect(priced.line.packsSubtotal).toBe(7250);
    expect(priced.line.undiscountedPacksSubtotal).toBe(8750);

    const base: DeliveryRule = {
      retailerId: "zeta",
      datasetId: fixture.datasetId,
      verified: true,
      fee: 500,
      freeDeliveryThreshold: 8000,
      minimumOrder: null,
      thresholdBasis: { amount: "paid", includesMandatoryCharges: false },
      orderCharges: [],
    };

    const onPaid = priceRetailerOrder({
      retailerId: "zeta",
      lines: [priced.line],
      delivery: base,
      datasetId: fixture.datasetId,
    });
    const onUndiscounted = priceRetailerOrder({
      retailerId: "zeta",
      lines: [priced.line],
      delivery: {
        ...base,
        thresholdBasis: { amount: "undiscounted", includesMandatoryCharges: false },
      },
      datasetId: fixture.datasetId,
    });

    if (onPaid.status !== "priced" || onUndiscounted.status !== "priced") {
      throw new Error("Expected both orders to price");
    }
    expect(onPaid.order.delivery).toMatchObject({ measuredAmount: 7250, free: false, amount: 500 });
    expect(onUndiscounted.order.delivery).toMatchObject({
      measuredAmount: 8750,
      free: true,
      amount: 0,
    });
    expect(onPaid.order.total).toBe(7750);
    expect(onUndiscounted.order.total).toBe(7250);
  });

  it("refuses a rule belonging to another dataset rather than applying it", () => {
    const delivery = lookup(fixture.retailers, "alpha", "retailer");
    const result = priceRetailerOrder({
      retailerId: "alpha",
      lines: priceLines({ lines: [{ offer: "milk", packs: 10 }] }),
      delivery,
      datasetId: "a-different-seed",
    });

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") {
      return;
    }
    expect(result.reason.code).toBe("delivery-rule-unverified");
  });
});
