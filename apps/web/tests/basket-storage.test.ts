import { MAX_BASKET_LINES, MAX_PACKS_PER_LINE, MIN_PACKS_PER_LINE } from "@cartoptix/contracts";
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

describe("shared basket storage", () => {
  it("stores and restores product IDs and quantities in their original order", () => {
    const storage = memoryStorage();
    expect(persistBasket(lines, storage)).toBe(true);

    expect(storage.read()).toBe(
      JSON.stringify([
        { productId: "fixture-rice", quantity: 4 },
        { productId: "fixture-drink", quantity: 1 },
      ]),
    );
    expect(restoreBasket(storage)).toEqual(lines);
  });

  it("persists only product IDs and quantities, even if a line has extra runtime fields", () => {
    const storage = memoryStorage();
    const linesWithMetadata = [
      { productId: "fixture-rice", quantity: 4, name: "Rice", retailerPrice: 321 },
    ] as unknown as BasketLine[];

    expect(persistBasket(linesWithMetadata, storage)).toBe(true);
    expect(storage.read()).toBe(JSON.stringify([{ productId: "fixture-rice", quantity: 4 }]));
    expect(restoreBasket(storage)).toEqual([{ productId: "fixture-rice", quantity: 4 }]);
  });

  it("restores an empty basket without inventing products", () => {
    expect(restoreBasket(memoryStorage("[]"))).toEqual([]);
  });

  it("restores exactly 50 lines with quantities at both supported boundaries", () => {
    const basket = Array.from({ length: MAX_BASKET_LINES }, (_, index) => ({
      productId: `product-${index}`,
      quantity: index === 0 ? MIN_PACKS_PER_LINE : MAX_PACKS_PER_LINE,
    }));

    expect(restoreBasket(memoryStorage(JSON.stringify(basket)))).toEqual(basket);
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
    ["a zero quantity", JSON.stringify([{ productId: "milk", quantity: 0 }])],
    [
      "a quantity outside the supported range",
      JSON.stringify([{ productId: "milk", quantity: MAX_PACKS_PER_LINE + 1 }]),
    ],
    ["an empty product ID", JSON.stringify([{ productId: "", quantity: 1 }])],
    ["a whitespace-padded product ID", JSON.stringify([{ productId: " milk ", quantity: 1 }])],
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

  it("returns an empty basket if storage cannot be read", () => {
    expect(
      restoreBasket({
        getItem: () => {
          throw new Error("Storage access denied");
        },
        setItem: () => {},
      }),
    ).toEqual([]);
  });

  it("restores only the supported line shape when a stored entry has extra fields", () => {
    const storage = memoryStorage(
      JSON.stringify([{ productId: "milk", quantity: 2, name: "Milk", priceCents: 199 }]),
    );

    expect(restoreBasket(storage)).toEqual([{ productId: "milk", quantity: 2 }]);
  });

  it("keeps basket editing available if storage cannot be written", () => {
    expect(
      persistBasket(lines, {
        getItem: () => null,
        setItem: () => {
          throw new Error("Storage quota exceeded");
        },
      }),
    ).toBe(false);
  });

  it("leaves the last saved snapshot untouched when a write fails", () => {
    const savedSnapshot = JSON.stringify([{ productId: "milk", quantity: 1 }]);
    const value: string | null = savedSnapshot;
    const storage = {
      getItem: () => value,
      setItem: () => {
        throw new Error("Storage quota exceeded");
      },
    };

    expect(persistBasket([{ productId: "milk", quantity: 2 }], storage)).toBe(false);
    expect(value).toBe(savedSnapshot);
    expect(restoreBasket(storage)).toEqual([{ productId: "milk", quantity: 1 }]);
  });
});
