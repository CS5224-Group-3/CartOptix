/**
 * Collects a snapshot for the published catalogue into data/snapshot (README
 * in scripts/scrape):
 *
 *   node scripts/scrape/refresh.ts listings [retailer…]  # every seed listing's page again
 *   node scripts/scrape/refresh.ts search [retailer…]    # retailers a product is missing from
 *   node scripts/scrape/refresh.ts sellers               # RedMart sellers left unread
 *
 * Retailers run in parallel, each one page at a time, and each writes its own
 * file (`listings-<retailer>.csv`, `candidates-<retailer>.csv`), so a retailer
 * that is challenged can be collected again later the same day. A page that is
 * gone is recorded as such; any other failure leaves that retailer's file
 * unwritten, so a file never mixes new observations with old ones.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { coldStorage } from "./coldstorage.ts";
import { fairprice } from "./fairprice.ts";
import { passesNameRules, similarity } from "./match.ts";
import {
  COLUMNS,
  fromCsv,
  type Observation,
  RETAILERS,
  type Retailer,
  type RetailerScraper,
  toCsv,
} from "./observation.ts";
import { ChallengeError, redmart } from "./redmart.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const SNAPSHOT = resolve(ROOT, "data/snapshot");
/** Search hits per missing retailer whose pages are read after the name rules. */
const HITS_PER_SEARCH = 3;
const headed = process.argv.includes("--headed");

interface Seed {
  products: { productId: string; representativeName: string }[];
  listings: {
    productId: string;
    retailerId: Retailer;
    productUrl: string;
    specification: string;
  }[];
}

const LISTING_COLUMNS = ["status", ...COLUMNS] as const;
const CANDIDATE_COLUMNS = [
  "product_id",
  "target_name",
  "target_specification",
  "similarity",
  ...COLUMNS,
] as const;
type Row = Record<string, string>;

const seed: Seed = JSON.parse(readFileSync(resolve(ROOT, "data/seed/seed.json"), "utf8"));

function scraper(retailer: Retailer): RetailerScraper {
  if (retailer === "fairprice") return fairprice;
  if (retailer === "cold-storage") return coldStorage;
  return redmart({ headed });
}

/**
 * Runs `task` for each item, in order, and writes the retailer's file only if
 * every item succeeded. Returns the failures.
 */
async function collect<T>(
  retailer: Retailer,
  file: string,
  columns: readonly string[],
  items: T[],
  task: (scraper: RetailerScraper, item: T) => Promise<Row[]>,
): Promise<string[]> {
  const client = scraper(retailer);
  const rows: Row[] = [];
  const failures: string[] = [];
  try {
    for (const [index, item] of items.entries()) {
      try {
        rows.push(...(await task(client, item)));
      } catch (error) {
        failures.push(`${retailer}: ${String(error)}`);
        // Nothing after a challenge would load either.
        if (error instanceof ChallengeError) break;
      }
      if ((index + 1) % 25 === 0) console.log(`${retailer}: ${index + 1}/${items.length}`);
    }
  } finally {
    await client.close?.();
  }
  if (failures.length === 0) {
    writeFileSync(resolve(SNAPSHOT, file), toCsv(columns, rows));
    console.log(`Wrote data/snapshot/${file}`);
  } else console.error(`${retailer}: ${failures.length} pages failed; ${file} not written`);
  return failures;
}

function listings(retailer: Retailer): Promise<string[]> {
  const items = seed.listings.filter((listing) => listing.retailerId === retailer);
  return collect(
    retailer,
    `listings-${retailer}.csv`,
    LISTING_COLUMNS,
    items,
    async (client, l) => {
      const result = await client.product(l.productUrl);
      const gone = Object.fromEntries(COLUMNS.map((column) => [column, ""]));
      return [
        result === "not_found"
          ? { ...gone, status: "not_found", retailer, "product url": l.productUrl }
          : { status: "ok", ...result },
      ];
    },
  );
}

function search(retailer: Retailer): Promise<string[]> {
  const missing = seed.products
    .filter(
      (product) =>
        !seed.listings.some((l) => l.productId === product.productId && l.retailerId === retailer),
    )
    .map((product) => ({
      product,
      specification:
        seed.listings.find((listing) => listing.productId === product.productId)?.specification ??
        "",
    }));
  const file = `candidates-${retailer}.csv`;
  return collect(retailer, file, CANDIDATE_COLUMNS, missing, async (client, item) => {
    const name = item.product.representativeName.replace(/\[BCRS\]/gi, "").trim();
    const hits = (await client.search(name))
      .filter((hit) => passesNameRules({ name, specification: item.specification }, hit))
      .sort((a, b) => similarity(name, b.name) - similarity(name, a.name))
      .slice(0, HITS_PER_SEARCH);
    const rows: Row[] = [];
    for (const hit of hits) {
      const result = await client.product(hit.url);
      if (result === "not_found") continue;
      rows.push({
        product_id: item.product.productId,
        target_name: name,
        target_specification: item.specification,
        similarity: similarity(name, hit.name).toFixed(3),
        ...(result satisfies Observation),
      });
    }
    return rows;
  });
}

const read = (file: string): Row[] =>
  existsSync(resolve(SNAPSHOT, file)) ? fromCsv(readFileSync(resolve(SNAPSHOT, file), "utf8")) : [];

/**
 * Reads again the RedMart pages whose seller an earlier pass left empty, for
 * example because Lazada challenged the browser, and records the sellers it
 * can now read in seller-checks.csv. Whatever is still empty needs a hand check.
 */
async function sellers(): Promise<string[]> {
  const checks = new Map(read("seller-checks.csv").map((row) => [row["product url"] ?? "", row]));
  const pending = ["listings-redmart.csv", "candidates-redmart.csv"]
    .flatMap(read)
    .filter(
      (row) =>
        row.status !== "not_found" && !row.seller && !checks.get(row["product url"] ?? "")?.seller,
    );
  const client = redmart({ headed });
  try {
    for (const row of pending) {
      const url = row["product url"] ?? "";
      const seller = await client.seller(url);
      if (seller)
        checks.set(url, { "product url": url, "Product Name": row["Product Name"] ?? "", seller });
    }
  } finally {
    await client.close?.();
  }
  writeFileSync(
    resolve(SNAPSHOT, "seller-checks.csv"),
    toCsv(["product url", "Product Name", "seller"], [...checks.values()]),
  );
  const unread = pending.filter((row) => !checks.get(row["product url"] ?? "")?.seller).length;
  console.log(`Wrote data/snapshot/seller-checks.csv; ${unread} of ${pending.length} still unread`);
  return [];
}

const [command, ...args] = process.argv.slice(2).filter((arg) => arg !== "--headed");
const unknown = args.filter((arg) => !(RETAILERS as readonly string[]).includes(arg));
const chosen =
  args.length > 0 ? RETAILERS.filter((retailer) => args.includes(retailer)) : RETAILERS;
const step = command === "listings" ? listings : command === "search" ? search : undefined;
if (command === "sellers" ? args.length > 0 : !step || unknown.length > 0) {
  console.error(
    `Usage: node scripts/scrape/refresh.ts listings|search [${RETAILERS.join("|")}…] [--headed]\n` +
      "       node scripts/scrape/refresh.ts sellers [--headed]",
  );
  process.exit(2);
}
const failures = step ? (await Promise.all(chosen.map(step))).flat() : await sellers();
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
