import { MAX_BASKET_LINES } from "@cartoptix/contracts";
import { describe, expect, it } from "vitest";
import type { BasketLine } from "../src/demo";
import { BASKET_STORAGE_KEY, persistBasket, restoreBasket } from "../src/features/basket/storage";

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    read: () => value,
  };
}

const lines: BasketLine[] = [
  { productId: "fixture-rice", quantity: 4 },
  { productId: "fixture-drink", quantity: 1 },
];

describe("tab-session basket storage", () => {
  it("stores and restores product IDs and quantities in their original order", () => {
    const storage = memoryStorage();
    persistBasket(lines, storage);

    expect(storage.read()).toBe(
      JSON.stringify([
        { productId: "fixture-rice", quantity: 4 },
        { productId: "fixture-drink", quantity: 1 },
      ]),
    );
    expect(restoreBasket(storage)).toEqual(lines);
  });

  it("restores an empty basket without inventing products", () => {
    expect(restoreBasket(memoryStorage("[]"))).toEqual([]);
  });

  it.each([
    ["malformed JSON", "{"],
    ["non-array data", JSON.stringify({ productId: "milk", quantity: 1 })],
    [
      "duplicate product IDs",
      JSON.stringify([
        { productId: "milk", quantity: 1 },
        { productId: "milk", quantity: 2 },
      ]),
    ],
    ["a non-whole quantity", JSON.stringify([{ productId: "milk", quantity: 1.5 }])],
    [
      "a quantity outside the supported range",
      JSON.stringify([{ productId: "milk", quantity: 21 }]),
    ],
    [
      "more than 50 lines",
      JSON.stringify(
        Array.from({ length: MAX_BASKET_LINES + 1 }, (_, index) => ({
          productId: `product-${index}`,
          quantity: 1,
        })),
      ),
    ],
  ])("discards the whole snapshot when it contains %s", (_reason, serialized) => {
    expect(restoreBasket(memoryStorage(serialized))).toEqual([]);
  });

  it("uses one stable session key", () => {
    expect(BASKET_STORAGE_KEY).toBe("cartoptix:basket:v1");
  });
});
