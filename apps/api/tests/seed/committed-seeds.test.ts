import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateSeed } from "../../src/seed/validate.ts";

// The committed seed must pass the importer's validation, so a broken seed
// fails CI rather than a deployment's import.
const seedPath = resolve(import.meta.dirname, "../../../../data/seed/seed.json");

describe("committed seed", () => {
  it("is valid", () => {
    const result = validateSeed(JSON.parse(readFileSync(seedPath, "utf8")));
    expect(result.ok ? [] : result.errors).toEqual([]);
  });
});
