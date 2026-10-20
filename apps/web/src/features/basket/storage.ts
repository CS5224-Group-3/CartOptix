import { MAX_BASKET_LINES, MAX_PACKS_PER_LINE, MIN_PACKS_PER_LINE } from "@cartoptix/contracts";
import type { BasketLine } from "../../demo";

export const BASKET_STORAGE_KEY = "cartoptix:basket:v1";

type BasketStorage = Pick<Storage, "getItem" | "setItem">;

function sharedBasketStorage(): BasketStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function validStoredBasket(value: unknown): BasketLine[] | null {
  if (!Array.isArray(value) || value.length > MAX_BASKET_LINES) return null;
  const lines: BasketLine[] = [];
  const productIds = new Set<string>();

  for (const candidate of value) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate))
      return null;
    const { productId, quantity } = candidate as Record<string, unknown>;
    if (
      typeof productId !== "string" ||
      productId.length === 0 ||
      productId.trim() !== productId ||
      productIds.has(productId) ||
      !Number.isInteger(quantity) ||
      (quantity as number) < MIN_PACKS_PER_LINE ||
      (quantity as number) > MAX_PACKS_PER_LINE
    )
      return null;

    productIds.add(productId);
    lines.push({ productId, quantity: quantity as number });
  }
  return lines;
}

/** Restores only a complete, valid basket snapshot; malformed data is never partially rewritten. */
export function restoreBasket(storage = sharedBasketStorage()): BasketLine[] {
  if (!storage) return [];
  try {
    const serialized = storage.getItem(BASKET_STORAGE_KEY);
    return restoreBasketSnapshot(serialized);
  } catch {
    return [];
  }
}

/** Parses a storage event snapshot using the same validation as normal restoration. */
export function restoreBasketSnapshot(serialized: string | null): BasketLine[] {
  if (serialized === null) return [];
  try {
    return validStoredBasket(JSON.parse(serialized)) ?? [];
  } catch {
    return [];
  }
}

/** Stores only the product IDs and pack counts so the basket survives opening a new tab. */
export function persistBasket(basket: BasketLine[], storage = sharedBasketStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      BASKET_STORAGE_KEY,
      JSON.stringify(basket.map(({ productId, quantity }) => ({ productId, quantity }))),
    );
    return true;
  } catch {
    return false;
  }
}
