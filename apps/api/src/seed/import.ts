/**
 * Imports a curated seed file into PostgreSQL and makes it the active dataset.
 *
 * Validation, loading and activation happen in one transaction, so an invalid
 * or failed import leaves the previously active dataset untouched. Importing
 * the same file again changes nothing; importing an older, already-loaded seed
 * reactivates it, which is how a release rolls back. A dataset ID is immutable:
 * reusing one with different contents is refused.
 */
import { createHash } from "node:crypto";
import type pg from "pg";
import { SEED_SCHEMA_VERSION, type Seed } from "./schema.ts";
import { validateSeed } from "./validate.ts";

export type ImportResult =
  | { status: "imported" | "reactivated" | "already-active"; datasetId: string; checksum: string }
  | { status: "invalid"; errors: string[] };

/** Serialises imports; distinct from the migration lock. */
const IMPORT_LOCK = 5224_0002;

export function seedChecksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function importSeed(client: pg.ClientBase, bytes: Uint8Array): Promise<ImportResult> {
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

  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock($1)", [IMPORT_LOCK]);
    const migrated = await client.query("SELECT to_regclass('datasets') IS NOT NULL AS ok");
    if (!migrated.rows[0]?.ok) {
      throw new Error(
        "The database has no seed tables. Run: pnpm --filter @cartoptix/api db:migrate",
      );
    }

    const existing = await client.query<{ seed_checksum: string; is_active: boolean }>(
      "SELECT seed_checksum, is_active FROM datasets WHERE dataset_id = $1",
      [seed.datasetId],
    );
    const found = existing.rows[0];
    let status: "imported" | "reactivated" | "already-active";
    if (found !== undefined) {
      if (found.seed_checksum !== checksum) {
        await client.query("ROLLBACK");
        return {
          status: "invalid",
          errors: [
            `Dataset ${seed.datasetId} was already imported with different contents; give the corrected seed a new datasetId`,
          ],
        };
      }
      status = found.is_active ? "already-active" : "reactivated";
    } else {
      await loadSeed(client, seed, checksum);
      status = "imported";
    }

    if (status !== "already-active") {
      await client.query("UPDATE datasets SET is_active = false WHERE is_active");
      await client.query("UPDATE datasets SET is_active = true WHERE dataset_id = $1", [
        seed.datasetId,
      ]);
    }
    await client.query("COMMIT");
    return { status, datasetId: seed.datasetId, checksum };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function loadSeed(client: pg.ClientBase, seed: Seed, checksum: string): Promise<void> {
  const id = seed.datasetId;
  await client.query(
    `INSERT INTO datasets (dataset_id, data_kind, schema_version, seed_checksum, delivery_scenario)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, seed.dataKind, SEED_SCHEMA_VERSION, checksum, seed.delivery.scenario],
  );

  await client.query(
    `INSERT INTO retailers (dataset_id, retailer_id, name, product_url_hosts)
     SELECT $1::text, * FROM jsonb_to_recordset($2::jsonb)
       AS r(retailer_id text, name text, product_url_hosts text[])`,
    [
      id,
      JSON.stringify(
        seed.retailers.map((r) => ({
          retailer_id: r.retailerId,
          name: r.name,
          product_url_hosts: r.productUrlHosts,
        })),
      ),
    ],
  );

  await client.query(
    `INSERT INTO categories (dataset_id, category_id, name)
     SELECT $1::text, * FROM jsonb_to_recordset($2::jsonb) AS c(category_id text, name text)`,
    [id, JSON.stringify(seed.categories.map((c) => ({ category_id: c.categoryId, name: c.name })))],
  );

  for (const rule of seed.delivery.rules) {
    if (rule.status === "verified") {
      await client.query(
        `INSERT INTO delivery_rules (dataset_id, retailer_id, status, delivery_fee_cents,
           free_delivery_from_cents, minimum_order_cents, threshold_includes_mandatory_charges,
           note, sources)
         VALUES ($1, $2, 'verified', $3, $4, $5, $6, $7, $8)`,
        [
          id,
          rule.retailerId,
          rule.deliveryFeeCents,
          rule.freeDeliveryFromCents,
          rule.minimumOrderCents,
          rule.thresholdIncludesMandatoryCharges,
          rule.note,
          rule.sources,
        ],
      );
      for (const charge of rule.orderCharges) {
        await client.query(
          `INSERT INTO order_charges (dataset_id, retailer_id, label, amount_cents)
           VALUES ($1, $2, $3, $4)`,
          [id, rule.retailerId, charge.label, charge.amountCents],
        );
      }
    } else {
      await client.query(
        `INSERT INTO delivery_rules (dataset_id, retailer_id, status, note)
         VALUES ($1, $2, 'unverified', $3)`,
        [id, rule.retailerId, rule.note ?? null],
      );
    }
  }

  await client.query(
    `INSERT INTO products (dataset_id, product_id, category_id, representative_name, image_url)
     SELECT $1::text, * FROM jsonb_to_recordset($2::jsonb)
       AS p(product_id text, category_id text, representative_name text, image_url text)`,
    [
      id,
      JSON.stringify(
        seed.products.map((p) => ({
          product_id: p.productId,
          category_id: p.categoryId,
          representative_name: p.representativeName,
          image_url: p.imageUrl,
        })),
      ),
    ],
  );

  await client.query(
    `INSERT INTO listings (dataset_id, listing_id, product_id, retailer_id, source_record_id, name,
       specification, product_url, price_kind, unit_price_cents, excluded_promotions)
     SELECT $1::text, * FROM jsonb_to_recordset($2::jsonb)
       AS l(listing_id text, product_id text, retailer_id text, source_record_id text, name text,
            specification text, product_url text, price_kind text, unit_price_cents integer,
            excluded_promotions text[])`,
    [
      id,
      JSON.stringify(
        seed.listings.map((l) => ({
          listing_id: l.listingId,
          product_id: l.productId,
          retailer_id: l.retailerId,
          source_record_id: l.sourceRecordId,
          name: l.name,
          specification: l.specification,
          product_url: l.productUrl,
          price_kind: l.priceKind,
          unit_price_cents: l.unitPriceCents,
          excluded_promotions: l.excludedPromotions,
        })),
      ),
    ],
  );
}
