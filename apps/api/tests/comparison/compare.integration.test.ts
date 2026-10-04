import {
  type BasketCompareRequest,
  type BasketCompareResponse,
  BasketCompareResponseSchema,
  MAX_BASKET_LINES,
  MAX_PACKS_PER_LINE,
  routes,
} from "@cartoptix/contracts";
import { Value } from "typebox/value";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../src/database.ts";
import { runMigrations } from "../../src/db/migrate.ts";
import { importSeed } from "../../src/seed/import.ts";
import { buildServer } from "../../src/server.ts";
import {
  committedSeedBytes,
  connectionString,
  createThrowawayDatabase,
  fixtureSeedBytes,
  type ThrowawayDatabase,
} from "../support/database.ts";

/**
 * Basket comparison against throwaway databases: one loaded with
 * the hand-checked fixture seed, one with the committed seed. Skipped without
 * DATABASE_URL.
 */

type Lines = BasketCompareRequest["lines"];

/** Migrates a throwaway database and serves the API over it. */
function apiOverDatabase(prefix: string) {
  let throwaway: ThrowawayDatabase;
  let database: Database;
  let server: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase(prefix);
    await runMigrations(throwaway.client);
    database = createDatabase(throwaway.url);
    server = buildServer({ database });
  });

  afterAll(async () => {
    await server?.close();
    await database?.close();
    await throwaway?.drop();
  });

  return {
    importSeed: (bytes: Uint8Array) => importSeed(throwaway.client, bytes),
    compare: (lines: Lines) =>
      server.inject({ method: "POST", url: routes.compare.url, payload: { lines } }),
  };
}

/**
 * The rules every comparison must satisfy, whatever the data: it matches the
 * contract, each complete option prices every line at its quantity and its
 * total reconciles, and a recommendation is the first and cheapest option.
 */
function expectValidComparison(body: BasketCompareResponse, lines: Lines): void {
  expect([...Value.Errors(BasketCompareResponseSchema, body)]).toEqual([]);
  const requested = lines.map((line) => [line.productId, line.quantity]).sort();
  const complete = body.options.filter((option) => option.status === "complete");
  for (const option of complete) {
    expect(option.lines.map((line) => [line.productId, line.quantity]).sort()).toEqual(requested);
    const charges = option.orderCharges.filter((charge) => !charge.waived);
    expect(option.totalCents).toBe(
      option.lines.reduce((sum, line) => sum + line.lineTotalCents, 0) +
        charges.reduce((sum, charge) => sum + charge.amountCents, 0) +
        option.deliveryCents,
    );
  }
  if (body.status === "recommended") {
    expect(body.options[0]?.retailerId).toBe(body.recommendedRetailerId);
    expect(body.options[0]?.status).toBe("complete");
    const cheapest = Math.min(...complete.map((option) => option.totalCents));
    expect(complete[0]?.totalCents).toBe(cheapest);
  } else {
    expect(complete).toEqual([]);
  }
}

describe.skipIf(connectionString === undefined)("basket comparison on the fixture seed", () => {
  const api = apiOverDatabase("cartoptix_compare");

  beforeAll(async () => {
    expect(await api.importSeed(fixtureSeedBytes)).toEqual({ status: "imported" });
  });

  it("prices the fixture basket at each retailer", async () => {
    const lines = [{ productId: "fixture-rice-5kg", quantity: 2 }];
    const response = await api.compare(lines);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expectValidComparison(body, lines);
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
    const lines = [{ productId: "fixture-noodles-400g", quantity: 1 }];
    const body = (await api.compare(lines)).json();
    expectValidComparison(body, lines);
    expect(body).toMatchObject({
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
    const response = await api.compare([{ productId: "not-in-seed", quantity: 1 }]);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
  });
});

describe.skipIf(connectionString === undefined)("basket comparison on the committed seed", () => {
  const api = apiOverDatabase("cartoptix_seed");
  const productIds: string[] = JSON.parse(committedSeedBytes.toString("utf8")).products.map(
    (product: { productId: string }) => product.productId,
  );

  /** Compares a basket and checks it returns a valid comparison, never an error. */
  const compareValid = async (lines: Lines) => {
    const response = await api.compare(lines);
    expect(response.statusCode, response.body).toBe(200);
    const body: BasketCompareResponse = response.json();
    expectValidComparison(body, lines);
    return body;
  };

  beforeAll(async () => {
    expect(await api.importSeed(committedSeedBytes)).toEqual({ status: "imported" });
  });

  it("recommends a retailer for every product, at one pack and the most packs", async () => {
    // Every published product has an eligible offer, so it alone is always feasible.
    for (const productId of productIds) {
      for (const quantity of [1, MAX_PACKS_PER_LINE]) {
        const body = await compareValid([{ productId, quantity }]);
        expect(body.status, `${productId} × ${quantity}`).toBe("recommended");
      }
    }
  });

  it("returns a valid comparison for varied baskets, up to the largest allowed", async () => {
    // A fixed-seed generator keeps failures reproducible.
    let state = 42;
    const next = (n: number) => {
      state = (state * 1103515245 + 12345) % 2 ** 31;
      return state % n;
    };
    for (const size of [5, 20, MAX_BASKET_LINES]) {
      for (let run = 0; run < 20; run += 1) {
        const picked = new Set<string>();
        while (picked.size < size) picked.add(productIds[next(productIds.length)] ?? "");
        await compareValid(
          [...picked].map((productId) => ({ productId, quantity: 1 + next(MAX_PACKS_PER_LINE) })),
        );
      }
    }
    await compareValid(
      productIds
        .slice(0, MAX_BASKET_LINES)
        .map((productId) => ({ productId, quantity: MAX_PACKS_PER_LINE })),
    );
  });
});
