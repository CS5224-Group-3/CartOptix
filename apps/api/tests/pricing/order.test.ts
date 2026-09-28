import { describe, expect, it } from "vitest";
import { priceLine } from "../../src/pricing/line.ts";
import { priceRetailerOrder } from "../../src/pricing/order.ts";
import { type PricedLine, PricingContractError } from "../../src/pricing/results.ts";
import { loadOrderFixture, lookup } from "./fixtures.ts";

/** Drives every order scenario in `fixtures/order-scenarios.json`. */

const fixture = loadOrderFixture();

function priceLines(scenario: { lines: { offer: string; packs: number }[] }): PricedLine[] {
  return scenario.lines.map(({ offer, packs }) => {
    const result = priceLine({ offer: lookup(fixture.offers, offer, "offer"), packs });
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

  it("refuses a rule belonging to another retailer rather than applying it", () => {
    const delivery = lookup(fixture.retailers, "beta", "retailer");
    const result = priceRetailerOrder({
      retailerId: "redmart",
      lines: priceLines({ lines: [{ offer: "milk", packs: 10 }] }),
      delivery,
    });

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") {
      return;
    }
    expect(result.reason.code).toBe("delivery-rule-unverified");
  });

  describe("caller mistakes", () => {
    // An order with no lines, or one holding another retailer's line, cannot
    // come from a shopper request. It is a bug in whatever assembled the
    // candidate, so it throws rather than returning a renderable status.
    const delivery = lookup(fixture.retailers, "alpha", "retailer");

    it("throws on an order with no lines", () => {
      expect(() =>
        priceRetailerOrder({
          retailerId: "redmart",
          lines: [],
          delivery,
        }),
      ).toThrow(PricingContractError);
    });

    it("throws on a line belonging to another retailer", () => {
      expect(() =>
        priceRetailerOrder({
          retailerId: "redmart",
          lines: priceLines({ lines: [{ offer: "betaMilk", packs: 5 }] }),
          delivery,
        }),
      ).toThrow(PricingContractError);
    });
  });

  it("counts mandatory charges toward the threshold only when the basis says so", () => {
    // The soda deposit is the only thing separating the two amounts: 3600 paid
    // for packs, plus 400 of deposits. A retailer counting deposits reaches
    // 4000 and earns free delivery; one that does not stops at 3600 and pays.
    // Retailers do not share a convention here, so neither can be assumed.
    const lines = priceLines({ lines: [{ offer: "soda", packs: 20 }] });
    expect(lines[0]?.packsSubtotal).toBe(3600);
    expect(lines[0]?.total).toBe(4000);

    const base = {
      retailerId: "redmart" as const,
      verified: true,
      fee: 599,
      freeDeliveryThreshold: 4000,
      minimumOrder: null,
      orderCharges: [],
    };

    const excludingCharges = priceRetailerOrder({
      retailerId: "redmart",
      lines,
      delivery: { ...base, thresholdBasis: { includesMandatoryCharges: false } },
    });
    const includingCharges = priceRetailerOrder({
      retailerId: "redmart",
      lines,
      delivery: { ...base, thresholdBasis: { includesMandatoryCharges: true } },
    });

    if (excludingCharges.status !== "priced" || includingCharges.status !== "priced") {
      throw new Error("Expected both orders to price");
    }
    expect(excludingCharges.order.delivery).toMatchObject({
      measuredAmount: 3600,
      free: false,
      amount: 599,
    });
    expect(includingCharges.order.delivery).toMatchObject({
      measuredAmount: 4000,
      free: true,
      amount: 0,
    });
    expect(excludingCharges.order.total).toBe(4599);
    expect(includingCharges.order.total).toBe(4000);
  });
});
