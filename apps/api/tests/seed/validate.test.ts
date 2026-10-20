import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateSeed } from "../../src/seed/validate.ts";

const fixture = () =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "fixture-seed.json"), "utf8"));

type Fixture = ReturnType<typeof fixture>;

function errorsFor(mutate: (seed: Fixture) => void): string[] {
  const seed = fixture();
  mutate(seed);
  const result = validateSeed(seed);
  return result.ok ? [] : result.errors;
}

describe("validateSeed", () => {
  it("accepts the fixture seed", () => {
    expect(validateSeed(fixture()).ok).toBe(true);
  });

  it("rejects fields the schema does not declare, such as a collection date", () => {
    expect(errorsFor((seed) => (seed.collectedAt = "2026-09-01"))).not.toEqual([]);
  });

  it.each([
    ["a zero price", (s: Fixture) => (s.listings[0].unitPriceCents = 0)],
    ["a non-https link", (s: Fixture) => (s.listings[0].productUrl = "http://www.lazada.sg/x")],
    ["an unknown price kind", (s: Fixture) => (s.listings[0].priceKind = "member")],
    ["an ID that is not URL-safe", (s: Fixture) => (s.products[0].productId = "rice/5kg")],
  ])("rejects %s", (_name, mutate) => {
    expect(errorsFor(mutate)).not.toEqual([]);
  });

  it("rejects a link outside the retailer's hosts", () => {
    expect(
      errorsFor((s) => (s.listings[0].productUrl = "https://evil.example/products/pdp-i1-s1.html")),
    ).toEqual(["Listing redmart-i1-s1 links to evil.example, not an allowed redmart host"]);
  });

  it("rejects broken references", () => {
    const errors = errorsFor((s) => {
      s.listings[0].productId = "missing";
      s.products[1].categoryId = "missing";
    });
    expect(errors).toContain("Listing redmart-i1-s1 has unknown product missing");
    expect(errors).toContain("Product fixture-noodles-400g has unknown category missing");
  });

  it("rejects a product listed twice at one retailer", () => {
    const errors = errorsFor((s) => {
      s.listings[2].productId = "fixture-rice-5kg";
    });
    expect(errors).toContain(
      "Duplicate product listing at one retailer: fixture-rice-5kg at fairprice",
    );
  });

  it("accepts a product with no listing, which the catalogue shows as unavailable", () => {
    expect(
      errorsFor((s) => {
        s.listings = s.listings.filter(
          (l: { productId: string }) => l.productId !== "fixture-noodles-400g",
        );
      }),
    ).toEqual([]);
  });

  it("accepts a seed whose products all have no listing", () => {
    expect(errorsFor((s) => (s.listings = []))).toEqual([]);
  });

  it("requires every retailer with exactly one delivery rule", () => {
    const errors = errorsFor((s) => {
      s.retailers.pop();
      s.delivery.rules.pop();
    });
    expect(errors).toContain("Missing retailer: cold-storage");
    expect(errors).toContain("Retailer cold-storage needs exactly one delivery rule, found 0");
  });

  it("requires evidence for a verified delivery rule", () => {
    expect(errorsFor((s) => (s.delivery.rules[0].sources = []))).not.toEqual([]);
  });

  it("rejects a blank note on a verified delivery rule", () => {
    expect(errorsFor((s) => (s.delivery.rules[0].note = "   "))).toContain(
      "Verified delivery rule for redmart needs a non-empty note",
    );
  });

  it("rejects conflicting listing pack specifications", () => {
    const errors = errorsFor((s) => (s.listings[1].specification = "1 litre"));
    expect(errors).toContain("Product fixture-rice-5kg has conflicting pack specifications");
  });

  it.each([
    [
      "a sale without an original price",
      (s: Fixture) => (s.listings[1].originalPriceCents = null),
      "Sale listing fairprice-1001 needs a plausible original price",
    ],
    [
      "a sale whose original price is not higher",
      (s: Fixture) => (s.listings[1].originalPriceCents = 1190),
      "Sale listing fairprice-1001 has an original price no higher than its price",
    ],
    [
      "a multibuy that is not cheaper than its packs",
      (s: Fixture) => (s.listings[2].multibuy.dealPriceCents = 662),
      "Listing fairprice-1002 has a multibuy that is not cheaper",
    ],
    [
      "an ordinary price with an original price",
      (s: Fixture) => (s.listings[0].originalPriceCents = 1500),
      "Ordinary listing redmart-i1-s1 cannot have an original price",
    ],
  ])("rejects %s", (_name, mutate, error) => {
    expect(errorsFor(mutate)).toContain(error);
  });
});
