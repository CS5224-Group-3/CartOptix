/**
 * Applies the SQL files in `apps/api/migrations` in filename order, once each.
 *
 * Each file runs in its own transaction and is recorded in `schema_migrations`,
 * and an advisory lock stops two processes migrating at once. Migrations only
 * move forward: fix a mistake with a new file rather than editing an applied one.
 */
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type pg from "pg";

/** Same relative location from `src/db` and `dist/db`. */
export const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../migrations");

/** Arbitrary constant shared by every process that migrates this database. */
const MIGRATION_LOCK = 5224_0001;

export async function runMigrations(client: pg.ClientBase, directory = MIGRATIONS_DIR) {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();

  await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = await client.query<{ version: string }>("SELECT version FROM schema_migrations");
    const applied = new Set(done.rows.map((row) => row.version));

    const newlyApplied: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(resolve(directory, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
      newlyApplied.push(file);
    }
    return newlyApplied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]);
  }
}
