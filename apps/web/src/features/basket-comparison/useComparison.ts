import { useCallback, useEffect, useRef, useState } from "react";
import {
  type BasketComparisonPresentation,
  ComparisonFailure,
  type ComparisonRequestState,
  type ComparisonSource,
  type ComparisonSubmission,
} from "./model";

/** Keep the last success independent of request state and never mutate the shopper's basket. */
export function useComparison(source: ComparisonSource) {
  const [result, setResult] = useState<BasketComparisonPresentation | null>(null);
  const [request, setRequest] = useState<ComparisonRequestState>({ phase: "idle" });
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = useCallback(
    (submission: ComparisonSubmission, onSuccess: () => void, retry = false) => {
      // A synchronous guard also blocks two submissions before React can rerender.
      if (inFlight.current) return;
      inFlight.current = true;
      const submitted = structuredClone(submission);
      setRequest({ phase: "pending", submitted, retry });
      Promise.resolve()
        .then(() => source(structuredClone(submitted)))
        .then((response) => {
          if (!mounted.current) return;
          // The originating request owns the snapshot, regardless of later basket edits.
          setResult({ ...response, submittedBasket: structuredClone(submitted.basket) });
          setRequest({ phase: "success", submitted });
          inFlight.current = false;
          onSuccess();
        })
        .catch((error: unknown) => {
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
        });
    },
    [source],
  );

  const retry = useCallback(
    (onSuccess: () => void) => {
      if (request.phase === "failure" && request.failure.retryable) {
        submit(request.submitted, onSuccess, true);
      }
    },
    [request, submit],
  );

  return { result, request, submit, retry };
}
