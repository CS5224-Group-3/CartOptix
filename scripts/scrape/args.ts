/** Command-line options for refresh.ts, validated before anything is collected. */
import { parseArgs } from "node:util";
import { RETAILERS, type Retailer } from "./observation.ts";

export interface Options {
  command: "new" | "listings" | "carry" | "search" | "sellers";
  retailers: readonly Retailer[];
  headed: boolean;
  /** Lazada checks a run may meet before skipping its remaining items; unlimited when absent. */
  maxChecks?: number;
  /** Search hits whose pages are read per missing product, after the name rules. */
  hits: number;
  /** `search` only: these product IDs, written to `candidates-<retailer>-targeted.csv`. */
  products?: string[];
}

export const USAGE =
  `Usage: node scripts/scrape/refresh.ts listings|carry|search [${RETAILERS.join("|")}…] [--headed] [--max-checks N] [--hits N] [--products a,b]\n` +
  "       node scripts/scrape/refresh.ts new|sellers [--headed] [--max-checks N]";

export function parseOptions(argv: string[]): Options {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      headed: { type: "boolean" },
      "max-checks": { type: "string" },
      hits: { type: "string" },
      products: { type: "string" },
    },
  });
  const [command, ...names] = positionals;
  if (
    command !== "new" &&
    command !== "listings" &&
    command !== "carry" &&
    command !== "search" &&
    command !== "sellers"
  ) {
    throw new Error(USAGE);
  }
  const unknown = names.filter((name) => !(RETAILERS as readonly string[]).includes(name));
  if (unknown.length > 0 || ((command === "new" || command === "sellers") && names.length > 0)) {
    throw new Error(USAGE);
  }
  // Only RedMart's listings may be carried over (PR-02), and only on their own.
  if (command === "carry" && (names.length !== 1 || names[0] !== "redmart")) {
    throw new Error(
      "Only RedMart can be carried over: node scripts/scrape/refresh.ts carry redmart",
    );
  }
  const products = values.products
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (products && (command !== "search" || products.length === 0)) {
    throw new Error("--products takes a comma-separated list of product IDs, with search only");
  }
  const raw = values["max-checks"];
  if (raw !== undefined && !/^\d+$/.test(raw)) {
    throw new Error(`--max-checks needs a whole number of checks, not ${JSON.stringify(raw)}`);
  }
  const hits = values.hits ?? "3";
  if (!/^[1-9]\d*$/.test(hits)) {
    throw new Error(`--hits needs a whole number of at least 1, not ${JSON.stringify(hits)}`);
  }
  return {
    command,
    retailers: names.length > 0 ? RETAILERS.filter((r) => names.includes(r)) : RETAILERS,
    headed: values.headed ?? false,
    maxChecks: raw === undefined ? undefined : Number(raw),
    hits: Number(hits),
    ...(products ? { products } : {}),
  };
}
