import type { Cents } from "./results.ts";

/**
 * Integer-cent money handling for the pricing module.
 *
 * All calculation is in whole cents (PR-05). The parser exists because import
 * values arrive as decimal text: `Number("0.29") * 100` is 28.999999999999996,
 * so multiplying a parsed float is not a safe way to reach cents. These
 * functions work on the digits instead.
 */

/** A parse that either produced cents or explains why it could not. */
export type MoneyParseResult = { ok: true; cents: Cents } | { ok: false; reason: string };

/** Currency decoration and thousands separators seen in the source exports. */
const DECORATION = /[\s,$]|SGD/gi;

/** Optional sign, digits, and at most one decimal point. */
const DECIMAL = /^(-?)(\d+)(?:\.(\d*))?$/;

/**
 * Parses decimal money text such as `"$4.50"` or `"4"` into whole cents.
 *
 * More than two decimal places is rejected rather than rounded. No verified
 * retailer rounding basis has been established yet (issue #4, B3), and
 * inventing one here would be inventing a discount convention (section 4).
 */
export function parseMoneyToCents(raw: string): MoneyParseResult {
  const cleaned = raw.replace(DECORATION, "");
  if (cleaned === "") {
    return { ok: false, reason: "Value is empty" };
  }

  const match = DECIMAL.exec(cleaned);
  if (match === null) {
    return { ok: false, reason: `Value is not a decimal amount: ${JSON.stringify(raw)}` };
  }

  const [, sign, whole, fraction = ""] = match;
  if (fraction.length > 2) {
    return {
      ok: false,
      reason: `Value has more precision than cents and no verified rounding rule: ${JSON.stringify(raw)}`,
    };
  }

  const cents = Number(`${whole}${fraction.padEnd(2, "0")}`);
  if (!Number.isSafeInteger(cents)) {
    return { ok: false, reason: `Value is too large to hold exactly: ${JSON.stringify(raw)}` };
  }

  return { ok: true, cents: sign === "-" ? -cents : cents };
}

/**
 * True when a value is usable as an amount of cents.
 *
 * Guards the module's entry points so a NaN, a fraction of a cent or a float
 * that drifted in from elsewhere cannot propagate silently into a total.
 */
export function isCents(value: number): value is Cents {
  return Number.isSafeInteger(value);
}

/** Adds cents, staying inside the exact-integer range. */
export function sumCents(amounts: readonly Cents[]): Cents {
  return amounts.reduce((total, amount) => total + amount, 0);
}

/**
 * Multiplies a price by a whole count.
 *
 * Quantities are always whole packs or whole bundles, so this never divides
 * and never produces a fraction of a cent (section 4).
 */
export function multiplyCents(amount: Cents, count: number): Cents {
  return amount * count;
}
