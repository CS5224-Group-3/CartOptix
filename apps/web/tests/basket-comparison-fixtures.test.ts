import { describe, expect, it } from "vitest";
import { comparisonFixtures, fixtureForBasket } from "../src/features/basket-comparison/fixtures";

describe("synthetic comparison fixtures", () => {
  it.each(Object.entries(comparisonFixtures))(
    "%s contains consistent complete baskets and recommendations",
    (_name, result) => {
      const complete = result.options.filter((option) => option.kind === "complete");
      for (const option of complete) {
        expect(option.lines.map(({ productId, quantity }) => ({ productId, quantity }))).toEqual(
          result.submittedBasket.products.map(({ productId, quantity }) => ({
            productId,
            quantity,
          })),
        );
        expect(option.productSubtotalCents).toBe(
          option.lines.reduce((sum, line) => sum + line.amountCents, 0),
        );
        expect(option.estimatedTotalCents).toBe(
          option.productSubtotalCents +
            option.charges.reduce((sum, charge) => sum + charge.amountCents, 0),
        );
        for (const cents of [
          option.productSubtotalCents,
          option.estimatedTotalCents,
          ...option.lines.map((line) => line.amountCents),
          ...option.charges.map((charge) => charge.amountCents),
        ]) {
          expect(Number.isSafeInteger(cents)).toBe(true);
          expect(cents).toBeGreaterThanOrEqual(0);
        }
      }
      if (result.outcome.kind === "recommended") {
        const id = result.outcome.retailerId;
        expect(complete.find((option) => option.retailer.id === id)?.estimatedTotalCents).toBe(
          Math.min(...complete.map((option) => option.estimatedTotalCents)),
        );
      } else expect(complete).toHaveLength(0);
    },
  );

  it("only supplies a fixture for matching identities and quantities, with the submitted revision", () => {
    const products = comparisonFixtures.complete?.submittedBasket.products;
    if (!products) throw new Error("Missing fixture");
    expect(fixtureForBasket("complete", [...products].reverse(), 7)?.submittedBasket.revision).toBe(
      7,
    );
    expect(comparisonFixtures.complete?.submittedBasket.revision).toBe(0);
    expect(fixtureForBasket("complete", [], 7)).toBeNull();
    expect(
      fixtureForBasket(
        "complete",
        products.map((product) => ({ ...product, quantity: 3 })),
        7,
      ),
    ).toBeNull();
    expect(
      fixtureForBasket(
        "complete",
        products.map((product) => ({ ...product, productId: "other" })),
        7,
      ),
    ).toBeNull();
    expect(fixtureForBasket("missing", products, 7)).toBeNull();
  });
});
