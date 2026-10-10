import { MAX_BASKET_LINES, MAX_PACKS_PER_LINE, MIN_PACKS_PER_LINE } from "@cartoptix/contracts";
import type { BasketLine } from "../../demo";

export type BasketMutationError = "invalid-quantity" | "line-limit" | "pack-limit";

export type BasketMutation =
  | { basket: BasketLine[]; changed: boolean; error?: undefined }
  | { basket: BasketLine[]; changed: false; error: BasketMutationError };

function validQuantity(quantity: number): boolean {
  return (
    Number.isInteger(quantity) && quantity >= MIN_PACKS_PER_LINE && quantity <= MAX_PACKS_PER_LINE
  );
}

export function addBasketLine(
  basket: BasketLine[],
  productId: string,
  quantity: number,
): BasketMutation {
  if (!validQuantity(quantity)) return { basket, changed: false, error: "invalid-quantity" };

  const existing = basket.find((line) => line.productId === productId);
  if (existing) {
    const nextQuantity = existing.quantity + quantity;
    if (nextQuantity > MAX_PACKS_PER_LINE) return { basket, changed: false, error: "pack-limit" };
    return {
      basket: basket.map((line) =>
        line.productId === productId ? { ...line, quantity: nextQuantity } : line,
      ),
      changed: true,
    };
  }

  if (basket.length >= MAX_BASKET_LINES) return { basket, changed: false, error: "line-limit" };
  return { basket: [...basket, { productId, quantity }], changed: true };
}

export function setBasketLineQuantity(
  basket: BasketLine[],
  productId: string,
  quantity: number,
): BasketMutation {
  if (!validQuantity(quantity)) return { basket, changed: false, error: "invalid-quantity" };
  const current = basket.find((line) => line.productId === productId);
  if (!current || current.quantity === quantity) return { basket, changed: false };
  return {
    basket: basket.map((line) => (line.productId === productId ? { ...line, quantity } : line)),
    changed: true,
  };
}

export function removeBasketLine(basket: BasketLine[], productId: string): BasketMutation {
  if (!basket.some((line) => line.productId === productId)) return { basket, changed: false };
  return { basket: basket.filter((line) => line.productId !== productId), changed: true };
}
