import type { BasketComparisonPresentation } from "./model";

export type RecommendationValidation =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "valid"; retailerId: string; tied: boolean };

/** Validate UI-owned identities and basket coverage before displaying purchase or recommendation claims.
 * This never selects a retailer or replaces the supplied recommendation.
 */
export function validateRecommendation(
  result: BasketComparisonPresentation,
): RecommendationValidation {
  const retailerIds = result.options.map((option) => option.retailer.id);
  if (new Set(retailerIds).size !== retailerIds.length) return { kind: "invalid" };

  const products = result.submittedBasket.products;
  const requested = new Map(products.map((product) => [product.productId, product.quantity]));
  if (products.length === 0 || requested.size !== products.length) return { kind: "invalid" };
  for (const option of result.options) {
    if (option.kind !== "complete") continue;
    const suppliedIds = new Set(option.lines.map((line) => line.productId));
    if (
      option.lines.length !== requested.size ||
      suppliedIds.size !== option.lines.length ||
      option.lines.some(
        (line) => !requested.has(line.productId) || requested.get(line.productId) !== line.quantity,
      )
    )
      return { kind: "invalid" };
  }

  if (result.outcome.kind !== "recommended") return { kind: "none" };
  const suppliedId = result.outcome.retailerId;
  const supplied = result.options.find((option) => option.retailer.id === suppliedId);
  if (supplied?.kind !== "complete") return { kind: "invalid" };
  const complete = result.options.filter((option) => option.kind === "complete");
  const minimum = Math.min(...complete.map((option) => option.estimatedTotalCents));
  if (supplied.estimatedTotalCents !== minimum) return { kind: "invalid" };
  return {
    kind: "valid",
    retailerId: suppliedId,
    tied: complete.filter((option) => option.estimatedTotalCents === minimum).length > 1,
  };
}
