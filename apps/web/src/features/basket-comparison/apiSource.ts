import type { BasketCompareRequest, BasketCompareResponse } from "@cartoptix/contracts";
import { compareBasket } from "../../lib/api";
import { adaptComparison, validateSnapshot } from "./adapter";
import { classifyApiFailure } from "./failures";
import type { ComparisonSource } from "./model";

/** API source for normal basket comparisons. */
export function createApiSource(): ComparisonSource {
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
      throw classifyApiFailure(error);
    }
    // Keep adaptation errors outside the transport catch: inconsistent data is not a network failure.
    return adaptComparison(response, basket);
  };
}
