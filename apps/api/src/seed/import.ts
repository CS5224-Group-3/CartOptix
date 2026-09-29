/**
 * Imports the curated seed file into PostgreSQL, replacing the loaded data.
 *
 * Validation happens first; deleting the old rows and loading the new ones
 * happen in one transaction, so an invalid or failed import leaves the current
 * data untouched, and a request reads either the old seed or the new one.
 * Importing the same file again leaves the same data. To roll back, import the
 * older seed file from Git.
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import {
  categories,
  deliveryRules,
  listings,
  orderCharges,
  products,
  retailers,
} from "../db/schema.ts";
import type { Seed } from "./schema.ts";
import { validateSeed } from "./validate.ts";

export type ImportResult = { status: "imported" } | { status: "invalid"; errors: string[] };

/** Serialises imports; distinct from the migration lock. */
const IMPORT_LOCK = 5224_0002;
/** Rows per INSERT, well inside PostgreSQL's 65,535-parameter limit. */
const BATCH = 1000;

export async function importSeed(client: pg.Client, bytes: Uint8Array): Promise<ImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    return { status: "invalid", errors: [`Not valid JSON: ${(error as Error).message}`] };
  }
  const validation = validateSeed(parsed);
  if (!validation.ok) return { status: "invalid", errors: validation.errors };
  const { seed } = validation;
  const db = drizzle(client);

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${IMPORT_LOCK})`);
    const migrated = await tx.execute<{ ok: boolean }>(
      sql`SELECT to_regclass('retailers') IS NOT NULL AS ok`,
    );
    if (!migrated.rows[0]?.ok) {
      throw new Error(
        "The database has no seed tables. Run: pnpm --filter @cartoptix/api db:migrate",
      );
    }

    // Children first, so every foreign key holds throughout.
    await tx.delete(orderCharges);
    await tx.delete(deliveryRules);
    await tx.delete(listings);
    await tx.delete(products);
    await tx.delete(categories);
    await tx.delete(retailers);
    await load(tx, seed);
  });
  return { status: "imported" };
}

type Transaction = Parameters<Parameters<ReturnType<typeof drizzle>["transaction"]>[0]>[0];

async function load(tx: Transaction, seed: Seed): Promise<void> {
  await tx.insert(retailers).values(seed.retailers);
  await tx.insert(categories).values(seed.categories);

  await tx.insert(deliveryRules).values(
    seed.delivery.rules.map((rule) =>
      rule.status === "verified"
        ? {
            retailerId: rule.retailerId,
            status: rule.status,
            deliveryFeeCents: rule.deliveryFeeCents,
            freeDeliveryFromCents: rule.freeDeliveryFromCents,
            minimumOrderCents: rule.minimumOrderCents,
            thresholdIncludesMandatoryCharges: rule.thresholdIncludesMandatoryCharges,
            note: rule.note,
            sources: rule.sources,
          }
        : { retailerId: rule.retailerId, status: rule.status, note: rule.note ?? null },
    ),
  );
  const charges = seed.delivery.rules.flatMap((rule) =>
    rule.status === "verified"
      ? rule.orderCharges.map((charge) => ({ retailerId: rule.retailerId, ...charge }))
      : [],
  );
  if (charges.length > 0) await tx.insert(orderCharges).values(charges);

  for (let i = 0; i < seed.products.length; i += BATCH) {
    await tx.insert(products).values(seed.products.slice(i, i + BATCH));
  }
  for (let i = 0; i < seed.listings.length; i += BATCH) {
    await tx.insert(listings).values(seed.listings.slice(i, i + BATCH));
  }
}
