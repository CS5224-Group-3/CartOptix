import type {
  BasketComparisonPresentation,
  CompleteRetailerOption,
  RetailerPresentation,
  SubmittedProduct,
} from "./model";

const products: SubmittedProduct[] = [
  {
    productId: "fixture-rice",
    name: "Synthetic White Rice",
    packDescription: "1 kg bag",
    quantity: 2,
  },
  {
    productId: "fixture-milk",
    name: "Synthetic Milk",
    packDescription: "6 × 250 ml cartons",
    quantity: 1,
  },
];

const retailers: RetailerPresentation[] = [
  { id: "fairprice", name: "FairPrice", purchaseUrl: "https://www.fairprice.com.sg/" },
  { id: "redmart", name: "RedMart", purchaseUrl: "https://www.lazada.sg/shop/redmart/" },
  { id: "cold-storage", name: "Cold Storage", purchaseUrl: "https://coldstorage.com.sg/" },
];

// Explicit fixture amounts, not a basket pricing function. Product links use reserved
// example domains so synthetic listings cannot be mistaken for retailer offers.
function complete(
  index: number,
  amounts: [number, number],
  subtotal: number,
  total: number,
): CompleteRetailerOption {
  const retailer = retailers[index];
  if (!retailer) throw new Error("Unknown fixture retailer");
  return {
    kind: "complete",
    retailer,
    lines: products.map((product, i) => ({
      ...product,
      amountCents: amounts[i] ?? 0,
      purchaseUrl: `https://example.com/${retailer.id}/${product.productId}`,
    })),
    productSubtotalCents: subtotal,
    charges: [
      { label: "Delivery", amountCents: 400 },
      { label: "Handling", amountCents: 100 },
    ],
    estimatedTotalCents: total,
  };
}

const fairprice = complete(0, [600, 500], 1100, 1600);
const redmart = complete(1, [700, 500], 1200, 1700);
const coldStorage = complete(2, [800, 600], 1400, 1900);

export const comparisonFixtures: Record<string, BasketComparisonPresentation> = {
  complete: {
    fixtureLabel: "Multiple complete retailers — cheapest recommendation",
    submittedBasket: { revision: 0, products },
    options: [fairprice, redmart, coldStorage],
    outcome: { kind: "recommended", retailerId: "fairprice" },
  },
  unavailable: {
    fixtureLabel: "One unavailable retailer",
    submittedBasket: { revision: 0, products },
    options: [
      fairprice,
      redmart,
      {
        kind: "unavailable",
        retailer: coldStorage.retailer,
        reasons: ["Synthetic Milk has no eligible offer in this fixture dataset."],
      },
    ],
    outcome: { kind: "recommended", retailerId: "fairprice" },
  },
  tie: {
    fixtureLabel: "Tied cheapest retailers",
    submittedBasket: { revision: 0, products },
    options: [fairprice, complete(1, [600, 500], 1100, 1600), coldStorage],
    // Supplied demonstration selection, not a claim about #40's tie-break order.
    outcome: { kind: "recommended", retailerId: "fairprice" },
  },
  infeasible: {
    fixtureLabel: "No feasible purchasing plan",
    submittedBasket: { revision: 0, products },
    options: retailers.map((retailer) => ({
      kind: "unavailable",
      retailer,
      reasons: [`${retailer.name} cannot supply Synthetic Milk in this fixture dataset.`],
    })),
    outcome: { kind: "no-feasible-plan" },
  },
};

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
