import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AppliedCharge,
  Cents,
  PackPricing,
  PricingDisclosureCode,
  PricingUnavailableCode,
} from "../../src/pricing/results.ts";
import type { DeliveryRule, OfferRule } from "../../src/pricing/rules.ts";

/**
 * Loads the JSON pricing fixtures.
 *
 * The scenarios stay plain data files so a reviewer can check an expected
 * total against the product rules without reading TypeScript, and so the
 * expectations cannot drift with the implementation that produces them. The
 * types here are the contract the JSON must satisfy; a mistyped scenario fails
 * the type check rather than silently asserting nothing.
 */

export interface UnavailableExpectation {
  status: "unavailable";
  code: PricingUnavailableCode;
}

export interface PricedLineExpectation {
  status: "priced";
  packsSubtotal: Cents;
  total: Cents;
  packsBreakdown: PackPricing[];
  appliedCharges: AppliedCharge[];
  disclosureCodes: PricingDisclosureCode[];
}

export interface LineScenario {
  name: string;
  offer: string;
  packs: number;
  expect: PricedLineExpectation | UnavailableExpectation;
}

export interface LineFixture {
  datasetId: string;
  offers: Record<string, OfferRule>;
  scenarios: LineScenario[];
}

export interface InfeasibleExpectation {
  status: "infeasible";
  code: "minimum-order-not-met";
  shortfall: Cents;
}

export interface PricedOrderExpectation {
  status: "priced";
  itemsTotal: Cents;
  measuredAmount: Cents;
  delivery: { amount: Cents; free: boolean };
  appliedCharges: AppliedCharge[];
  total: Cents;
  disclosureCodes: PricingDisclosureCode[];
}

export interface OrderScenario {
  name: string;
  retailer: string;
  lines: { offer: string; packs: number }[];
  expect: PricedOrderExpectation | InfeasibleExpectation | UnavailableExpectation;
}

export interface OrderFixture {
  datasetId: string;
  retailers: Record<string, DeliveryRule>;
  offers: Record<string, OfferRule>;
  scenarios: OrderScenario[];
}

function load<T>(name: string): T {
  const path = resolve(import.meta.dirname, "fixtures", name);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function loadLineFixture(): LineFixture {
  return load<LineFixture>("line-scenarios.json");
}

export function loadOrderFixture(): OrderFixture {
  return load<OrderFixture>("order-scenarios.json");
}

/** Fails loudly rather than letting a typo in a scenario silently skip a case. */
export function lookup<T>(table: Record<string, T>, key: string, kind: string): T {
  const value = table[key];
  if (value === undefined) {
    throw new Error(`Fixture has no ${kind} named "${key}"`);
  }
  return value;
}
