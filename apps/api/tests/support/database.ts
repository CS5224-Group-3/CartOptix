import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

/** The shared PostgreSQL for integration tests; they skip when it is unset. */
export const connectionString = process.env.DATABASE_URL;

export const fixtureSeedBytes = readFileSync(
  resolve(import.meta.dirname, "../seed/fixture-seed.json"),
);
export const committedSeedBytes = readFileSync(
  resolve(import.meta.dirname, "../../../../data/seed/seed.json"),
);

export interface ThrowawayDatabase {
  /** Connection string for the new database. */
  url: string;
  client: pg.Client;
  drop(): Promise<void>;
}

/** Creates an empty database on the shared server, dropped again by `drop`. */
export async function createThrowawayDatabase(prefix: string): Promise<ThrowawayDatabase> {
  const admin = new pg.Client({ connectionString });
  await admin.connect();
  const name = `${prefix}_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(connectionString ?? "");
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  return {
    url: url.toString(),
    client,
    async drop() {
      await client.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}
