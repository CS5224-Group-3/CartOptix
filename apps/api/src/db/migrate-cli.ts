// Applies pending database migrations: pnpm --filter @cartoptix/api db:migrate
import pg from "pg";
import { loadConfig } from "../config.ts";
import { runMigrations } from "./migrate.ts";

const client = new pg.Client({ connectionString: loadConfig().databaseUrl });
await client.connect();
try {
  await runMigrations(client);
  process.stdout.write("Database migrations are up to date.\n");
} finally {
  await client.end();
}
