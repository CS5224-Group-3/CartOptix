// Manages the PostgreSQL connection pool and database health lifecycle.
import type { DependencyCheck } from "@cartoptix/contracts";
import pg from "pg";

/**
 * Minimal PostgreSQL access for the readiness check.
 *
 * Schema, migrations and query modelling belong to the data workstream (#4);
 * this file deliberately holds only what the health endpoints need.
 */

export interface Database {
  checkConnection(): Promise<DependencyCheck>;
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

  return {
    async checkConnection(): Promise<DependencyCheck> {
      try {
        await pool.query("SELECT 1");
        return { status: "ok" };
      } catch (error) {
        return {
          status: "unavailable",
          detail: error instanceof Error ? error.message : "Unknown database error",
        };
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
