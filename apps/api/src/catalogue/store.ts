import type { CatalogueResponse } from "@cartoptix/contracts";
import { catalogueExample } from "@cartoptix/contracts/fixtures";
import pg from "pg";

export interface CatalogueStore {
  catalogue(): Promise<CatalogueResponse>;
  close?(): Promise<void>;
}

/** Test-only store for route tests that do not require PostgreSQL. */
export function createFixtureCatalogueStore(): CatalogueStore {
  return {
    async catalogue() {
      return structuredClone(catalogueExample);
    },
  };
}

export function createDatabaseCatalogueStore(connectionString: string): CatalogueStore {
  const pool = new pg.Pool({ connectionString, max: 4 });
  return {
    async catalogue() {
      const [retailers, categories, delivery] = await Promise.all([
        pool.query<{
          retailerId: CatalogueResponse["retailers"][number]["retailerId"];
          name: string;
        }>('SELECT retailer_id AS "retailerId", name FROM retailers ORDER BY retailer_id'),
        pool.query<{ categoryId: string; name: string }>(
          'SELECT category_id AS "categoryId", name FROM categories ORDER BY category_id',
        ),
        pool.query<{
          retailerId: CatalogueResponse["retailers"][number]["retailerId"];
          status: "verified" | "unverified";
          deliveryFeeCents: number | null;
          freeDeliveryFromCents: number | null;
          minimumOrderCents: number | null;
          note: string | null;
        }>(`SELECT retailer_id AS "retailerId", status,
             delivery_fee_cents AS "deliveryFeeCents",
             free_delivery_from_cents AS "freeDeliveryFromCents",
             minimum_order_cents AS "minimumOrderCents", note
           FROM delivery_rules ORDER BY retailer_id`),
      ]);
      return {
        retailers: retailers.rows,
        categories: categories.rows,
        delivery: {
          rules: delivery.rows.map((rule) =>
            rule.status === "verified" && rule.deliveryFeeCents !== null
              ? {
                  retailerId:
                    rule.retailerId as CatalogueResponse["retailers"][number]["retailerId"],
                  status: "verified",
                  deliveryFeeCents: rule.deliveryFeeCents,
                  freeDeliveryFromCents: rule.freeDeliveryFromCents,
                  minimumOrderCents: rule.minimumOrderCents,
                  note: rule.note ?? "Verified delivery rule",
                }
              : {
                  retailerId:
                    rule.retailerId as CatalogueResponse["retailers"][number]["retailerId"],
                  status: "unavailable",
                },
          ),
        },
      };
    },
    async close() {
      await pool.end();
    },
  };
}
