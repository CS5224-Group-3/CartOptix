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
        expect(result.reason.minimumOrder).toBe(expected.minimumOrder);
        expect(result.reason.measuredAmount).toBe(expected.measuredAmount);
        expect(result.reason.minimumOrder - result.reason.measuredAmount).toBe(
          result.reason.shortfall,
        );
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
      expect(order.orderCharges).toEqual(expected.orderCharges);
      expect(order.total).toBe(expected.total);
      expect(order.disclosures.map((disclosure) => disclosure.code)).toEqual(
        expected.disclosureCodes,
      );

      const charges = order.orderCharges
        .filter((charge) => !charge.waived)
        .reduce((sum, charge) => sum + charge.amount, 0);
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

  describe("order-charge waivers", () => {
    // Milk is 320 cents a pack, so 7 packs are 2240 cents of qualifying spend.
    // The boundary is probed by moving the threshold around that spend.
    const rule = (waivedFrom: number | null) => ({
      retailerId: "redmart" as const,
      datasetId: fixture.datasetId,
      verified: true,
      fee: 0,
      freeDeliveryThreshold: null,
      minimumOrder: null,
      thresholdBasis: { includesMandatoryCharges: false },
      orderCharges: [{ label: "Service fee", amount: 399, includedInPrice: false, waivedFrom }],
    });
    const price = (packs: number, waivedFrom: number | null) => {
      const result = priceRetailerOrder({
        retailerId: "redmart",
        lines: priceLines({ lines: [{ offer: "milk", packs }] }),
        delivery: rule(waivedFrom),
        datasetId: fixture.datasetId,
      });
      if (result.status !== "priced") throw new Error("Expected the order to price");
      return result.order;
    };

    it.each([
      ["just below", 2241, false],
      ["exactly at", 2240, true],
      ["above", 2239, true],
    ])("spend %s the waiver threshold", (_name, waivedFrom, waived) => {
      const order = price(7, waivedFrom);
      expect(order.itemsTotal).toBe(2240);
      expect(order.orderCharges).toEqual([
        { label: "Service fee", amount: 399, waivedFrom, waived },
      ]);
      expect(order.total).toBe(2240 + (waived ? 0 : 399));
    });

    it("never waives a charge without a threshold", () => {
      const order = price(20, null);
      expect(order.orderCharges[0]).toMatchObject({ waivedFrom: null, waived: false });
      expect(order.total).toBe(order.itemsTotal + 399);
    });

    it("measures the waiver on the retailer's threshold basis", () => {
      // 20 sodas: 3600 for the packs, 4000 with deposits. A fee waived from 4000
      // is waived only when the basis counts the deposits.
      const lines = priceLines({ lines: [{ offer: "soda", packs: 20 }] });
      const priced = (includesMandatoryCharges: boolean) => {
        const result = priceRetailerOrder({
          retailerId: "redmart",
          lines,
          delivery: { ...rule(4000), thresholdBasis: { includesMandatoryCharges } },
          datasetId: fixture.datasetId,
        });
        if (result.status !== "priced") throw new Error("Expected the order to price");
        return result.order;
      };
      expect(priced(false).orderCharges[0]?.waived).toBe(false);
      expect(priced(true).orderCharges[0]?.waived).toBe(true);
    });
  });
});
