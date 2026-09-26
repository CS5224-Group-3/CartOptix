import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateSeed } from "../../src/seed/validate.ts";

// Every seed committed in data/seed must pass the importer's validation, so a
// broken seed fails CI rather than a deployment's import.
const seedDir = resolve(import.meta.dirname, "../../../../data/seed");
const seeds = readdirSync(seedDir).filter((name) => name.endsWith(".json"));

describe("committed seeds", () => {
  it("includes at least one seed", () => {
    expect(seeds.length).toBeGreaterThan(0);
  });

  it.each(seeds)("%s is valid", (name) => {
    const result = validateSeed(JSON.parse(readFileSync(resolve(seedDir, name), "utf8")));
    expect(result.ok ? [] : result.errors).toEqual([]);
    if (result.ok) expect(result.seed.datasetId).toBe(name.replace(/\.json$/, ""));
  });
});
