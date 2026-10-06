import { routes } from "@cartoptix/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../src/database.ts";
import type { ClickRecorder, ClickRecordResult } from "../src/events/outbound-click.ts";
import { buildServer } from "../src/server.ts";

/**
 * The outbound-click endpoint's contract behaviour (#19), driven through a
 * stub recorder so these cases do not need a database.
 *
 * Every response is 204 with no body, so the status code proves nothing about
 * whether a request was accepted. Each test therefore asserts what reached the
 * recorder, which is what actually decides whether an event can be stored.
 *
 * `console.warn` is stubbed throughout. It is the channel a lost event is
 * reported on (#22), so silencing it keeps the suite quiet while leaving the
 * calls assertable.
 */

const database: Database = {
  checkConnection: async () => ({ status: "ok" }),
  close: async () => {},
};

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

function serverWith(result: ClickRecordResult) {
  const seen: string[] = [];
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
  it("records a click for a known listing and passes only the listing on", async () => {
    const { server, seen } = serverWith("recorded");

    const response = await server.inject(post({ listingId: "alpha-milk" }));

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(seen).toEqual(["alpha-milk"]);
    await server.close();
  });

  it("answers the same way when the listing is unknown", async () => {
    // A caller cannot act on a rejected event, so it learns nothing from the
    // response. The listing lookup is what stops the event being stored.
    const { server, seen } = serverWith("unknown-listing");

    const response = await server.inject(post({ listingId: "does-not-exist" }));

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(seen).toEqual(["does-not-exist"]);
    // The 204 hides this, so the log line is the only trace #22 can report.
    expect(warn).toHaveBeenCalledWith(
      "Outbound click not recorded: unknown listing: does-not-exist",
    );
    await server.close();
  });

  it("answers the same way when the write is shed or fails", async () => {
    const { server } = serverWith("not_recorded");

    const response = await server.inject(post({ listingId: "alpha-milk" }));

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    await server.close();
  });

  describe("invalid requests reach 204 without reaching the recorder", () => {
    // The status code is identical to a success, so the assertion that matters
    // is that nothing was handed to the recorder.
    const invalid: [string, unknown][] = [
      ["no listing", {}],
      ["an empty listing ID", { listingId: "" }],
      ["a user identity", { listingId: "alpha-milk", userId: "someone" }],
      ["a chosen retailer", { listingId: "alpha-milk", retailerId: "fairprice" }],
      ["a chosen time", { listingId: "alpha-milk", occurredAt: "2020-01-01T00:00:00Z" }],
    ];

    for (const [name, body] of invalid) {
      it(`rejects ${name}`, async () => {
        const { server, seen } = serverWith("recorded");

        const response = await server.inject(post(body));

        expect(response.statusCode).toBe(204);
        expect(response.body).toBe("");
        expect(seen).toEqual([]);
        await server.close();
      });
    }
  });

  it("answers 204 for a body that is not JSON at all", async () => {
    // Parse failures happen before route validation, so this only reaches 204
    // because the route has its own encapsulated error handler. Without it,
    // Fastify's global handler would answer 400 with an ErrorResponse.
    const { server, seen } = serverWith("recorded");

    const response = await server.inject({
      method: "POST",
      url: routes.outboundClick.url,
      headers: { "content-type": "application/json" },
      payload: "not json",
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(seen).toEqual([]);
    await server.close();
  });

  it("coerces a non-string listing ID rather than rejecting it, which stores nothing", async () => {
    // Fastify's Ajv coerces types by default, and the shopper endpoints need
    // that for numeric query parameters, so it cannot be turned off globally.
    // A coerced value is harmless here: it is looked up like any other listing
    // ID, matches nothing, and stores no event. The lookup is the guard, not
    // the schema.
    const { server, seen } = serverWith("unknown-listing");

    const response = await server.inject(post({ listingId: 42 }));

    expect(response.statusCode).toBe(204);
    expect(seen).toEqual(["42"]);
    await server.close();
  });

  it("is absent when no recorder is wired, rather than silently discarding events", async () => {
    const server = buildServer({ database });

    const response = await server.inject(post({ listingId: "alpha-milk" }));

    expect(response.statusCode).toBe(404);
    await server.close();
  });

  describe("a lost event is logged, because the response cannot show it", () => {
    // Fastify's own logger is off, so without an explicit channel a rejected
    // request would leave no trace at all: the response is 204 either way, and
    // #22 reports lost events from these lines.
    it("logs a body that fails the schema", async () => {
      const { server } = serverWith("recorded");

      await server.inject(post({ listingId: "alpha-milk", userId: "someone" }));

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/^Outbound click not recorded: rejected request: /);
      await server.close();
    });

    it("logs a body that is not JSON, which fails before route validation", async () => {
      const { server } = serverWith("recorded");

      await server.inject({
        method: "POST",
        url: routes.outboundClick.url,
        headers: { "content-type": "application/json" },
        payload: "not json",
      });

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/^Outbound click not recorded: rejected request: /);
      await server.close();
    });

    it("says nothing when the click is recorded", async () => {
      const { server } = serverWith("recorded");

      await server.inject(post({ listingId: "alpha-milk" }));

      expect(warn).not.toHaveBeenCalled();
      await server.close();
    });
  });
});
