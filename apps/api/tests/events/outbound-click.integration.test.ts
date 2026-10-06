import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClickRecorder } from "../../src/events/outbound-click.ts";
import { importSeed } from "../../src/seed/import.ts";

/**
 * Click recording against the real PostgreSQL container (#19).
 *
 * The behaviour that matters here cannot be stubbed: that an unknown listing
 * writes nothing, that the stored retailer and product come from the database
 * rather than the caller, and that a seed reimport does not take the usage
 * history with it.
 *
 * Skipped with an explicit message when DATABASE_URL is absent, so a checkout
 * without a running database reports honestly instead of failing noisily.
 */

const connectionString = process.env.DATABASE_URL;
const seedPath = resolve(import.meta.dirname, "../seed/fixture-seed.json");

describe.skipIf(connectionString === undefined)("outbound click recording", () => {
  const url = connectionString ?? "";
  const recorder = createClickRecorder({ connectionString: url, onFailure: () => {} });
  const pool = new pg.Pool({ connectionString: url });
  let listingId = "";

  beforeAll(async () => {
    // Load the fixture seed so this test owns the data it asserts on.
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const result = await importSeed(client, await readFile(seedPath));
      if (result.status === "invalid") {
        throw new Error(`Fixture seed rejected: ${result.errors.join(", ")}`);
      }
    } finally {
      await client.end();
    }

    await pool.query("DELETE FROM click_events");
    const listing = await pool.query<{ listing_id: string }>(
      "SELECT listing_id FROM listings ORDER BY listing_id LIMIT 1",
    );
    listingId = listing.rows[0]?.listing_id ?? "";
    expect(listingId).not.toBe("");
  });

  afterAll(async () => {
    await pool.query("DELETE FROM click_events");
    await recorder.close();
    await pool.end();
  });

  it("stores a click with the retailer and product taken from the database", async () => {
    expect(await recorder.record(listingId)).toBe("recorded");

    const stored = await pool.query(
      "SELECT listing_id, retailer_id, product_id FROM click_events WHERE listing_id = $1",
      [listingId],
    );
    expect(stored.rowCount).toBe(1);

    const expected = await pool.query<{ retailer_id: string; product_id: string }>(
      "SELECT retailer_id, product_id FROM listings WHERE listing_id = $1",
      [listingId],
    );
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
    const first = before.rows[0]?.now;
    const last = after.rows[0]?.now;
    expect(occurredAt).toBeInstanceOf(Date);
    expect(occurredAt?.getTime()).toBeGreaterThanOrEqual(first?.getTime() ?? 0);
    expect(occurredAt?.getTime()).toBeLessThanOrEqual(last?.getTime() ?? 0);
  });

  it("stores nothing for a listing that is not in the loaded seed", async () => {
    const before = await pool.query<{ count: string }>("SELECT count(*) FROM click_events");

    expect(await recorder.record("not-a-real-listing")).toBe("unknown-listing");

    const after = await pool.query<{ count: string }>("SELECT count(*) FROM click_events");
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
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
    const before = await pool.query<{ count: string }>("SELECT count(*) FROM click_events");

    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const result = await importSeed(client, await readFile(seedPath));
      expect(result.status).not.toBe("invalid");
    } finally {
      await client.end();
    }

    const after = await pool.query<{ count: string }>("SELECT count(*) FROM click_events");
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it("handles a burst of concurrent clicks without losing track of what it stored", async () => {
    await pool.query("DELETE FROM click_events");

    const results = await Promise.all(Array.from({ length: 50 }, () => recorder.record(listingId)));

    // Shedding under load is allowed; miscounting what reached storage is not,
    // because usage reporting (#22) depends on the difference.
    const recorded = results.filter((result) => result === "recorded").length;
    expect(results.some((result) => result === "unknown-listing")).toBe(false);

    const stored = await pool.query<{ count: string }>("SELECT count(*) FROM click_events");
    expect(Number(stored.rows[0]?.count)).toBe(recorded);
  });
});
