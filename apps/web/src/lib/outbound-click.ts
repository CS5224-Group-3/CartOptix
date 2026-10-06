// Records a click through to a retailer, without ever getting in its way.
import { type OutboundClickRequest, routes } from "@cartoptix/contracts";

/**
 * Reports that the shopper followed a link to a retailer's product page
 * (PR-07).
 *
 * The one rule this file exists to keep: **the link opens either way.** The
 * call is not awaited, never throws, and never returns a promise a caller
 * could accidentally block navigation on. If tracking is broken, unreachable
 * or blocked by an extension, the shopper still reaches the retailer and
 * never learns anything went wrong.
 *
 * `sendBeacon` is preferred because the browser owns the request once it is
 * queued, so it survives the page being torn down by the navigation that
 * triggered it. A plain `fetch` would usually be cancelled at exactly that
 * moment. `keepalive` gives the same survival guarantee where `sendBeacon` is
 * missing.
 *
 * Nothing identifying is sent: only the listing. The server supplies the
 * retailer, product, dataset and time, so the client cannot misattribute a
 * click and nothing here can become a user identity.
 */
export function recordOutboundClick(listingId: string): void {
  const body: OutboundClickRequest = { listingId };

  try {
    const payload = JSON.stringify(body);

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      // The browser takes ownership here; a false return means it refused to
      // queue the beacon, which is not something the shopper can act on.
      navigator.sendBeacon(
        routes.outboundClick.url,
        new Blob([payload], { type: "application/json" }),
      );
      return;
    }

    // No beacon support. `keepalive` lets the request outlive the page.
    const attempt = fetch(routes.outboundClick.url, {
      method: routes.outboundClick.method,
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
    });

    // Deliberately not awaited: the caller is navigating away. The handler is
    // here only so an unreachable API cannot surface as an unhandled
    // rejection in the shopper's console.
    attempt.catch(() => undefined);
  } catch {
    // Reaching here means the browser refused something basic, such as a
    // Blob constructor behind a strict policy. Tracking is optional; the
    // click is not.
  }
}
