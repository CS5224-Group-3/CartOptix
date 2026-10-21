/**
 * Collects a snapshot for the published catalogue into data/snapshot (README
 * in scripts/scrape):
 *
 *   node scripts/scrape/refresh.ts new                   # start a snapshot: clear the last one's files
 *   node scripts/scrape/refresh.ts listings [retailer…]  # every catalogue listing's page again
 *   node scripts/scrape/refresh.ts search [retailer…]    # retailers a product is missing from
 *   node scripts/scrape/refresh.ts sellers               # RedMart sellers left unread
 *
 * The catalogue is the seed plus the products that dropped out of it
 * (data/seed/retired.json), so a product can come back. Retailers run in
 * parallel, each one page at a time, and each writes its own file
 * (`listings-<retailer>.csv`, `candidates-<retailer>.csv`), so a retailer that
 * is challenged can be collected again later the same day. A page that is gone
 * is recorded as such; any other failure deletes that retailer's file, so a
 * failed refresh cannot leave an earlier observation for the build to use.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { type Options, parseOptions } from "./args.ts";
import { loadCheckpoint, saveCheckpoint } from "./checkpoint.ts";
import { coldStorage } from "./coldstorage.ts";
import { fairprice } from "./fairprice.ts";
import { passesNameRules, similarity } from "./match.ts";
import {
  COLUMNS,
  fromCsv,
  needsSeller,
  type Observation,
  type Retailer,
  type RetailerScraper,
  toCsv,
} from "./observation.ts";
import { ChallengeError, CheckBudgetError, redmart } from "./redmart.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const SNAPSHOT = resolve(ROOT, "data/snapshot");
let options: Options;
try {
  options = parseOptions(process.argv.slice(2));
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}
const { headed, maxChecks } = options;

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

const load = (file: string): Seed =>
  existsSync(resolve(ROOT, file))
    ? JSON.parse(readFileSync(resolve(ROOT, file), "utf8"))
    : { products: [], listings: [] };
/**
 * The seed this snapshot replaces. `new` copies it to data/snapshot/base, so
 * every step, and the build, works from the same catalogue even after the seed
 * is rebuilt; before that, the seed itself is the base.
 */
const BASE = existsSync(resolve(SNAPSHOT, "base/seed.json")) ? "data/snapshot/base" : "data/seed";
const current = load(`${BASE}/seed.json`);
const retired = load(`${BASE}/retired.json`);
/** Every product ever published, and its listings. */
const seed: Seed = {
  products: [...retired.products, ...current.products],
  listings: [...retired.listings, ...current.listings],
};

function scraper(retailer: Retailer): RetailerScraper {
  if (retailer === "fairprice") return fairprice;
  if (retailer === "cold-storage") return coldStorage;
  return redmart({ headed, maxChecks });
}

/**
 * Runs `task` for each item, in order, saving progress after each one to
 * `<file>.checkpoint.json`, so a stopped run resumes where it left off. The
 * retailer's file is written only once every item has succeeded.
 *
 * If Lazada shows more checks than `--max-checks` allows, the items not yet
 * collected are recorded as `skip` gives them (a listing as "skipped", which
 * is never published from an earlier observation) and the file is written.
 */
async function collect<T>(
  retailer: Retailer,
  file: string,
  columns: readonly string[],
  items: T[],
  key: (item: T) => string,
  task: (scraper: RetailerScraper, item: T) => Promise<Row[]>,
  skip: (item: T) => Row[] = () => [],
): Promise<string[]> {
  const checkpoint = resolve(SNAPSHOT, `${file}.checkpoint.json`);
  const saved = loadCheckpoint(checkpoint);
  const done = new Set(saved.done);
  const rows: Row[] = saved.rows;
  const save = () => saveCheckpoint(checkpoint, { done: [...done], rows });
  const pending = items.filter((item) => !done.has(key(item)));
  if (done.size > 0)
    console.log(`${retailer}: resuming, ${done.size} done, ${pending.length} to go`);
  const client = scraper(retailer);
  const failures: string[] = [];
  let skipped = 0;
  try {
    for (const [index, item] of pending.entries()) {
      try {
        rows.push(...(await task(client, item)));
        done.add(key(item));
        save();
      } catch (error) {
        if (error instanceof CheckBudgetError) {
          for (const rest of pending.slice(index)) rows.push(...skip(rest));
          skipped = pending.length - index;
          console.warn(`${retailer}: ${String(error)}; skipping the ${skipped} items left`);
          break;
        }
        failures.push(`${retailer}: ${String(error)}`);
        console.error(failures.at(-1));
        // Nothing after a check would load either; resume later from the checkpoint.
        if (error instanceof ChallengeError) break;
      }
      if ((index + 1) % 25 === 0) console.log(`${retailer}: ${index + 1}/${pending.length}`);
    }
  } finally {
    await client.close?.();
  }
  if (failures.length > 0) {
    rmSync(resolve(SNAPSHOT, file), { force: true });
    console.error(
      `${retailer}: ${failures.length} items failed; ${file} not written. Run again to resume.`,
    );
    return failures;
  }
  writeFileSync(resolve(SNAPSHOT, file), toCsv(columns, rows));
  rmSync(checkpoint, { force: true });
  console.log(`Wrote data/snapshot/${file}${skipped ? ` (${skipped} skipped)` : ""}`);
  return [];
}

