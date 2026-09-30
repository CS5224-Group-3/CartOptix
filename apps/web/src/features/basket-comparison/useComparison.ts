import { useCallback, useEffect, useRef, useState } from "react";
import {
  type BasketComparisonPresentation,
  ComparisonFailure,
  type ComparisonRequestState,
  type ComparisonSource,
  type ComparisonSubmission,
} from "./model";

type Prepare = (captured: ComparisonSubmission) => Promise<ComparisonSubmission>;

/** Keep the last success independent of request state and never mutate the shopper's basket. */
export function useComparison(source: ComparisonSource) {
  const [result, setResult] = useState<BasketComparisonPresentation | null>(null);
  const [request, setRequest] = useState<ComparisonRequestState>({ phase: "idle" });
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const pipeline = useRef<{ prepare?: Prepare; source: ComparisonSource } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = useCallback(
    (
      submission: ComparisonSubmission,
      onSuccess: () => void,
      retry = false,
      prepare?: Prepare,
      attemptSource = source,
    ) => {
      // A synchronous guard also blocks two submissions before React can rerender.
      if (inFlight.current) return;
      inFlight.current = true;
      pipeline.current = { prepare, source: attemptSource };
      let submitted = structuredClone(submission);
      setRequest({ phase: "pending", submitted, retry });
      Promise.resolve()
        .then(async () => {
          if (prepare) {
            submitted = structuredClone(await prepare(structuredClone(submitted)));
            if (!mounted.current) return;
            setRequest({ phase: "pending", submitted, retry });
          }
          if (!mounted.current) return;
          return attemptSource(structuredClone(submitted));
        })
        .then(
          (response) => {
            if (!mounted.current || !response) return;
            // The originating request owns the snapshot, regardless of later basket edits.
            setResult({ ...response, submittedBasket: structuredClone(submitted.basket) });
            setRequest({ phase: "success", submitted });
            inFlight.current = false;
            try {
              onSuccess();
            } catch (error) {
              console.error("Comparison succeeded, but its UI callback failed.", error);
            }
          },
          (error: unknown) => {
            if (!mounted.current) return;
            const failure =
              error instanceof ComparisonFailure
                ? error
                : new ComparisonFailure(
                    "The comparison service could not complete the request. Your basket has been kept.",
                    true,
                  );
            setRequest({ phase: "failure", submitted, failure });
            inFlight.current = false;
          },
        );
    },
    [source],
  );

  const retry = useCallback(
    (onSuccess: () => void) => {
      if (request.phase === "failure" && request.failure.retryable) {
        submit(
          request.submitted,
          onSuccess,
          true,
          pipeline.current?.prepare,
          pipeline.current?.source,
        );
      }
    },
    [request, submit],
  );

  return { result, request, submit, retry };
}
