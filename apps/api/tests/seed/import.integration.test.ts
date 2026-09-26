import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.ts";
import { importSeed } from "../../src/seed/import.ts";

/**
 * Migrations and import against a throwaway database on the local or CI
 * PostgreSQL, created and dropped by this file. Skipped without DATABASE_URL.
 */

const connectionString = process.env.DATABASE_URL;
const fixturePath = resolve(import.meta.dirname, "fixture-seed.json");
const fixtureBytes = readFileSync(fixturePath);

function seedBytes(mutate: (seed: ReturnType<typeof JSON.parse>) => void): Buffer {
  const seed = JSON.parse(fixtureBytes.toString("utf8"));
  mutate(seed);
  return Buffer.from(JSON.stringify(seed));
}

describe.skipIf(connectionString === undefined)("seed import against PostgreSQL", () => {
  const databaseName = `cartoptix_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString });
  let client: pg.Client;

  const active = async () =>
    (await client.query("SELECT dataset_id FROM datasets WHERE is_active")).rows.map(
      (row) => row.dataset_id,
    );
  const count = async (table: string) =>
    Number((await client.query(`SELECT count(*) FROM ${table}`)).rows[0].count);

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${databaseName}`);
    const url = new URL(connectionString ?? "");
    url.pathname = `/${databaseName}`;
    client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.end();
  });

  it("refuses to import before the schema exists", async () => {
    await expect(importSeed(client, fixtureBytes)).rejects.toThrow(/db:migrate/);
  });

  it("migrates a fresh database, and a second run changes nothing", async () => {
    expect(await runMigrations(client)).toEqual(["0001_datasets.sql"]);
    expect(await runMigrations(client)).toEqual([]);
  });

  it("imports and activates a seed", async () => {
    const result = await importSeed(client, fixtureBytes);
    expect(result).toMatchObject({ status: "imported", datasetId: "fixture-seed-v1" });
    expect(await active()).toEqual(["fixture-seed-v1"]);
    expect(await count("products")).toBe(3);
    expect(await count("listings")).toBe(4);
    expect(await count("order_charges")).toBe(1);
    const rule = await client.query(
      "SELECT status, delivery_fee_cents FROM delivery_rules WHERE retailer_id = 'cold-storage'",
    );
    expect(rule.rows[0]).toEqual({ status: "unverified", delivery_fee_cents: null });
  });

  it("treats a repeated import as a no-op", async () => {
    expect(await importSeed(client, fixtureBytes)).toMatchObject({ status: "already-active" });
    expect(await count("datasets")).toBe(1);
    expect(await count("listings")).toBe(4);
  });

  it("refuses to reuse a dataset ID for different contents", async () => {
    const changed = seedBytes((seed) => {
      seed.listings[0].unitPriceCents = 999;
    });
    const result = await importSeed(client, changed);
    expect(result.status).toBe("invalid");
    expect(await active()).toEqual(["fixture-seed-v1"]);
  });

  it("leaves the active dataset unchanged when a seed is invalid", async () => {
    const invalid = seedBytes((seed) => {
      seed.datasetId = "fixture-seed-v2";
      seed.listings[0].productUrl = "https://evil.example/x";
    });
    expect((await importSeed(client, invalid)).status).toBe("invalid");
    expect(await active()).toEqual(["fixture-seed-v1"]);
    expect(await count("datasets")).toBe(1);
  });

  it("rolls back a load that fails partway, keeping the active dataset", async () => {
    // Valid JSON and a valid seed, but PostgreSQL rejects NUL characters, so the
    // listings insert fails after the earlier tables have loaded.
    const failing = seedBytes((seed) => {
      seed.datasetId = "fixture-seed-v3";
      seed.listings[0].name = "Broken \u0000 name";
    });
    await expect(importSeed(client, failing)).rejects.toThrow();
    expect(await active()).toEqual(["fixture-seed-v1"]);
    expect(await count("datasets")).toBe(1);
    expect(await count("products")).toBe(3);
  });

  it("activates a new version, and reactivates an older one to roll back", async () => {
    const v2 = seedBytes((seed) => {
      seed.datasetId = "fixture-seed-v2";
    });
    expect(await importSeed(client, v2)).toMatchObject({ status: "imported" });
    expect(await active()).toEqual(["fixture-seed-v2"]);
    expect(await importSeed(client, fixtureBytes)).toMatchObject({ status: "reactivated" });
    expect(await active()).toEqual(["fixture-seed-v1"]);
  });

  it("keeps references, uniqueness and the single active dataset at the database level", async () => {
    await expect(
      client.query(`UPDATE listings SET product_id = 'missing' WHERE listing_id = 'redmart-i1-s1'`),
    ).rejects.toThrow(/foreign key/);
    await expect(
      client.query(
        `UPDATE listings SET product_id = 'fixture-rice-5kg' WHERE listing_id = 'fairprice-1002'`,
      ),
    ).rejects.toThrow(/unique/);
    await expect(client.query("UPDATE datasets SET is_active = true")).rejects.toThrow(
      /datasets_one_active/,
    );
  });
});
