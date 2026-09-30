import { describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import { buildServer } from "../src/server.ts";

type Check = Awaited<ReturnType<Database["checkConnection"]>>;

function stubDatabase(connection: Check, seed: Check = { status: "ok" }): Database {
  return {
    checkConnection: async () => connection,
    checkSeed: async () => seed,
    loadBasket: async () => {
      throw new Error("Not used by health checks");
    },
    close: async () => {},
  };
}

describe("health endpoints", () => {
  it("reports liveness without consulting dependencies", async () => {
    const server = buildServer({ database: stubDatabase({ status: "unavailable" }) });

    const response = await server.inject({ method: "GET", url: "/health/live" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await server.close();
  });

  it("reports readiness when the database responds", async () => {
    const server = buildServer({ database: stubDatabase({ status: "ok" }) });

    const response = await server.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      checks: { database: { status: "ok" }, seed: { status: "ok" } },
    });
    await server.close();
  });

  it("returns 503 when no seed has been imported", async () => {
    const server = buildServer({
      database: stubDatabase({ status: "ok" }, { status: "unavailable", detail: "No seed" }),
    });

    const response = await server.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "unavailable",
      checks: { database: { status: "ok" }, seed: { status: "unavailable", detail: "No seed" } },
    });
    await server.close();
  });

  it("returns 503 and the failure detail when the database is unreachable", async () => {
    const server = buildServer({
      database: stubDatabase({ status: "unavailable", detail: "connection refused" }),
    });

    const response = await server.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "unavailable",
      checks: {
        database: { status: "unavailable", detail: "connection refused" },
        seed: { status: "unavailable", detail: "The database is unavailable." },
      },
    });
    await server.close();
  });
});
