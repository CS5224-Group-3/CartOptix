import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.ts";
import { createClickRecorder } from "../../src/events/outbound-click.ts";
import { importSeed } from "../../src/seed/import.ts";

/**
 * Click recording against a throwaway database on the local or CI PostgreSQL,
 * created and dropped by this file. Skipped without DATABASE_URL.
 *
 * It owns its database rather than using the developer's, both because CI
 * starts with an unmigrated one and because the seed import here replaces
 * every row: run against a shared database, this file would silently swap
 * whichever seed the developer had loaded.
 *
 * What is tested here cannot be stubbed: that an unknown listing writes
 * nothing, that the stored retailer and product come from the database rather
 * than the caller, and that a seed reimport does not take the usage history
 * with it.
 */

const connectionString = process.env.DATABASE_URL;
const fixtureBytes = readFileSync(resolve(import.meta.dirname, "../seed/fixture-seed.json"));

describe.skipIf(connectionString === undefined)("outbound click recording", () => {
  const databaseName = `cartoptix_clicks_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString });
  let url = "";
  let client: pg.Client;
  let pool: pg.Pool;
  let recorder: ReturnType<typeof createClickRecorder>;
  let listingId = "";

  const count = async (table: string) =>
    Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count);

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${databaseName}`);
    const parsed = new URL(connectionString ?? "");
    parsed.pathname = `/${databaseName}`;
    url = parsed.toString();

    client = new pg.Client({ connectionString: url });
    await client.connect();
    await runMigrations(client);

    const imported = await importSeed(client, fixtureBytes);
    if (imported.status === "invalid") {
      throw new Error(`Fixture seed rejected: ${imported.errors.join(", ")}`);
    }

    pool = new pg.Pool({ connectionString: url });
    recorder = createClickRecorder({ connectionString: url, onFailure: () => {} });

    listingId =
      (
        await pool.query<{ listing_id: string }>(
          "SELECT listing_id FROM listings ORDER BY listing_id LIMIT 1",
        )
      ).rows[0]?.listing_id ?? "";
    expect(listingId).not.toBe("");
  });

  afterAll(async () => {
    await recorder?.close();
    await pool?.end();
    await client?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.end();
  });

  it("stores a click with the retailer and product taken from the database", async () => {
    expect(await recorder.record(listingId)).toBe("recorded");

    const stored = await pool.query(
      "SELECT listing_id, retailer_id, product_id FROM click_events WHERE listing_id = $1",
      [listingId],
    );
    const expected = await pool.query<{ retailer_id: string; product_id: string }>(
      "SELECT retailer_id, product_id FROM listings WHERE listing_id = $1",
      [listingId],
    );

    expect(stored.rowCount).toBe(1);
    expect(stored.rows[0]).toMatchObject({
      listing_id: listingId,
      retailer_id: expected.rows[0]?.retailer_id,
      product_id: expected.rows[0]?.product_id,
    });
  });

  it("records the time from the server's clock, not from any caller", async () => {
    const before = await pool.query<{ now: Date }>("SELECT now() AS now");
    await recorder.record(listingId);
    const after = await pool.query<{ now: Date }>("SELECT now() AS now");

    const stored = await pool.query<{ occurred_at: Date }>(
      "SELECT occurred_at FROM click_events ORDER BY occurred_at DESC LIMIT 1",
    );
    const occurredAt = stored.rows[0]?.occurred_at;
    expect(occurredAt).toBeInstanceOf(Date);
    expect(occurredAt?.getTime()).toBeGreaterThanOrEqual(before.rows[0]?.now.getTime() ?? 0);
    expect(occurredAt?.getTime()).toBeLessThanOrEqual(after.rows[0]?.now.getTime() ?? 0);
  });

  it("stores nothing for a listing that is not in the loaded seed", async () => {
    const before = await count("click_events");

    expect(await recorder.record("not-a-real-listing")).toBe("unknown-listing");

    expect(await count("click_events")).toBe(before);
  });

  it("keeps no user, session or device column", async () => {
    // PR-07 collects no identity. A future migration adding one should fail
    // here rather than pass review unnoticed.
    const columns = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'click_events'",
    );
    expect(columns.rows.map((row) => row.column_name).sort()).toEqual([
      "event_id",
      "listing_id",
      "occurred_at",
      "product_id",
      "retailer_id",
    ]);
  });

  it("survives a seed reimport, which replaces every listing row", async () => {
    // The importer deletes and reloads every listing and product. A foreign
    // key from click_events would either block that or silently destroy the
    // usage history it exists to measure.
    await recorder.record(listingId);
    const before = await count("click_events");
    expect(before).toBeGreaterThan(0);

    // Asserting the exact result, not just "not invalid": since #43 the
    // importer always deletes and reloads, so anything other than "imported"
    // means it silently stopped replacing rows and this test would otherwise
    // keep passing against stale listings.
    const reimported = await importSeed(client, fixtureBytes);
    expect(reimported).toEqual({ status: "imported" });

    expect(await count("click_events")).toBe(before);
  });

  it("handles a burst of concurrent clicks without losing track of what it stored", async () => {
    await pool.query("DELETE FROM click_events");

    const results = await Promise.all(Array.from({ length: 50 }, () => recorder.record(listingId)));

    // Shedding under load is allowed; miscounting what reached storage is not,
    // because usage reporting (#22) depends on the difference.
    const recorded = results.filter((result) => result === "recorded").length;
    expect(results.some((result) => result === "unknown-listing")).toBe(false);
    expect(await count("click_events")).toBe(recorded);
  });
});
