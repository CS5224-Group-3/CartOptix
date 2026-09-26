/**
 * Imports a curated seed file into PostgreSQL, replacing the loaded dataset.
 *
 * Validation happens first; deleting the old rows and loading the new ones
 * happen in one transaction, so an invalid or failed import leaves the current
 * data untouched, and a request reads either the old seed or the new one.
 * Importing the same file again changes nothing. To roll back, import the
 * older seed file from Git. A dataset ID labels one seed's contents, so reusing
 * it with different contents is refused.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import {
  categories,
  dataset,
  deliveryRules,
  listings,
  orderCharges,
  products,
  retailers,
} from "../db/schema.ts";
import { SEED_SCHEMA_VERSION, type Seed } from "./schema.ts";
import { validateSeed } from "./validate.ts";

export type ImportResult =
  | { status: "imported" | "unchanged"; datasetId: string; checksum: string }
  | { status: "invalid"; errors: string[] };

/** Serialises imports; distinct from the migration lock. */
const IMPORT_LOCK = 5224_0002;
/** Rows per INSERT, well inside PostgreSQL's 65,535-parameter limit. */
const BATCH = 1000;

class DatasetIdReused extends Error {}

export function seedChecksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

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
  const checksum = seedChecksum(bytes);
  const db = drizzle(client);

  try {
    const status = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${IMPORT_LOCK})`);
      const migrated = await tx.execute<{ ok: boolean }>(
        sql`SELECT to_regclass('dataset') IS NOT NULL AS ok`,
      );
      if (!migrated.rows[0]?.ok) {
        throw new Error(
          "The database has no seed tables. Run: pnpm --filter @cartoptix/api db:migrate",
        );
      }

      const [current] = await tx.select().from(dataset);
      if (current?.seedChecksum === checksum) return "unchanged" as const;
      if (current?.datasetId === seed.datasetId) throw new DatasetIdReused();

      // Children first, so every foreign key holds throughout.
      await tx.delete(orderCharges);
      await tx.delete(deliveryRules);
      await tx.delete(listings);
      await tx.delete(products);
      await tx.delete(categories);
      await tx.delete(retailers);
      await tx.delete(dataset);
      await load(tx, seed, checksum);
      return "imported" as const;
    });
    return { status, datasetId: seed.datasetId, checksum };
  } catch (error) {
    if (error instanceof DatasetIdReused) {
      return {
        status: "invalid",
        errors: [
          `Dataset ${seed.datasetId} is already loaded with different contents; give the corrected seed a new datasetId`,
        ],
      };
    }
    throw error;
  }
}

type Transaction = Parameters<Parameters<ReturnType<typeof drizzle>["transaction"]>[0]>[0];

async function load(tx: Transaction, seed: Seed, checksum: string): Promise<void> {
  await tx.insert(dataset).values({
    datasetId: seed.datasetId,
    dataKind: seed.dataKind,
    schemaVersion: SEED_SCHEMA_VERSION,
    seedChecksum: checksum,
    deliveryScenario: seed.delivery.scenario,
  });
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
