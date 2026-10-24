/**
 * Name rules for a search hit: the first gate before the AI review (PR-02).
 * A hit passes when its pack configuration equals the product's exactly and its name
 * shares the brand and most of the product's words. Passing is necessary, not
 * sufficient: only matches the AI also confirms with high confidence publish.
 */

const UNITS: Record<string, [string, number]> = {
  g: ["g", 1],
  gm: ["g", 1],
  kg: ["g", 1000],
  ml: ["ml", 1],
  l: ["ml", 1000],
  ltr: ["ml", 1000],
  litre: ["ml", 1000],
  s: ["pc", 1],
  pcs: ["pc", 1],
  pc: ["pc", 1],
  sheets: ["pc", 1],
};
const SIZE = /(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kg|gm|g|ml|ltr|litre|l|pcs|pc|sheets|s)\b/i;

/**
 * Pack configuration as pack count and per-pack size in base units, e.g.
 * "6 x 1.5L" → "6x1500ml" and "1kg" → "1x1000g"; null when absent. Count and
 * size stay separate, so 2 × 500 g is not 1 kg (PR-01).
 */
export function packKey(text: string): string | null {
  const match = text.toLowerCase().match(SIZE);
  if (!match) return null;
  const [, count = "1", amount = "0", unit = ""] = match;
  const [base, factor] = UNITS[unit] ?? [unit, 1];
  return `${Number(count)}x${Math.round(Number(amount) * factor * 1000) / 1000}${base}`;
}

/**
 * The pack a listing states, or null when it states none or its title and
 * specification contradict each other (quarantined, never matched).
 */
function statedPack(item: { name: string; specification: string }): string | null {
  const fromSpec = packKey(item.specification);
  const fromName = packKey(item.name);
  if (fromSpec && fromName && fromSpec !== fromName) return null;
  return fromSpec ?? fromName;
}

/** Name words, without sizes, punctuation or filler. */
export function words(name: string): Set<string> {
  const text = name
    .toLowerCase()
    .replace(/\[bcrs\]/g, " ")
    .replace(new RegExp(SIZE.source, "gi"), " ");
  return new Set(
    text
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 1 && !["brand", "the", "and", "with"].includes(word)),
  );
}

export function similarity(left: string, right: string): number {
  const a = words(left);
  const b = words(right);
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / (a.size + b.size - shared || 1);
}

export const MIN_SIMILARITY = 0.5;

/** Whether a hit can be the product: same pack, its brand word, similar name. */
export function passesNameRules(
  product: { name: string; specification: string },
  hit: { name: string; specification: string },
): boolean {
  const pack = statedPack(product);
  const hitPack = statedPack(hit);
  const brand = [...words(product.name)][0];
  return (
    pack !== null &&
    pack === hitPack &&
    brand !== undefined &&
    words(hit.name).has(brand) &&
    similarity(product.name, hit.name) >= MIN_SIMILARITY
  );
}

/**
 * Search text for a product: its name without the pack size, which retailers
 * often leave out of a title (the name rules check the size separately).
 */
export function searchQuery(name: string): string {
  return name
    .replace(/\[bcrs\]/gi, " ")
    .replace(new RegExp(SIZE.source, "gi"), " ")
    .replace(/\s+/g, " ")
    .trim();
}
