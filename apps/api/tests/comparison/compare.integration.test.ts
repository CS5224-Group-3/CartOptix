import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BasketCompareResponseSchema, routes } from "@cartoptix/contracts";
import pg from "pg";
import { Value } from "typebox/value";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../src/database.ts";
import { runMigrations } from "../../src/db/migrate.ts";
import { importSeed } from "../../src/seed/import.ts";
import { buildServer } from "../../src/server.ts";

/**
 * Basket comparison and readiness against a throwaway database loaded with the
 * fixture seed. Skipped without DATABASE_URL.
 */

const connectionString = process.env.DATABASE_URL;
const fixture = readFileSync(resolve(import.meta.dirname, "../seed/fixture-seed.json"));

describe.skipIf(connectionString === undefined)("basket comparison against PostgreSQL", () => {
  const databaseName = `cartoptix_compare_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString });
  let client: pg.Client;
  let database: Database;

  const request = (url: string, payload?: object) => {
    const server = buildServer({ database });
    return server
      .inject(payload === undefined ? { method: "GET", url } : { method: "POST", url, payload })
      .finally(() => server.close());
  };

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${databaseName}`);
    const url = new URL(connectionString ?? "");
    url.pathname = `/${databaseName}`;
    client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    database = createDatabase(url.toString());
  });

  afterAll(async () => {
    await database?.close();
    await client?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.end();
  });

  it("is not ready until a seed is imported", async () => {
    await runMigrations(client);
    const response = await request("/health/ready");
    expect(response.statusCode).toBe(503);
    expect(response.json().checks).toEqual({
      database: { status: "ok" },
      seed: { status: "unavailable", detail: "No seed has been imported." },
    });

    expect(await importSeed(client, fixture)).toEqual({ status: "imported" });
    expect((await request("/health/ready")).statusCode).toBe(200);
  });

  it("prices the fixture basket at each retailer", async () => {
    const response = await request(routes.compare.url, {
      lines: [{ productId: "fixture-rice-5kg", quantity: 2 }],
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Value.Check(BasketCompareResponseSchema, body)).toBe(true);
    // FairPrice 2 × 1190 + 499 delivery + 100 service charge (waived only from 30000);
    // RedMart 2 × 1250 + 599; Cold Storage has no rice and an unverified rule.
    expect(body).toMatchObject({
      status: "recommended",
      recommendedRetailerId: "fairprice",
      options: [
        {
          status: "complete",
          retailerId: "fairprice",
          deliveryCents: 499,
          orderCharges: [
            {
              label: "Synthetic service charge",
              amountCents: 100,
              waivedFromCents: 30000,
              waived: false,
            },
          ],
          totalCents: 2979,
        },
        { status: "complete", retailerId: "redmart", totalCents: 3099 },
        {
          status: "unavailable",
          retailerId: "cold-storage",
          reasons: [
            { code: "missing_products", productIds: ["fixture-rice-5kg"] },
            { code: "delivery_rule_unverified" },
          ],
        },
      ],
    });
  });

  it("reports an order below the minimum", async () => {
    const response = await request(routes.compare.url, {
      lines: [{ productId: "fixture-noodles-400g", quantity: 1 }],
    });
    expect(response.json()).toMatchObject({
      status: "no_feasible_plan",
      options: [
        { retailerId: "cold-storage" },
        {
          retailerId: "fairprice",
          reasons: [{ code: "below_minimum_order", minimumOrderCents: 1500, spendCents: 331 }],
        },
        { retailerId: "redmart" },
      ],
    });
  });

  it("rejects a product the seed does not have", async () => {
    const response = await request(routes.compare.url, {
      lines: [{ productId: "not-in-seed", quantity: 1 }],
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
  });
});
