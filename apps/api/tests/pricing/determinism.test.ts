import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { priceLine } from "../../src/pricing/line.ts";
import { priceRetailerOrder } from "../../src/pricing/order.ts";
import { loadLineFixture, loadOrderFixture, lookup } from "./fixtures.ts";

/**
 * Promotion eligibility comes from the approved seed, never the runtime clock
 * (PR-03). Advancing the calendar must not expire or activate anything, so the
 * same basket and seed keep the same price for the life of the prototype.
 */

const lineFixture = loadLineFixture();
const orderFixture = loadOrderFixture();

const PRICING_SOURCE = resolve(import.meta.dirname, "../../src/pricing");

function priceEverything(): unknown {
  const lines = lineFixture.scenarios.map((scenario) =>
    priceLine({
      offer: lookup(lineFixture.offers, scenario.offer, "offer"),
      packs: scenario.packs,
      datasetId: lineFixture.datasetId,
      bundle:
        scenario.bundle === undefined
          ? undefined
          : lookup(lineFixture.bundles, scenario.bundle, "bundle"),
    }),
  );

  const orders = orderFixture.scenarios.map((scenario) => {
    const delivery = lookup(orderFixture.retailers, scenario.retailer, "retailer");
    const priced = scenario.lines.flatMap(({ offer, packs }) => {
      const result = priceLine({
        offer: lookup(orderFixture.offers, offer, "offer"),
        packs,
        datasetId: orderFixture.datasetId,
      });
      return result.status === "priced" ? [result.line] : [];
    });

    return priceRetailerOrder({
      retailerId: delivery.retailerId,
      lines: priced,
      delivery,
      datasetId: orderFixture.datasetId,
    });
  });

  return { lines, orders };
}

describe("pricing determinism", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prices every fixture identically two years apart", () => {
    vi.useFakeTimers();

    vi.setSystemTime(new Date("2026-01-15T09:00:00Z"));
    const early = priceEverything();

    vi.setSystemTime(new Date("2028-07-02T23:30:00Z"));
    const late = priceEverything();

    expect(late).toEqual(early);
  });

  it("prices a promotion identically after its captured validity wording would have lapsed", () => {
    vi.useFakeTimers();
    const offer = lookup(lineFixture.offers, "rice", "offer");
    const bundle = lookup(lineFixture.bundles, "riceThreeForThirty", "bundle");
    expect(bundle.capturedValidityTerms).toBeDefined();

    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const duringTerms = priceLine({ offer, packs: 7, datasetId: lineFixture.datasetId, bundle });

    vi.setSystemTime(new Date("2099-12-31T23:59:59Z"));
    const longAfterTerms = priceLine({ offer, packs: 7, datasetId: lineFixture.datasetId, bundle });

    expect(longAfterTerms).toEqual(duringTerms);
  });

  it("repeats itself exactly when called many times", () => {
    const first = priceEverything();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(priceEverything()).toEqual(first);
    }
  });

  it("reads no clock anywhere in the pricing module", () => {
    // Stronger than the behavioural checks above, which can only prove the
    // clock is unused along the paths they happen to take.
    const clock = /\bDate\b|Date\.now|performance\.now|hrtime/;

    for (const file of readdirSync(PRICING_SOURCE)) {
      if (!file.endsWith(".ts")) {
        continue;
      }
      const source = readFileSync(resolve(PRICING_SOURCE, file), "utf8");
      expect(clock.test(source), `${file} must not consult a clock`).toBe(false);
    }
  });
});
