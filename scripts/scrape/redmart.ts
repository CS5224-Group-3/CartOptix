/**
 * RedMart listings live on Lazada. A product page's data
 * (`window.__moduleData__`) gives price, crossed-out price, stock, pack size,
 * promotion tags and the "Sold by" seller, so each listing costs one page.
 * Search uses Lazada's catalogue JSON restricted to RedMart (`m=redmart`).
 *
 * Lazada answers fast or repeated requests with a slider check (a "punish"
 * page). Everything here goes through one browser profile, kept in
 * `.cache/lazada-profile`, at a slow pace, using the installed Google Chrome
 * when there is one, as an ordinary visitor would. When the check appears, a
 * headed run waits for the operator to complete it in the window; a headless
 * run stops at once. Nothing here solves or evades the check.
 */
import { resolve } from "node:path";
import { type BrowserContext, chromium, type Page } from "@playwright/test";
import { pause, USER_AGENT } from "./http.ts";
import {
  clean,
  dollars,
  type Observation,
  PROMOTION_SEPARATOR,
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

/** The installed Google Chrome when there is one, else Playwright's Chromium. */
async function launch(headed: boolean): Promise<BrowserContext> {
  const settings = { headless: !headed, locale: "en-SG" };
  try {
    return await chromium.launchPersistentContext(PROFILE, { ...settings, channel: "chrome" });
  } catch {
    return chromium.launchPersistentContext(PROFILE, { ...settings, userAgent: USER_AGENT });
  }
}

export class ChallengeError extends Error {
  override readonly name = "ChallengeError";
}

export interface CatalogueItem {
  name: string;
  productUrl: string;
  packageInfo?: string;
}

/** What one SKU's page data says, read from Lazada's untyped page modules. */
interface Fields {
  product?: { title?: string; brand?: { name?: string } };
  price_grocer?: Record<
    string,
    { data?: { price?: { priceNumber?: number; originalPriceNumber?: number } } }
  >;
  skuInfos?: Record<string, { stock?: number; image?: string }>;
  product_attributes_grocer?: Record<
    string,
    { data?: { attributes?: { name: string; value: string }[] } }
  >;
  promotionTags?: { data?: Record<string, { name?: string }[]> };
}

/** A product page's data as an observation; throws when the price is not there. */
export function observe(data: unknown, url: string, seller: string): Observation {
  const fields = (data as { data?: { root?: { fields?: Fields } } } | null)?.data?.root?.fields;
  const sku = Object.keys(fields?.price_grocer ?? {})[0];
  const price = sku ? fields?.price_grocer?.[sku]?.data?.price : undefined;
  if (!fields || !sku || price?.priceNumber === undefined || !fields.product?.title) {
    throw new Error(`RedMart page ${url} has no price data`);
  }
  const original = price.originalPriceNumber ?? 0;
  const sale = original > price.priceNumber;
  const image = fields.skuInfos?.[sku]?.image;
  return {
    retailer: "redmart",
    "product url": url,
    "Product Name": clean(fields.product.title),
    "Product Price": dollars(price.priceNumber),
    "Original Price": sale ? dollars(original) : "",
    Specification: clean(
      fields.product_attributes_grocer?.[sku]?.data?.attributes?.find((a) => a.name === "Pack Size")
        ?.value,
    ),
    // Promotion tags, such as "Any 2 For $6.30", in the retailer's wording.
    Savings: (fields.promotionTags?.data?.[sku] ?? [])
      .map((tag) => clean(tag.name))
      .filter(Boolean)
      .join(PROMOTION_SEPARATOR),
    "in-stock": (fields.skuInfos?.[sku]?.stock ?? 0) > 0 ? "Yes" : "No",
    "Image URL": image ? new URL(image, "https://www.lazada.sg").href : "",
    brand: clean(fields.product.brand?.name),
    // Empty when the seller could not be read; such a listing needs a hand check.
    seller,
  };
}

export const isChallenge = (url: string) =>
  url.includes("_____tmd_____") || url.includes("/punish");

/**
 * The seller of a product page's data: the "Sold by:" entry when there is one,
 * "RedMart" when the page's seller module is RedMart's and names no other
 * seller, and null when the data is incomplete or ambiguous, so the listing
 * goes to a hand check rather than being assumed RedMart's.
 */
export function sellerFrom(data: unknown): string | null {
  const fields = (data as { data?: { root?: { fields?: Record<string, unknown> } } } | null)?.data
    ?.root?.fields;
  if (!fields?.price_grocer) return null;
  const soldBy = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      const entry = value as { subtitlePrefix?: unknown; subtitle?: unknown };
      if (entry.subtitlePrefix === "Sold by:" && typeof entry.subtitle === "string") {
        soldBy.add(clean(entry.subtitle));
      }
      Object.values(value).forEach(walk);
    }
  };
  walk(data);
  if (soldBy.size === 1) return [...soldBy][0] || null;
  if (soldBy.size > 1) return null;
  return (fields.seller as { name?: unknown } | undefined)?.name === "RedMart" ? "RedMart" : null;
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
    context ??= await launch(options.headed ?? false);
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

  /** Catalogue results; an answer without the catalogue's structure is a failure. */
  async function catalogue(query: string): Promise<CatalogueItem[]> {
    const loaded = await visit(`${CATALOGUE}${encodeURIComponent(query)}`);
    const body = await loaded.evaluate(() => document.body.innerText);
    const data = JSON.parse(body) as { mods?: { listItems?: CatalogueItem[] } };
    if (!data.mods || typeof data.mods !== "object") {
      throw new Error(`Lazada catalogue answered ${query} without results data`);
    }
    return data.mods.listItems ?? [];
  }

  /** A product page's data once its second step (prices, seller) has arrived, or null. */
  async function pageData(url: string): Promise<{ data: unknown; gone: boolean }> {
    const loaded = await visit(url);
    await loaded
      .waitForFunction(
        // biome-ignore lint/suspicious/noExplicitAny: Lazada's page data is untyped.
        () => (window as any).__moduleData__?.data?.root?.fields?.price_grocer !== undefined,
        null,
        { timeout: 20_000 },
      )
      .catch(() => undefined);
    return loaded.evaluate(() => ({
      // biome-ignore lint/suspicious/noExplicitAny: Lazada's page data is untyped.
      data: (window as any).__moduleData__ ?? null,
      gone: /this product is no longer available/i.test(document.body.innerText),
    }));
  }

  async function seller(url: string): Promise<string> {
    return sellerFrom((await pageData(url)).data) ?? "";
  }

  return {
    seller,
    async product(url): Promise<ProductResult> {
      const { data, gone } = await pageData(url);
      // Lazada's own "no longer available" page, without product data, is the
      // evidence of removal; any other page without prices fails in `observe`.
      if (gone && sellerFrom(data) === null) return "not_found";
      return observe(data, url, sellerFrom(data) ?? "");
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
