import { MAX_BASKET_LINES, MAX_PACKS_PER_LINE } from "@cartoptix/contracts";
import { describe, expect, it } from "vitest";
import type { BasketLine } from "../src/demo";
import {
  addBasketLine,
  removeBasketLine,
  setBasketLineQuantity,
} from "../src/features/basket/mutations";

const basket: BasketLine[] = [
  { productId: "milk", quantity: 2 },
  { productId: "rice", quantity: 1 },
];

describe("basket mutations", () => {
  it("adds a distinct product without changing existing products or quantities", () => {
    expect(addBasketLine(basket, "eggs", 3)).toEqual({
      basket: [...basket, { productId: "eggs", quantity: 3 }],
      changed: true,
    });
  });

  it("adds packs to the selected existing product without creating a duplicate line", () => {
    expect(addBasketLine(basket, "milk", 2)).toEqual({
      basket: [
        { productId: "milk", quantity: 4 },
        { productId: "rice", quantity: 1 },
      ],
      changed: true,
    });
  });

  it("rejects an addition that would exceed the per-product pack limit", () => {
    const fullLine = [{ productId: "milk", quantity: MAX_PACKS_PER_LINE - 1 }];
    expect(addBasketLine(fullLine, "milk", 2)).toEqual({
      basket: fullLine,
      changed: false,
      error: "pack-limit",
    });
  });

  it("rejects quantities that are not whole packs from 1 through 20", () => {
    for (const quantity of [0, 1.5, MAX_PACKS_PER_LINE + 1]) {
      expect(addBasketLine(basket, "eggs", quantity)).toEqual({
        basket,
        changed: false,
        error: "invalid-quantity",
      });
    }
  });

  it("rejects a new product when the basket already has 50 distinct lines", () => {
    const fullBasket = Array.from({ length: MAX_BASKET_LINES }, (_, index) => ({
      productId: `product-${index}`,
      quantity: 1,
    }));
    expect(addBasketLine(fullBasket, "another-product", 1)).toEqual({
      basket: fullBasket,
      changed: false,
      error: "line-limit",
    });
  });

  it("changes only the selected product to the requested quantity", () => {
    expect(setBasketLineQuantity(basket, "rice", 5)).toEqual({
      basket: [
        { productId: "milk", quantity: 2 },
        { productId: "rice", quantity: 5 },
      ],
      changed: true,
    });
  });

  it("does not mark an unchanged quantity as an edit", () => {
    expect(setBasketLineQuantity(basket, "milk", 2)).toEqual({ basket, changed: false });
  });

  it("rejects invalid quantity edits without changing the basket", () => {
    expect(setBasketLineQuantity(basket, "milk", 21)).toEqual({
      basket,
      changed: false,
      error: "invalid-quantity",
    });
  });

  it("removes only the selected product", () => {
    expect(removeBasketLine(basket, "milk")).toEqual({
      basket: [{ productId: "rice", quantity: 1 }],
      changed: true,
    });
  });

  it("does not change the basket when asked to remove an absent product", () => {
    expect(removeBasketLine(basket, "eggs")).toEqual({ basket, changed: false });
  });
});
