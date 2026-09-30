import { describe, expect, it } from "vitest";
import { validateSeed } from "../../src/seed/validate.ts";
import { committedSeedBytes } from "../support/database.ts";

// The committed seed must pass the importer's validation, so a broken seed
// fails CI rather than a deployment's import. Comparisons over it are exercised
// in tests/comparison/compare.integration.test.ts.

describe("committed seed", () => {
  it("is valid", () => {
    const result = validateSeed(JSON.parse(committedSeedBytes.toString("utf8")));
    expect(result.ok ? [] : result.errors).toEqual([]);
  });
});
