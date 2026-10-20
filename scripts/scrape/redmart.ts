/**
 * RedMart listings live on Lazada. Lazada's catalogue JSON, restricted to
 * RedMart (`m=redmart`), gives price, crossed-out price, stock, pack size and
 * the multibuy badge without a browser, and a search for an item number finds
 * that item. It does not say who sells an item, so the seller comes from the
 * product page's "Sold by" line, read with Chromium. Lazada challenges
 * browsers that read many pages quickly, so pages are read slowly, and a page
 * still challenged after backing off leaves the seller empty for a hand check.
 */
import { type Browser, chromium, type Page } from "@playwright/test";
import { fetchText, pause, USER_AGENT } from "./http.ts";
import {
  clean,
  dollars,
  type Observation,
  type ProductResult,
  type RetailerScraper,
  type SearchHit,
} from "./observation.ts";

const CATALOGUE = "https://www.lazada.sg/catalog/?ajax=true&m=redmart&q=";
/** Between product pages, and after a challenge, in milliseconds. */
const PAGE_INTERVAL = 15_000;
const CATALOGUE_INTERVAL = 8_000;
const CHALLENGE_BACKOFF = [60_000, 180_000, 600_000];

export interface CatalogueItem {
  itemId: string;
  name: string;
  productUrl: string;
  price: string;
  originalPrice?: string | null;
  inStock: boolean;
  packageInfo?: string;
  image?: string;
  brandName?: string;
  icons?: { alias?: string; text?: string }[];
}

/** Lazada answers too many catalogue requests with a challenge page instead of JSON. */
async function catalogue(query: string): Promise<CatalogueItem[]> {
  for (const backoff of [CATALOGUE_INTERVAL, ...CHALLENGE_BACKOFF]) {
    await pause(backoff);
    const body = await fetchText(`${CATALOGUE}${encodeURIComponent(query)}`);
    if (body === null) return [];
    if (body.trimStart().startsWith("{")) {
      const data = JSON.parse(body) as { mods?: { listItems?: CatalogueItem[] } };
      return data.mods?.listItems ?? [];
    }
    console.warn(`redmart: catalogue challenged for ${query}; backing off`);
  }
  throw new Error(`Lazada catalogue still challenged for ${query}`);
}

const pdpUrl = (item: CatalogueItem) =>
  `https://www.lazada.sg${new URL(item.productUrl, "https://www.lazada.sg").pathname}`;

export function observe(item: CatalogueItem, url: string, seller: string): Observation {
  const price = Number(item.price);
  const original = Number(item.originalPrice ?? 0);
  const sale = original > price;
  return {
    retailer: "redmart",
    "product url": url,
    "Product Name": clean(item.name),
    "Product Price": dollars(price),
    "Original Price": sale ? dollars(original) : "",
    Specification: clean(item.packageInfo),
    Savings: clean(item.icons?.find((icon) => icon.alias === "p_multibuy")?.text),
    "in-stock": item.inStock ? "Yes" : "No",
    "Image URL": item.image ?? "",
    brand: clean(item.brandName),
    // Empty when the page could not be read; such a listing needs a hand check.
    seller,
  };
}

/** The page's "Sold by" seller, "RedMart" when there is none, or null if unreadable. */
function readSeller(): string | null {
  // Runs in the browser.
  // biome-ignore lint/suspicious/noExplicitAny: Lazada's page data is untyped.
  const data = (window as any).__moduleData__;
  if (!data?.data?.root?.fields?.price_grocer) return null;
  const soldBy = JSON.stringify(data).match(/"subtitle":"([^"]*)","subtitlePrefix":"Sold by:"/);
  return soldBy?.[1] ?? "RedMart";
}

export interface RedMartScraper extends RetailerScraper {
  /** The listing's seller, or "" when its page could not be read. */
  seller(url: string): Promise<string>;
}

export function redmart(options: { headed?: boolean } = {}): RedMartScraper {
  let browser: Browser | undefined;
  let page: Page | undefined;
  /** Set once a page stays challenged after every back-off; later pages are not tried. */
  let blocked = false;

  async function seller(url: string): Promise<string> {
    if (blocked) return "";
    browser ??= await chromium.launch({ headless: !options.headed });
    page ??= await browser.newPage({ locale: "en-SG", userAgent: USER_AGENT });
    for (const backoff of [0, ...CHALLENGE_BACKOFF]) {
      await pause(backoff || PAGE_INTERVAL);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        // The page data arrives in two steps; the seller comes with the second.
        await page.waitForFunction(readSeller, null, { timeout: 20_000 });
        return (await page.evaluate(readSeller)) ?? "";
      } catch {
        console.warn(`redmart: no page data for ${url}; backing off`);
      }
    }
    blocked = true;
    console.warn("redmart: still challenged; remaining sellers are left for a hand check");
    return "";
  }

  return {
    seller,
    async product(url): Promise<ProductResult> {
      const itemId = url.match(/-i(\d+)-s\d+/)?.[1];
      if (!itemId) throw new Error(`Not a Lazada product link: ${url}`);
      const item = (await catalogue(itemId)).find((candidate) => candidate.itemId === itemId);
      if (!item) return "not_found";
      return observe(item, url, await seller(url));
    },
    async search(query): Promise<SearchHit[]> {
      return (await catalogue(query)).map((item) => ({
        url: pdpUrl(item),
        name: clean(item.name),
        specification: clean(item.packageInfo),
      }));
    },
    async close() {
      await browser?.close();
    },
  };
}
