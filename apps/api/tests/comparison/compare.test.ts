import type { RetailerId } from "@cartoptix/contracts";
import { describe, expect, it } from "vitest";
import {
  type BasketLine,
  ComparisonDataError,
  compareBasket,
  compareRetailerIds,
} from "../../src/comparison/index.ts";
import type { DeliveryRule, OfferRule } from "../../src/pricing/index.ts";

// Hand-checked baskets for single-retailer comparison (#11). Every amount is
// integer cents; retailer rules are invented for testing.

const offer = (
  retailerId: RetailerId,
  productId: string,
  unitPrice: number,
  overrides: Partial<OfferRule> = {},
): OfferRule => ({
  listingId: `${retailerId}-${productId}`,
  productId,
  retailerId,
  priceKind: "ordinary",
  unitPrice,
  multibuy: null,
  eligible: true,
  charges: [],
  excludedPromotions: [],
  ...overrides,
});

const rule = (retailerId: RetailerId, overrides: Partial<DeliveryRule> = {}): DeliveryRule => ({
  retailerId,
  verified: true,
  fee: 500,
  freeDeliveryThreshold: 6000,
  minimumOrder: null,
  thresholdBasis: { includesMandatoryCharges: false },
  orderCharges: [],
  ...overrides,
});

const retailers: RetailerId[] = ["redmart", "fairprice", "cold-storage"];
const rules = retailers.map((retailerId) => rule(retailerId));

const basket: BasketLine[] = [
  { productId: "rice", quantity: 2 },
  { productId: "milk", quantity: 3 },
];

/** Rice and milk at every retailer; FairPrice is cheapest before delivery. */
const offers = [
  offer("redmart", "rice", 1000),
  offer("redmart", "milk", 300),
  offer("fairprice", "rice", 900),
  offer("fairprice", "milk", 300),
  offer("cold-storage", "rice", 1100),
  offer("cold-storage", "milk", 350),
];

const compare = (overrides: Partial<Parameters<typeof compareBasket>[0]> = {}) =>
  compareBasket({
    lines: basket,
    offers,
    deliveryRules: rules,
    retailers,
    ...overrides,
  });

