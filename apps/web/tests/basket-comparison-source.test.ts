import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createFixtureSource } from "../src/features/basket-comparison/fixtureSource";
import { comparisonFixtures } from "../src/features/basket-comparison/fixtures";
import {
  ComparisonFailure,
  type ComparisonSubmission,
} from "../src/features/basket-comparison/model";
import { useComparison } from "../src/features/basket-comparison/useComparison";

function submission(scenario = "complete"): ComparisonSubmission {
  const fixture = comparisonFixtures.complete;
  if (!fixture) throw new Error("Missing fixture");
  return { scenario, basket: structuredClone(fixture.submittedBasket) };
}

describe("asynchronous comparison source", () => {
  it("rejects unmatched baskets with a frontend-owned non-retryable failure", async () => {
    const source = createFixtureSource({ wait: async () => {} });
    const request = submission();
    request.basket.products = [];
    await expect(source(request)).rejects.toBeInstanceOf(ComparisonFailure);
    await expect(source(request)).rejects.toMatchObject({ retryable: false });
  });

  it("captures the source snapshot before waiting", async () => {
    const gate = Promise.withResolvers<void>();
    const source = createFixtureSource({ wait: () => gate.promise });
    const request = submission();
    const promise = source(request);
    request.basket.revision = 9;
    request.basket.products = [];
    gate.resolve();
    const result = await promise;
    expect(result.submittedBasket.revision).toBe(0);
    expect(result.submittedBasket.products).toHaveLength(2);
  });

  it("guards duplicate submissions in the same render and retains the submitted snapshot", async () => {
    const gate = Promise.withResolvers<void>();
    const source = vi.fn(createFixtureSource({ wait: () => gate.promise }));
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useComparison(source));
    const request = submission();
    act(() => {
      result.current.submit(request, onSuccess);
      result.current.submit(submission("unavailable"), onSuccess);
      request.basket.revision = 10;
      request.basket.products = [];
    });
    expect(result.current.request.phase).toBe("pending");
    await waitFor(() => expect(source).toHaveBeenCalledTimes(1));
    await act(async () => {
      gate.resolve();
    });
    expect(result.current.request.phase).toBe("success");
    expect(result.current.result?.submittedBasket.revision).toBe(0);
    expect(result.current.result?.submittedBasket.products).toHaveLength(2);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("does not navigate when a pending provider has unmounted", async () => {
    const gate = Promise.withResolvers<void>();
    const source = createFixtureSource({ wait: () => gate.promise });
    const onSuccess = vi.fn();
    const { result, unmount } = renderHook(() => useComparison(source));
    act(() => result.current.submit(submission(), onSuccess));
    unmount();
    await act(async () => {
      gate.resolve();
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

it("a throwing UI success callback cannot convert a successful comparison into a service failure", async () => {
  const source = vi.fn(createFixtureSource({ wait: async () => {} }));
  const callbackError = new Error("Navigation failed");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const { result } = renderHook(() => useComparison(source));
  act(() =>
    result.current.submit(submission(), () => {
      throw callbackError;
    }),
  );
  await waitFor(() => expect(result.current.request.phase).toBe("success"));
  expect(result.current.result?.outcome.kind).toBe("recommended");
  expect(log).toHaveBeenCalledWith(
    "Comparison succeeded, but its UI callback failed.",
    callbackError,
  );
  act(() => result.current.retry(() => {}));
  expect(source).toHaveBeenCalledTimes(1);
});
