import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordComparison } from "../src/telemetry.ts";

/**
 * The comparison event's shape is a contract with the CloudWatch metric
 * filters in `infra/src/observability.ts` (#21). These tests pin the field
 * names and the envelope, so renaming one here fails rather than silently
 * emptying a dashboard widget nobody is watching during the load exercise.
 */

let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  log.mockRestore();
});

function emitted(): unknown {
  return JSON.parse(String(log.mock.calls[0]?.[0]));
}

describe("recordComparison", () => {
  it("writes one JSON line tagged as a comparison event", () => {
    recordComparison({ status: "recommended", durationMs: 12.5, lines: 20 });

    expect(log).toHaveBeenCalledTimes(1);
    expect(emitted()).toEqual({
      event: "comparison",
      status: "recommended",
      durationMs: 12.5,
      lines: 20,
    });
  });

  it("reports a basket with no feasible plan, which the ALB cannot see", () => {
    // This outcome is a 200 like any other, so the rate the evaluation
    // reports can only come from the application.
    recordComparison({ status: "no_feasible_plan", durationMs: 3, lines: 50 });

    expect(emitted()).toMatchObject({ event: "comparison", status: "no_feasible_plan" });
  });

  it("never throws, so observability cannot fail a comparison", () => {
    log.mockImplementation(() => {
      throw new Error("stdout is gone");
    });

    expect(() =>
      recordComparison({ status: "recommended", durationMs: 1, lines: 1 }),
    ).not.toThrow();
  });
});
