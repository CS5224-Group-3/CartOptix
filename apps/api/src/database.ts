// Manages the PostgreSQL connection pool, readiness checks and reads for comparison.
import type { DependencyCheck } from "@cartoptix/contracts";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { type BasketData, loadBasketData } from "./comparison/store.ts";

export interface Database {
  checkConnection(): Promise<DependencyCheck>;
  /** Whether a seed has been imported, so comparisons have data to read. */
  checkSeed(): Promise<DependencyCheck>;
  loadBasket(productIds: readonly string[]): Promise<BasketData>;
  close(): Promise<void>;
}

export function createDatabase(connectionString: string): Database {
  const pool = new pg.Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 2000,
  });

  // PostgreSQL can close an idle pooled connection at any time, for example on a
  // restart. pg then emits "error" on the pool, and with no listener Node exits.
  // The pool has already discarded that client, so log and carry on; readiness
  // reports any lasting outage on its next query.
  pool.on("error", (error) => {
    console.error("Idle PostgreSQL connection failed:", error.message);
  });

  const db = drizzle(pool);

  return {
    async checkConnection(): Promise<DependencyCheck> {
      try {
        await pool.query("SELECT 1");
        return { status: "ok" };
      } catch (error) {
        return unavailable(error);
      }
    },
    async checkSeed(): Promise<DependencyCheck> {
      try {
        const result = await pool.query<{ loaded: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM retailers) AS loaded",
        );
        return result.rows[0]?.loaded
          ? { status: "ok" }
          : { status: "unavailable", detail: "No seed has been imported." };
      } catch (error) {
        return unavailable(error);
      }
    },
    loadBasket: (productIds) => loadBasketData(db, productIds),
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

function unavailable(error: unknown): DependencyCheck {
  return {
    status: "unavailable",
    detail: error instanceof Error ? error.message : "Unknown database error",
  };
}
