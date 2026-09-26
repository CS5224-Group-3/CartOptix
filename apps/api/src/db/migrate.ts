/**
 * Applies the drizzle-kit migrations in `apps/api/migrations` that have not run
 * yet. Drizzle records applied migrations in `drizzle.__drizzle_migrations`;
 * an advisory lock stops two processes migrating at once.
 */
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type pg from "pg";

/** Same relative location from `src/db` and `dist/db`. */
export const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../migrations");

/** Arbitrary constant shared by every process that migrates this database. */
const MIGRATION_LOCK = 5224_0001;

export async function runMigrations(client: pg.Client, migrationsFolder = MIGRATIONS_DIR) {
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]);
  }
}
