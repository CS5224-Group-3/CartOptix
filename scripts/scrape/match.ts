/**
 * Name rules for a search hit: the first gate before the AI review (PR-02).
 * A hit passes when its pack size equals the product's exactly and its name
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

/** Total pack size in base units, e.g. "6 x 1.5L" → "9000ml"; null when absent. */
export function packKey(text: string): string | null {
  const match = text.toLowerCase().match(SIZE);
  if (!match) return null;
  const [, count = "1", amount = "0", unit = ""] = match;
  const [base, factor] = UNITS[unit] ?? [unit, 1];
  return `${Math.round(Number(count) * Number(amount) * factor * 1000) / 1000}${base}`;
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
  const pack = packKey(product.specification) ?? packKey(product.name);
  const hitPack = packKey(hit.specification) ?? packKey(hit.name);
  const brand = [...words(product.name)][0];
  return (
    pack !== null &&
    pack === hitPack &&
    brand !== undefined &&
    words(hit.name).has(brand) &&
    similarity(product.name, hit.name) >= MIN_SIMILARITY
  );
}
