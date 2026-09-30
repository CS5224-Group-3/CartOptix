import { describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import { buildServer } from "../src/server.ts";

function stubDatabase(result: Awaited<ReturnType<Database["checkConnection"]>>): Database {
  return {
    checkConnection: async () => result,
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
    expect(response.json()).toEqual({ status: "ok", checks: { database: { status: "ok" } } });
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
      checks: { database: { status: "unavailable", detail: "connection refused" } },
    });
    await server.close();
  });
});
