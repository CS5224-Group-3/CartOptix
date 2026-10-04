// Display helpers: money formatting and visual treatment for retailers and categories.
import type { Order, RetailerId } from "@cartoptix/contracts";

export function formatSgd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "Unavailable";
  return `S$${(cents / 100).toFixed(2)}`;
}

export const RETAILER_IDS: readonly RetailerId[] = ["redmart", "fairprice", "cold-storage"];

export const RETAILER_DISPLAY: Record<
  RetailerId,
  { name: string; accent: string; initial: string; badgeClass: string; tagline: string }
> = {
  redmart: {
    name: "RedMart",
    accent: "#e85c62",
    initial: "R",
    badgeClass: "retailer-badge--red",
    tagline: "online grocery",
  },
  fairprice: {
    name: "FairPrice",
    accent: "#16866e",
    initial: "F",
    badgeClass: "retailer-badge--green",
    tagline: "everyday value",
  },
  "cold-storage": {
    name: "Cold Storage",
    accent: "#355cb4",
    initial: "C",
    badgeClass: "retailer-badge--blue",
    tagline: "fresh favourites",
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
