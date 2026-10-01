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
    expect(errors).toContain("Product fixture-noodles-400g has no listing");
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
});
