import { describe, expect, it } from "vitest";
import { isCents, multiplyCents, parseMoneyToCents, sumCents } from "../../src/pricing/money.ts";

describe("parseMoneyToCents", () => {
  it("parses the decimal values that break float multiplication", () => {
    // Number("0.29") * 100 is 28.999999999999996, which is why the parser
    // works on digits rather than multiplying a float.
    expect(parseMoneyToCents("0.29")).toEqual({ ok: true, cents: 29 });
    expect(parseMoneyToCents("1.15")).toEqual({ ok: true, cents: 115 });
    expect(parseMoneyToCents("29.97")).toEqual({ ok: true, cents: 2997 });
  });

  it("accepts the decoration the source exports carry", () => {
    expect(parseMoneyToCents("$4.50")).toEqual({ ok: true, cents: 450 });
    expect(parseMoneyToCents("SGD 4.50")).toEqual({ ok: true, cents: 450 });
    expect(parseMoneyToCents("1,234.50")).toEqual({ ok: true, cents: 123450 });
    expect(parseMoneyToCents(" 4.50 ")).toEqual({ ok: true, cents: 450 });
  });

  it("pads a missing or short fraction", () => {
    expect(parseMoneyToCents("4")).toEqual({ ok: true, cents: 400 });
    expect(parseMoneyToCents("4.5")).toEqual({ ok: true, cents: 450 });
    expect(parseMoneyToCents("4.")).toEqual({ ok: true, cents: 400 });
  });

  it("rejects more precision than a cent instead of rounding it away", () => {
    // Rounding needs a verified retailer basis (issue #4); until one exists,
    // refusing the value is the only honest option.
    const result = parseMoneyToCents("4.567");
    expect(result.ok).toBe(false);
  });

  it("rejects values that are not amounts", () => {
    for (const raw of ["", "  ", "abc", "4.5.0", "--4", "4-"]) {
      expect(parseMoneyToCents(raw).ok).toBe(false);
    }
  });

  it("keeps a negative amount negative rather than discarding the sign", () => {
    expect(parseMoneyToCents("-1.50")).toEqual({ ok: true, cents: -150 });
  });
});

describe("cent arithmetic", () => {
  it("accepts only exact integers as cents", () => {
    expect(isCents(450)).toBe(true);
    expect(isCents(0)).toBe(true);
    expect(isCents(4.5)).toBe(false);
    expect(isCents(Number.NaN)).toBe(false);
    expect(isCents(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isCents(Number.MAX_SAFE_INTEGER + 2)).toBe(false);
  });

  it("sums an empty basket to zero", () => {
    expect(sumCents([])).toBe(0);
  });

  it("sums many lines without drift", () => {
    const lines = Array.from({ length: 50 }, () => 29);
    expect(sumCents(lines)).toBe(1450);
  });

  it("multiplies a price by whole packs", () => {
    expect(multiplyCents(320, 20)).toBe(6400);
    expect(multiplyCents(499, 0)).toBe(0);
  });
});
