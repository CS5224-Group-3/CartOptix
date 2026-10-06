import { routes } from "@cartoptix/contracts";
import { describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import type { ClickRecorder, ClickRecordResult } from "../src/events/outbound-click.ts";
import { buildServer } from "../src/server.ts";

/**
 * The outbound-click endpoint's contract behaviour (#19), driven through a
 * stub recorder so these cases do not need a database.
 */

const database: Database = {
  checkConnection: async () => ({ status: "ok" }),
  close: async () => {},
};

function serverWith(result: ClickRecordResult, seen: string[] = []) {
  const clickRecorder: ClickRecorder = {
    record: async (listingId) => {
      seen.push(listingId);
      return result;
    },
    close: async () => {},
  };
  return { server: buildServer({ database, clickRecorder }), seen };
}

function post(body: unknown) {
  return { method: "POST" as const, url: routes.outboundClick.url, payload: body };
}

describe("POST /api/v1/events/outbound-click", () => {
  it("accepts a click for a known listing and passes only the listing on", async () => {
    const { server, seen } = serverWith("recorded");

    const response = await server.inject(post({ listingId: "alpha-milk" }));

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "recorded" });
    expect(seen).toEqual(["alpha-milk"]);
    await server.close();
  });

  it("reports an unknown listing as not recorded rather than as a failure", async () => {
    // A rejected event must not read as a service failure: the shopper has
    // already navigated, and a 4xx would count against the error budget
    // (SC-06) without giving anyone anything to act on.
    const { server } = serverWith("unknown-listing");

    const response = await server.inject(post({ listingId: "does-not-exist" }));

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "not_recorded" });
    await server.close();
  });

  it("reports a shed or failed write as not recorded", async () => {
    const { server } = serverWith("not_recorded");

    const response = await server.inject(post({ listingId: "alpha-milk" }));

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "not_recorded" });
    await server.close();
  });

  it("rejects a body with no listing", async () => {
    const { server, seen } = serverWith("recorded");

    const response = await server.inject(post({}));

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
    expect(seen).toEqual([]);
    await server.close();
  });

  it("rejects an empty listing ID", async () => {
    const { server, seen } = serverWith("recorded");

    const response = await server.inject(post({ listingId: "" }));

    expect(response.statusCode).toBe(400);
    expect(seen).toEqual([]);
    await server.close();
  });

  it("rejects any attempt to supply identity or attribution alongside the listing", async () => {
    // The contract is a closed object, so a caller cannot smuggle in a user,
    // a retailer of its choosing or a timestamp of its own (PR-07).
    const { server, seen } = serverWith("recorded");

    for (const extra of [
      { userId: "someone" },
      { retailerId: "fairprice" },
      { occurredAt: "2020-01-01T00:00:00Z" },
      { datasetId: "another-seed" },
    ]) {
      const response = await server.inject(post({ listingId: "alpha-milk", ...extra }));
      expect(response.statusCode, JSON.stringify(extra)).toBe(400);
    }

    expect(seen).toEqual([]);
    await server.close();
  });

  it("is absent when no recorder is wired, rather than silently discarding events", async () => {
    const server = buildServer({ database });

    const response = await server.inject(post({ listingId: "alpha-milk" }));

    expect(response.statusCode).toBe(404);
    await server.close();
  });
});
