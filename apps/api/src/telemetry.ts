import type { BasketCompareResponse } from "@cartoptix/contracts";

/**
 * Structured events for CloudWatch (#21, technical E5).
 *
 * The ALB reports request counts, status codes and latency for the service as
 * a whole, which is enough for SC-05 and SC-06. What it cannot see is what a
 * comparison decided: a basket with no feasible plan is a 200 like any other,
 * so the no-feasible-plan rate the evaluation reports has to come from the
 * application.
 *
 * One line per comparison, written to stdout, shipped by the container's
 * `awslogs` driver and turned into metrics by the metric filters in
 * `infra/src/observability.ts`. The shape is a contract with those filters:
 * changing `event`, `status` or `durationMs` means changing them too.
 *
 * Deliberately not a request log. Fastify's logger stays off: a line per
 * request would multiply log volume, which #21 has to keep bounded and
 * cheap, and the ALB already counts requests.
 */

/** Emitted once per completed basket comparison. */
export interface ComparisonEvent {
  /**
   * The outcome the shopper saw, not an HTTP status.
   *
   * Taken from the shared contract rather than restated, so a change to the
   * wire values cannot leave the dashboard filtering on a status the API no
   * longer emits.
   */
  status: BasketCompareResponse["status"];
  /** Wall-clock time spent comparing, for the SC-05 p99 alongside the ALB's. */
  durationMs: number;
  /** Basket size, so latency can be read against 20- and 50-line baskets. */
  lines: number;
}

/**
 * Writes one comparison event.
 *
 * Never throws and never blocks the response: observability failing must not
 * fail a shopper's comparison.
 */
export function recordComparison(event: ComparisonEvent): void {
  try {
    console.log(JSON.stringify({ event: "comparison", ...event }));
  } catch {
    // A log line is not worth failing a request over.
  }
}
