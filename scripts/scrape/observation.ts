/**
 * What a scraper records for one retailer listing: the source workbooks'
 * columns (README in data/raw), so the existing curation rules read a refresh
 * the same way they read the original exports, plus who sells it and which
 * retailer it came from. Nothing records when it was collected (PR-06).
 */
export const RETAILERS = ["redmart", "fairprice", "cold-storage"] as const;
export type Retailer = (typeof RETAILERS)[number];

export const COLUMNS = [
  "retailer",
  "product url",
  "Product Name",
  "Product Price",
  "Original Price",
  "Specification",
  "Savings",
  "in-stock",
  "Image URL",
  "brand",
  "seller",
] as const;

export type Observation = Record<(typeof COLUMNS)[number], string> & { retailer: Retailer };

/** Separates several promotions in `Savings`, as derive_offer_prices.py expects. */
export const PROMOTION_SEPARATOR = " | ";

/** A search hit, before its page is read. */
export interface SearchHit {
  url: string;
  name: string;
  specification: string;
}

/** A page that no longer exists is an observation (unavailable), not a failure. */
export type ProductResult = Observation | "not_found";

/** The columns of candidates-<retailer>.csv: the product searched for, then the hit's page. */
export const CANDIDATE_COLUMNS = [
  "product_id",
  "target_name",
  "target_specification",
  "similarity",
  "status",
  ...COLUMNS,
] as const;

/**
 * A search hit's row: its page as read, or, when the page is gone, a negative
 * observation, which supersedes an earlier reading of the same page in the
 * build (refresh_seed.py). A search miss records nothing.
 */
export function candidateRow(
  target: { productId: string; name: string; specification: string; similarity: string },
  retailer: Retailer,
  url: string,
  result: ProductResult,
): Record<string, string> {
  const page =
    result === "not_found"
      ? {
          ...Object.fromEntries(COLUMNS.map((c) => [c, ""])),
          retailer,
          "product url": url,
          status: "not_found",
        }
      : { ...result, status: "ok" };
  return {
    product_id: target.productId,
    target_name: target.name,
    target_specification: target.specification,
    similarity: target.similarity,
    ...page,
  };
}

export interface RetailerScraper {
  product(url: string): Promise<ProductResult>;
  search(query: string): Promise<SearchHit[]>;
  close?(): Promise<void>;
}

/** Whole dollars and cents as the workbooks wrote them, e.g. "3.5" → "3.50". */
export function dollars(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/** Collapses whitespace and strips the asterisks some retailers use for emphasis. */
export function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\*/g, "").replace(/\s+/g, " ").trim();
}

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv<T extends Record<string, string>>(
  columns: readonly (keyof T & string)[],
  rows: readonly T[],
): string {
  return `${[columns.join(","), ...rows.map((row) => columns.map((c) => csvField(row[c] ?? "")).join(","))].join("\n")}\n`;
}

/** Parses the CSV `toCsv` writes. */
export function fromCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field || record.length) records.push([...record, field]);
  const [header = [], ...rows] = records;
  return rows.map((row) => Object.fromEntries(header.map((name, i) => [name, row[i] ?? ""])));
}

/**
 * Whether a collected RedMart row still needs its seller read: its page was
 * read but showed no seller. A gone or skipped listing is never revisited.
 */
export function needsSeller(row: Record<string, string>): boolean {
  // Candidate rows written before they had a status were all read pages.
  const read = !row.status || row.status === "ok";
  return read && row.retailer === "redmart" && !row.seller;
}
