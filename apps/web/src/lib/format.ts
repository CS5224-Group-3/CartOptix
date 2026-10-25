// Display helpers: money formatting and visual treatment for retailers and categories.
import type { Multibuy, Order, RetailerId } from "@cartoptix/contracts";

export function formatSgd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "Unavailable";
  return `S$${(cents / 100).toFixed(2)}`;
}

export const RETAILER_IDS: readonly RetailerId[] = ["redmart", "fairprice", "cold-storage"];

export const RETAILER_DISPLAY: Record<RetailerId, { name: string; accent: string }> = {
  redmart: {
    name: "RedMart",
    accent: "#e85c62",
  },
  fairprice: {
    name: "FairPrice",
    accent: "#16866e",
  },
  "cold-storage": {
    name: "Cold Storage",
    accent: "#355cb4",
  },
};

const CATEGORY_VISUALS: Record<string, { emoji: string; accent: string }> = {
  "rice-and-noodles": { emoji: "🍚", accent: "#f6d58a" },
  drinks: { emoji: "🥤", accent: "#b9e3f0" },
  dairy: { emoji: "🥛", accent: "#eef1f5" },
  "breakfast-foods": { emoji: "🥣", accent: "#f3d9a4" },
  "canned-and-packaged-food": { emoji: "🥫", accent: "#f2b8a2" },
  snacks: { emoji: "🍪", accent: "#e8c9a0" },
  "household-cleaning": { emoji: "🧽", accent: "#c9e8d6" },
  "toiletries-and-personal-care": { emoji: "🧴", accent: "#e3d4f2" },
};

export function categoryVisual(categoryId: string): { emoji: string; accent: string } {
  return CATEGORY_VISUALS[categoryId] ?? { emoji: "🛒", accent: "#e5e9ef" };
}

/** How an order charge is described in a breakdown, including any waiver. */
export function orderChargeLabel(charge: Order["orderCharges"][number]): string {
  if (charge.waived && charge.waivedFromCents !== null)
    return `${charge.label} ${formatSgd(charge.amountCents)} waived on orders from ${formatSgd(charge.waivedFromCents)}`;
  return charge.label;
}

/**
 * How a line's multibuy is described: the deals and leftover packs it was priced
 * as and, with `hint`, what the shopper would need to buy to qualify. Wording
 * only; amounts come from the API. The basket shows no hint (PR-03). A
 * percentage deal keeps the retailer's wording, because its price is an
 * estimate from a rounded label.
 */
export function multibuyNotes(
  multibuy: Multibuy | null,
  quantity: number,
  unitPriceCents: number,
  hint = false,
): string[] {
  if (!multibuy) return [];
  const percentage = multibuy.percentOff !== null;
  const terms = percentage
    ? `${multibuy.packsPerDeal} save ${multibuy.percentOff}%`
    : `${multibuy.packsPerDeal} for ${formatSgd(multibuy.dealPriceCents)}`;
  const rest = quantity - multibuy.timesApplied * multibuy.packsPerDeal;
  const parts = [`${multibuy.timesApplied} × deal (${terms})`];
  if (rest > 0) parts.push(`${rest} × ${formatSgd(unitPriceCents)}`);
  const notes = [];
  if (multibuy.timesApplied > 0)
    notes.push(
      `${parts.join(" + ")} · You save ${percentage ? "about " : ""}${formatSgd(multibuy.savingCents)}`,
    );
  else if (hint)
    notes.push(
      percentage ? `Buy ${multibuy.packsPerDeal}, save ${multibuy.percentOff}%` : `Buy ${terms}`,
    );
  if (percentage && (multibuy.timesApplied > 0 || hint))
    notes.push("The retailer rounds this percentage, so the checkout may differ by a few cents");
  if (multibuy.mixAndMatch) notes.push("Mixing items in this deal may save more");
  return notes;
}

/** A promotion the estimate leaves out, as the retailer worded it. */
export function excludedPromotionNote(promotion: string): string {
  return `${promotion} — not included in this estimate`;
}
