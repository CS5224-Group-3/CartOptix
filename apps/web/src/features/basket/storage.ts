import { MAX_BASKET_LINES, MAX_PACKS_PER_LINE, MIN_PACKS_PER_LINE } from "@cartoptix/contracts";
import type { BasketLine } from "../../demo";

export const BASKET_STORAGE_KEY = "cartoptix:basket:v1";

type BasketStorage = Pick<Storage, "getItem" | "setItem">;

function sessionStorageForTab(): BasketStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
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
export function restoreBasket(storage = sessionStorageForTab()): BasketLine[] {
  if (!storage) return [];
  try {
    const serialized = storage.getItem(BASKET_STORAGE_KEY);
    if (serialized === null) return [];
    return validStoredBasket(JSON.parse(serialized)) ?? [];
  } catch {
    return [];
  }
}

/** Stores only the product IDs and pack counts in this tab's session. */
export function persistBasket(basket: BasketLine[], storage = sessionStorageForTab()): void {
  if (!storage) return;
  try {
    storage.setItem(
      BASKET_STORAGE_KEY,
      JSON.stringify(basket.map(({ productId, quantity }) => ({ productId, quantity }))),
    );
  } catch {
    // Basket edits remain usable if browser storage is disabled or full.
  }
}
