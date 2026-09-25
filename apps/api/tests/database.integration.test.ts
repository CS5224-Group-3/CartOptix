import pg from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";
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

    // PostgreSQL can close an idle pooled connection at any time, for example on
    // a restart. That must not take the API down; readiness should recover.
    it("survives PostgreSQL closing an idle connection, then recovers", async () => {
      const applicationName = `cartoptix-test-${process.pid}`;
      const url = new URL(connectionString ?? "");
      url.searchParams.set("application_name", applicationName);
      const target = createDatabase(url.toString());
      const admin = new pg.Client({ connectionString });
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        // Leaves one idle client in the pool.
        expect(await target.checkConnection()).toEqual({ status: "ok" });

        await admin.connect();
        const terminated = await admin.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1",
          [applicationName],
        );
        expect(terminated.rowCount).toBe(1);

        // Generous: the dropped socket can take a while to surface on a busy CI runner.
        await vi.waitFor(() => expect(logged).toHaveBeenCalled(), { timeout: 5000 });
        expect(await target.checkConnection()).toEqual({ status: "ok" });
      } finally {
        logged.mockRestore();
        await admin.end();
        await target.close();
      }
    });
  },
);

if (connectionString === undefined) {
  process.stdout.write(
    "Skipping database integration test: DATABASE_URL is not set. Run `pnpm dev` or see README.md.\n",
  );
}
