// Imports a seed file and activates it: pnpm --filter @cartoptix/api seed:import <file>
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { loadConfig } from "../config.ts";
import { importSeed } from "./import.ts";

const file = process.argv[2];
if (file === undefined) {
  process.stderr.write("Usage: seed:import <seed.json>\n");
  process.exit(2);
}

// pnpm runs package scripts in apps/api; resolve relative paths from where the user ran it.
const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
const client = new pg.Client({ connectionString: loadConfig().databaseUrl });
await client.connect();
try {
  const result = await importSeed(client, await readFile(path));
  if (result.status === "invalid") {
    process.stderr.write(
      `Seed rejected; the loaded data is unchanged:\n- ${result.errors.join("\n- ")}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`Seed ${result.status}.\n`);
  }
} finally {
  await client.end();
}
