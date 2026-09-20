import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.ts";
import { buildServer } from "../src/server.ts";

/**
 * Integration test against the real PostgreSQL container.
 *
 * Skipped with an explicit message when DATABASE_URL is absent, so a checkout
 * without a running database still reports honestly instead of failing noisily.
 */

const connectionString = process.env.DATABASE_URL;

describe.skipIf(connectionString === undefined)(
  "readiness against the local PostgreSQL container",
  () => {
    const database = createDatabase(connectionString ?? "");

    afterAll(async () => {
      await database.close();
    });

    it("performs a real query and reports the API as ready", async () => {
      const server = buildServer({ database });

      const response = await server.inject({ method: "GET", url: "/health/ready" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ok", checks: { database: { status: "ok" } } });
      await server.close();
    });
  },
);

if (connectionString === undefined) {
  process.stdout.write(
    "Skipping database integration test: DATABASE_URL is not set. Run `pnpm dev` or see README.md.\n",
  );
}
