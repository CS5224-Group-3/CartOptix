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
