import type { BasketCompareRequest, BasketCompareResponse } from "@cartoptix/contracts";
import { ApiError, compareBasket } from "../../lib/api";
import { adaptComparison, placeholderProvenance, validateSnapshot } from "./adapter";
import {
  ComparisonFailure,
  type ComparisonProvenance,
  type ComparisonSource,
  PresentationDataFailure,
} from "./model";

/** Opt-in API source. App continues to use its fixture source until Phase 3B. */
export function createApiSource(
  provenance: ComparisonProvenance = placeholderProvenance,
): ComparisonSource {
  const capturedProvenance = structuredClone(provenance);
  return async (submission) => {
    const basket = structuredClone(submission.basket);
    validateSnapshot(basket);
    const body: BasketCompareRequest = {
      lines: basket.products.map(({ productId, quantity }) => ({ productId, quantity })),
    };
    let response: BasketCompareResponse;
    try {
      response = await compareBasket(body);
    } catch (error) {
      if (error instanceof ApiError) {
        const retryable =
          error.code === "invalid_request" || error.code === "not_found"
            ? false
            : error.code === "service_error" || error.status >= 500;
        throw new ComparisonFailure(error.message, retryable);
      }
      if (error instanceof SyntaxError) throw new PresentationDataFailure();
      if (error instanceof TypeError)
        throw new ComparisonFailure(
          "The comparison service could not be reached. Please retry.",
          true,
        );
      throw new PresentationDataFailure();
    }
    // Keep adaptation errors outside the transport catch: inconsistent data is not a network failure.
    return adaptComparison(response, basket, capturedProvenance);
  };
}
