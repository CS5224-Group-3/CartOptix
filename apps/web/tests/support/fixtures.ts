import {
  basketRequestExample,
  noFeasiblePlanExample,
  oneRetailerCompleteExample,
  productsExample,
  recommendedExample,
  tieExample,
} from "@cartoptix/contracts/fixtures";
import { adaptComparison } from "../../src/features/basket-comparison/adapter";
import type {
  BasketComparisonPresentation,
  BasketSnapshot,
} from "../../src/features/basket-comparison/model";

const basket: BasketSnapshot = {
  revision: 0,
  products: basketRequestExample.lines.map(({ productId, quantity }) => {
    const product = productsExample.products.find((product) => product.productId === productId);
    if (!product) throw new Error(`Missing shared fixture product: ${productId}`);
    return { productId, quantity, name: product.name, packDescription: product.packSize };
  }),
};

export const comparisonFixtures: Record<string, BasketComparisonPresentation> = Object.fromEntries(
  (
    [
      ["complete", "Multiple complete retailers — cheapest recommendation", recommendedExample],
      ["unavailable", "Only one complete retailer", oneRetailerCompleteExample],
      ["tie", "Tied cheapest retailers", tieExample],
      ["infeasible", "No feasible purchasing plan", noFeasiblePlanExample],
    ] as const
  ).map(([id, label, response]) => [
    id,
    {
      ...adaptComparison(response, basket, {
        kind: "synthetic",
        description: `Synthetic demonstration: ${label}. These are not retailer prices. Product links are illustrative.`,
      }),
      fixtureLabel: label,
    },
  ]),
);

/** Exact identity/quantity matching prevents displaying a canned result for another basket. */
export function fixtureForBasket(
  scenario: string,
  lines: { productId: string; quantity: number }[],
  revision: number,
): BasketComparisonPresentation | null {
  const fixture = comparisonFixtures[scenario];
  if (
    !fixture ||
    lines.length !== fixture.submittedBasket.products.length ||
    new Set(lines.map((line) => line.productId)).size !== lines.length ||
    !fixture.submittedBasket.products.every((product) =>
      lines.some(
        (line) => line.productId === product.productId && line.quantity === product.quantity,
      ),
    )
  )
    return null;
  const result = structuredClone(fixture);
  result.submittedBasket.revision = revision;
  return result;
}