function listings(retailer: Retailer): Promise<string[]> {
  const items = seed.listings.filter((listing) => listing.retailerId === retailer);
  return collect(
    retailer,
    `listings-${retailer}.csv`,
    LISTING_COLUMNS,
    items,
    (l) => l.productUrl,
    async (client, l) => {
      const result = await client.product(l.productUrl);
      return [
        result === "not_found"
          ? { ...blank(), status: "not_found", retailer, "product url": l.productUrl }
          : { status: "ok", ...result },
      ];
    },
    (l) => [{ ...blank(), status: "skipped", retailer, "product url": l.productUrl }],
  );
}

const blank = () => Object.fromEntries(COLUMNS.map((column) => [column, ""]));

/**
 * Records a retailer's catalogue listings as carried over, without reading
 * them: the build keeps each one exactly as the current seed has it. Used for
 * RedMart, where Lazada's checks make reading every page impractical; the
 * product owner accepted earlier prices there in exchange (PR-02).
 */
function carry(retailer: Retailer): Promise<string[]> {
  // Only the seed's listings carry prices; a retired product's have none to keep,
  // so they are recorded as skipped (not read) rather than carried.
  const inSeed = new Set(current.listings.map((listing) => listing.productUrl));
  const rows: Row[] = seed.listings
    .filter((listing) => listing.retailerId === retailer)
    .map((listing) => ({
      ...blank(),
      status: inSeed.has(listing.productUrl) ? "carried" : "skipped",
      retailer,
      "product url": listing.productUrl,
    }));
  writeFileSync(resolve(SNAPSHOT, `listings-${retailer}.csv`), toCsv(LISTING_COLUMNS, rows));
  console.log(`Wrote data/snapshot/listings-${retailer}.csv (${rows.length} carried over)`);
  return Promise.resolve([]);
}

function search(retailer: Retailer): Promise<string[]> {
  const only = options.products;
  const missing = seed.products
    .filter(
      (product) =>
        !seed.listings.some((l) => l.productId === product.productId && l.retailerId === retailer),
    )
    .filter((product) => !only || only.includes(product.productId))
    .map((product) => ({
      product,
      specification:
        seed.listings.find((listing) => listing.productId === product.productId)?.specification ??
        "",
    }));
  if (only) {
    const unknown = only.filter((id) => !missing.some((m) => m.product.productId === id));
    if (unknown.length > 0) {
      throw new Error(
        `Not missing at ${retailer} in this snapshot's catalogue: ${unknown.join(", ")}`,
      );
    }
  }
  // A targeted search adds its own file beside the full one; the build reads both.
  const file = only ? `candidates-${retailer}-targeted.csv` : `candidates-${retailer}.csv`;
  return collect(
    retailer,
    file,
    CANDIDATE_COLUMNS,
    missing,
    (item) => item.product.productId,
    async (client, item) => {
      const name = item.product.representativeName.replace(/\[BCRS\]/gi, "").trim();
      const hits = (await client.search(name))
        .filter((hit) => passesNameRules({ name, specification: item.specification }, hit))
        .sort((a, b) => similarity(name, b.name) - similarity(name, a.name))
        .slice(0, options.hits);
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
    },
  );
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
  const pending = [
    "listings-redmart.csv",
    "candidates-redmart.csv",
    "candidates-redmart-targeted.csv",
  ]
    .flatMap(read)
    .filter((row) => needsSeller(row) && !checks.get(row["product url"] ?? "")?.seller);
  const client = redmart({ headed, maxChecks });
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

/** Starts a snapshot: removes every collected file and review from the last one. */
function startSnapshot(): string[] {
  rmSync(resolve(SNAPSHOT, "base"), { recursive: true, force: true });
  mkdirSync(resolve(SNAPSHOT, "base"));
  for (const file of ["seed.json", "retired.json", "product_ids.csv"])
    if (existsSync(resolve(ROOT, "data/seed", file)))
      copyFileSync(resolve(ROOT, "data/seed", file), resolve(SNAPSHOT, "base", file));
  for (const file of readdirSync(SNAPSHOT))
    if (/\.csv$|\.checkpoint\.json(\.tmp)?$/.test(file)) rmSync(resolve(SNAPSHOT, file));
  console.log("Cleared data/snapshot for a new snapshot");
  return [];
}

const steps = { listings, carry, search } as const;
const step = options.command in steps ? steps[options.command as keyof typeof steps] : undefined;
const failures = step
  ? (await Promise.all(options.retailers.map(step))).flat()
  : options.command === "new"
    ? startSnapshot()
    : await sellers();
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