describe("compareBasket", () => {
  it("prices every retailer's complete basket and recommends the cheapest", () => {
    const result = compare();
    // FairPrice 1800 + 900 + 500 delivery = 3200; RedMart 2000 + 900 + 500 = 3400;
    // Cold Storage 2200 + 1050 + 500 = 3750.
    expect(result.status).toBe("recommended");
    expect(
      result.options.map((option) => [
        option.retailerId,
        option.status === "complete" ? option.order.total : null,
      ]),
    ).toEqual([
      ["fairprice", 3200],
      ["redmart", 3400],
      ["cold-storage", 3750],
    ]);
    if (result.status === "recommended") expect(result.recommendedRetailerId).toBe("fairprice");
  });

  it("keeps each requested quantity on every line", () => {
    const result = compare();
    for (const option of result.options) {
      if (option.status !== "complete") continue;
      expect(option.order.lines.map((line) => [line.productId, line.packs])).toEqual([
        ["rice", 2],
        ["milk", 3],
      ]);
    }
  });

  it("lets a same-product multibuy change the winner, counting its own packs only", () => {
    const deal = { packsPerDeal: 2, dealPrice: 1500, mixAndMatch: true };
    const result = compare({
      offers: offers.map((o) =>
        o.retailerId === "cold-storage" && o.productId === "rice" ? { ...o, multibuy: deal } : o,
      ),
    });
    // Cold Storage 1500 (one deal) + 1050 + 500 = 3050, now below FairPrice's 3200.
    expect(result).toMatchObject({ status: "recommended", recommendedRetailerId: "cold-storage" });
    const coldStorage = result.options[0];
    if (coldStorage?.status !== "complete") throw new Error("Expected Cold Storage complete");
    expect(coldStorage.order.total).toBe(3050);
    // The deal is worded "Any 2", but milk packs never count towards it.
    expect(coldStorage.order.lines.find((line) => line.productId === "milk")?.multibuy).toBeNull();
  });

  it('never combines two lines that share an "Any 2" deal', () => {
    const deal = { packsPerDeal: 2, dealPrice: 500, mixAndMatch: true };
    const result = compare({
      lines: [
        { productId: "rice", quantity: 1 },
        { productId: "milk", quantity: 1 },
      ],
      offers: offers.map((o) => (o.retailerId === "redmart" ? { ...o, multibuy: deal } : o)),
    });
    const redmart = result.options.find((option) => option.retailerId === "redmart");
    if (redmart?.status !== "complete") throw new Error("Expected RedMart complete");
    // One pack of each at the unit price: 1000 + 300 + 500 delivery, no deal.
    expect(redmart.order.total).toBe(1800);
    expect(redmart.order.lines.map((line) => line.multibuy?.deals)).toEqual([0, 0]);
  });

  it("breaks a tie by retailer ID, whatever order the retailers are given in", () => {
    const tiedOffers = [
      offer("redmart", "rice", 900),
      offer("redmart", "milk", 300),
      offer("fairprice", "rice", 900),
      offer("fairprice", "milk", 300),
    ];
    for (const order of [retailers, [...retailers].reverse()]) {
      expect(compare({ offers: tiedOffers, retailers: order })).toMatchObject({
        status: "recommended",
        recommendedRetailerId: "fairprice",
        options: [
          { retailerId: "fairprice", status: "complete" },
          { retailerId: "redmart", status: "complete" },
          { retailerId: "cold-storage", status: "unavailable" },
        ],
      });
    }
    expect(compareRetailerIds("cold-storage", "fairprice")).toBeLessThan(0);
    expect(compareRetailerIds("redmart", "fairprice")).toBeGreaterThan(0);
  });

  it("lets delivery change the winner", () => {
    // Cold Storage's 3050 basket reaches a 3000 free-delivery threshold; the others pay 500.
    const result = compare({
      deliveryRules: [
        rule("redmart"),
        rule("fairprice"),
        rule("cold-storage", { freeDeliveryThreshold: 3000 }),
      ],
      offers: [
        ...offers.slice(0, 4),
        offer("cold-storage", "rice", 1000),
        offer("cold-storage", "milk", 350),
      ],
    });
    // FairPrice 3200 vs Cold Storage 2000 + 1050 = 3050 with free delivery.
    expect(result).toMatchObject({ status: "recommended", recommendedRetailerId: "cold-storage" });
  });

  it("marks a retailer missing a product unavailable, naming the product", () => {
    const result = compare({ offers: offers.filter((o) => o.listingId !== "redmart-milk") });
    expect(result.options.find((option) => option.retailerId === "redmart")).toEqual({
      status: "unavailable",
      retailerId: "redmart",
      reasons: [{ code: "missing_products", productIds: ["milk"] }],
    });
    expect(result.status).toBe("recommended");
  });

  it("marks an unverified or missing delivery rule unavailable, never free", () => {
    const result = compare({
      deliveryRules: [rule("redmart", { verified: false }), rule("fairprice", { fee: null })],
    });
    for (const retailerId of retailers) {
      expect(result.options.find((option) => option.retailerId === retailerId)).toEqual({
        status: "unavailable",
        retailerId,
        reasons: [{ code: "delivery_rule_unverified" }],
      });
    }
    expect(result.status).toBe("no_feasible_plan");
  });

  it("reports every reason at once", () => {
    const result = compare({
      offers: offers.filter((o) => o.listingId !== "redmart-milk"),
      deliveryRules: [
        rule("redmart", { verified: false }),
        rule("fairprice"),
        rule("cold-storage"),
      ],
    });
    expect(result.options.find((option) => option.retailerId === "redmart")).toMatchObject({
      reasons: [
        { code: "missing_products", productIds: ["milk"] },
        { code: "delivery_rule_unverified" },
      ],
    });
  });

  it("reports the minimum order and qualifying spend when an order falls short", () => {
    const result = compare({
      deliveryRules: rules.map((r) => ({ ...r, minimumOrder: 4000 })),
    });
    expect(result.status).toBe("no_feasible_plan");
    expect(result.options.find((option) => option.retailerId === "fairprice")).toEqual({
      status: "unavailable",
      retailerId: "fairprice",
      reasons: [{ code: "below_minimum_order", minimumOrderCents: 4000, spendCents: 2700 }],
    });
  });

  it("applies an order-charge waiver, so a waived fee can change the winner", () => {
    // RedMart 2900 items + 500 delivery = 3400. FairPrice 2700 + 500 = 3200, plus a
    // 399 service fee: 3599 when charged, 3200 when waived from 2700.
    const fee = (waivedFrom: number) => [
      rule("redmart"),
      rule("fairprice", {
        orderCharges: [{ label: "Service fee", amount: 399, includedInPrice: false, waivedFrom }],
      }),
      rule("cold-storage"),
    ];
    const charged = compare({ deliveryRules: fee(2701) });
    const waived = compare({ deliveryRules: fee(2700) });
    expect(charged).toMatchObject({ recommendedRetailerId: "redmart" });
    expect(waived).toMatchObject({ recommendedRetailerId: "fairprice" });
    const fairprice = waived.options.find((option) => option.retailerId === "fairprice");
    if (fairprice?.status !== "complete") throw new Error("Expected FairPrice to be complete");
    expect(fairprice.order.orderCharges).toEqual([
      { label: "Service fee", amount: 399, waivedFrom: 2700, waived: true },
    ]);
    expect(fairprice.order.total).toBe(3200);
  });

  describe("data the importer should have stopped", () => {
    it("throws for an ineligible offer", () => {
      const bad = offers.map((o) =>
        o.listingId === "fairprice-rice" ? { ...o, eligible: false } : o,
      );
      expect(() => compare({ offers: bad })).toThrow(ComparisonDataError);
    });

    it("throws for an unresolved order charge", () => {
      const deliveryRules = [
        rule("redmart", {
          orderCharges: [{ label: "Fee", amount: null, includedInPrice: false, waivedFrom: null }],
        }),
      ];
      expect(() => compare({ deliveryRules })).toThrow(ComparisonDataError);
    });

    it("throws for two offers of one product at one retailer", () => {
      expect(() => compare({ offers: [...offers, offer("redmart", "rice", 950)] })).toThrow(
        ComparisonDataError,
      );
    });
  });
});
