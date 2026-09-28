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
const fixture = JSON.parse(fixtureBytes.toString("utf8"));
const listingId: string = fixture.listings[0].listingId;
const originalPrice: number = fixture.listings[0].unitPriceCents;

function seedBytes(mutate: (seed: ReturnType<typeof JSON.parse>) => void): Buffer {
  const seed = JSON.parse(fixtureBytes.toString("utf8"));
  mutate(seed);
  return Buffer.from(JSON.stringify(seed));
}

describe.skipIf(connectionString === undefined)("seed import against PostgreSQL", () => {
  const databaseName = `cartoptix_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString });
  let client: pg.Client;

  /** The first listing's price, which the mutated seeds below change. */
  const firstPrice = async () =>
    (await client.query("SELECT unit_price_cents FROM listings WHERE listing_id = $1", [listingId]))
      .rows[0]?.unit_price_cents;
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
    await runMigrations(client);
    const applied = await count("drizzle.__drizzle_migrations");
    await runMigrations(client);

    // Compare the count against itself rather than hardcoding how many
    // migrations exist, so adding one does not fail this test.
    expect(applied).toBeGreaterThan(0);
    expect(await count("drizzle.__drizzle_migrations")).toBe(applied);
    expect(await count("listings")).toBe(0);
  });

  it("imports a seed", async () => {
    const result = await importSeed(client, fixtureBytes);
    expect(result).toEqual({ status: "imported" });
    expect(await firstPrice()).toBe(originalPrice);
    expect(await count("products")).toBe(3);
    expect(await count("listings")).toBe(4);
    expect(await count("order_charges")).toBe(1);
    const charge = await client.query("SELECT amount_cents, waived_from_cents FROM order_charges");
    expect(charge.rows[0]).toEqual({ amount_cents: 100, waived_from_cents: 30000 });
    const rule = await client.query(
      "SELECT status, delivery_fee_cents FROM delivery_rules WHERE retailer_id = 'cold-storage'",
    );
    expect(rule.rows[0]).toEqual({ status: "unverified", delivery_fee_cents: null });
  });

  it("leaves the same data after importing the same seed again", async () => {
    expect(await importSeed(client, fixtureBytes)).toEqual({ status: "imported" });
    expect(await count("products")).toBe(3);
    expect(await count("listings")).toBe(4);
    expect(await firstPrice()).toBe(originalPrice);
  });

  it("leaves the loaded data unchanged when a seed is invalid", async () => {
    const invalid = seedBytes((seed) => {
      seed.listings[0].unitPriceCents = 999;
      seed.listings[0].productUrl = "https://evil.example/x";
    });
    expect((await importSeed(client, invalid)).status).toBe("invalid");
    expect(await firstPrice()).toBe(originalPrice);
  });

  it("rolls back a load that fails partway, keeping the loaded data", async () => {
    // Valid JSON and a valid seed, but PostgreSQL rejects NUL characters, so the
    // listings insert fails after the earlier tables have loaded.
    const failing = seedBytes((seed) => {
      seed.listings[0].unitPriceCents = 999;
      seed.listings[0].name = "Broken \u0000 name";
    });
    await expect(importSeed(client, failing)).rejects.toThrow();
    expect(await firstPrice()).toBe(originalPrice);
    expect(await count("products")).toBe(3);
    expect(await count("listings")).toBe(4);
  });

  it("replaces the data with an edited seed, and rolls back by reimporting", async () => {
    const edited = seedBytes((seed) => {
      seed.listings[0].unitPriceCents = 999;
      seed.listings.pop();
      seed.products.pop();
    });
    expect(await importSeed(client, edited)).toEqual({ status: "imported" });
    expect(await firstPrice()).toBe(999);
    expect(await count("listings")).toBe(3);
    expect(await importSeed(client, fixtureBytes)).toEqual({ status: "imported" });
    expect(await firstPrice()).toBe(originalPrice);
    expect(await count("listings")).toBe(4);
  });

  it("keeps references and uniqueness at the database level", async () => {
    await expect(
      client.query(`UPDATE listings SET product_id = 'missing' WHERE listing_id = 'redmart-i1-s1'`),
    ).rejects.toThrow(/foreign key/);
    await expect(
      client.query(
        `UPDATE listings SET product_id = 'fixture-rice-5kg' WHERE listing_id = 'fairprice-1002'`,
      ),
    ).rejects.toThrow(/unique/);
  });
});
