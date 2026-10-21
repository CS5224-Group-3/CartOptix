/**
 * RedMart listings live on Lazada. Lazada's catalogue JSON, restricted to
 * RedMart (`m=redmart`), gives price, crossed-out price, stock, pack size and
 * the multibuy badge, and a search for an item number finds that item. It does
 * not say who sells an item, so the seller comes from the product page's
 * "Sold by" line.
 *
 * Lazada answers fast or repeated requests with a slider check (a "punish"
 * page). Everything here goes through one Chromium profile, kept in
 * `.cache/lazada-profile`, at a slow pace. When the check appears, a headed
 * run waits for the operator to complete it in the window; a headless run
 * stops at once, because nothing else will clear it.
 */
import { resolve } from "node:path";
import { type BrowserContext, chromium, type Page } from "@playwright/test";
import { pause, USER_AGENT } from "./http.ts";
import {
  clean,
  dollars,
  type Observation,
  type ProductResult,
  type RetailerScraper,
  type SearchHit,
} from "./observation.ts";

const CATALOGUE = "https://www.lazada.sg/catalog/?ajax=true&m=redmart&q=";
const PROFILE = resolve(import.meta.dirname, "../../.cache/lazada-profile");
/** Between requests, in milliseconds. */
const INTERVAL = 8_000;
/** How long a headed run waits for the operator to complete the check. */
const OPERATOR_WAIT = 10 * 60_000;

export class ChallengeError extends Error {
  override readonly name = "ChallengeError";
}

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

export const isChallenge = (url: string) =>
  url.includes("_____tmd_____") || url.includes("/punish");

/** The page's "Sold by" seller, "RedMart" when there is none, or null if not loaded. */
function readSeller(): string | null {
  // Runs in the browser.
  // biome-ignore lint/suspicious/noExplicitAny: Lazada's page data is untyped.
  const data = (window as any).__moduleData__;
  if (!data?.data?.root?.fields?.price_grocer) return null;
  const soldBy = JSON.stringify(data).match(/"subtitle":"([^"]*)","subtitlePrefix":"Sold by:"/);
  return soldBy?.[1] ?? "RedMart";
}

export interface RedMartScraper extends RetailerScraper {
  /** The listing's seller, or "" when its page loaded without seller data. */
  seller(url: string): Promise<string>;
}

export function redmart(options: { headed?: boolean } = {}): RedMartScraper {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  /** Opens `url` at the pace Lazada tolerates, getting past the check if an operator can. */
  async function visit(url: string): Promise<Page> {
    context ??= await chromium.launchPersistentContext(PROFILE, {
      headless: !options.headed,
      locale: "en-SG",
      userAgent: USER_AGENT,
    });
    page ??= context.pages()[0] ?? (await context.newPage());
    await pause(INTERVAL);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (isChallenge(page.url())) {
      if (!options.headed) {
        throw new ChallengeError("Lazada is showing its slider check; run again with --headed");
      }
      console.warn("redmart: complete Lazada's check in the browser window to continue");
      await page
        .waitForURL((current) => !isChallenge(current.href), { timeout: OPERATOR_WAIT })
        .catch(() => {
          throw new ChallengeError("Lazada's check was not completed");
        });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      if (isChallenge(page.url())) throw new ChallengeError("Lazada is still showing its check");
    }
    return page;
  }

  async function catalogue(query: string): Promise<CatalogueItem[]> {
    const loaded = await visit(`${CATALOGUE}${encodeURIComponent(query)}`);
    const body = await loaded.evaluate(() => document.body.innerText);
    const data = JSON.parse(body) as { mods?: { listItems?: CatalogueItem[] } };
    return data.mods?.listItems ?? [];
  }

  async function seller(url: string): Promise<string> {
    const loaded = await visit(url);
    // The page data arrives in two steps; the seller comes with the second.
    await loaded.waitForFunction(readSeller, null, { timeout: 20_000 }).catch(() => undefined);
    return (await loaded.evaluate(readSeller)) ?? "";
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
        url: `https://www.lazada.sg${new URL(item.productUrl, "https://www.lazada.sg").pathname}`,
        name: clean(item.name),
        specification: clean(item.packageInfo),
      }));
    },
    async close() {
      await context?.close();
    },
  };
}
