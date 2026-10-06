// The click helper must never be able to stop a shopper reaching the retailer.
import { routes } from "@cartoptix/contracts";
import { describe, expect, it, vi } from "vitest";
import { recordOutboundClick } from "../src/lib/api.ts";

/**
 * Every case here asks the same question: when tracking goes wrong, does the
 * caller notice? It must not (PR-07, #19). The helper returns nothing, throws
 * nothing, and hands the caller no promise to accidentally await.
 */

function stubBeacon(implementation: () => boolean) {
  const sendBeacon = vi.fn((_url: string, _data?: BodyInit | null) => implementation());
  vi.stubGlobal("navigator", { sendBeacon });
  return sendBeacon;
}

/** Removes sendBeacon so the fetch fallback is exercised. */
function withoutBeacon() {
  vi.stubGlobal("navigator", {});
}

/** jsdom's Blob has neither text() nor a body undici will read, so use FileReader. */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe("recordOutboundClick", () => {
  it("sends a beacon carrying only the listing", async () => {
    const sendBeacon = stubBeacon(() => true);

    recordOutboundClick("alpha-milk");

    expect(sendBeacon).toHaveBeenCalledOnce();
    const [url, data] = sendBeacon.mock.calls[0] ?? [];
    const blob = data as Blob;
    expect(url).toBe(routes.outboundClick.url);
    // The content type has to be JSON, or Fastify rejects the body.
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await readBlob(blob))).toEqual({ listingId: "alpha-milk" });
  });

  it("returns nothing, so no caller can await it before navigating", () => {
    stubBeacon(() => true);

    const returned = recordOutboundClick("alpha-milk") as unknown;

    expect(returned).toBeUndefined();
  });

  it("stays silent when the browser refuses to queue the beacon", () => {
    stubBeacon(() => false);

    expect(() => recordOutboundClick("alpha-milk")).not.toThrow();
  });

  it("stays silent when sendBeacon itself throws", () => {
    // Some privacy extensions replace sendBeacon with a thrower.
    stubBeacon(() => {
      throw new Error("blocked by extension");
    });

    expect(() => recordOutboundClick("alpha-milk")).not.toThrow();
  });

  it("falls back to a keepalive fetch where sendBeacon is missing", () => {
    withoutBeacon();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    recordOutboundClick("alpha-milk");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(routes.outboundClick.url);
    expect(init?.method).toBe(routes.outboundClick.method);
    // keepalive is what lets the request outlive the page the click is leaving.
    expect(init?.keepalive).toBe(true);
    expect(JSON.parse(init?.body as string)).toEqual({ listingId: "alpha-milk" });
  });

  it("swallows a failed fallback request instead of leaving a rejected promise", async () => {
    withoutBeacon();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
        throw new Error("network down");
      }),
    );

    expect(() => recordOutboundClick("alpha-milk")).not.toThrow();

    // Let the rejected promise settle before checking nothing escaped.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
  });

  it("stays silent when the API is unreachable entirely", () => {
    withoutBeacon();
    vi.stubGlobal("fetch", undefined);

    expect(() => recordOutboundClick("alpha-milk")).not.toThrow();
  });
});
