/**
 * Checks multibuy deals against the retailers' live carts (PR-03): for each
 * sampled deal, puts `qty` packs in a cart and records the cart subtotal next
 * to the live unit price and deal wording. Nothing is ordered; each item gets a
 * fresh cart (FairPrice, as a guest).
 *
 * Cold Storage's cart needs a login, so its deals are checked as terms only:
 * the live price and deal wording from each product page, with no cart total.
 *
 *   node scripts/scrape/checkout.ts fairprice|cold-storage [--headed]
 *
 * Reads data/snapshot/checkout-sample.csv and writes
 * data/snapshot/checkout-<retailer>.csv; scripts/checkout_evidence.py compares
 * the results with our pricing rules.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Browser, chromium, type Page } from "@playwright/test";
import { coldStorage } from "./coldstorage.ts";
import { fairprice } from "./fairprice.ts";
import { fromCsv, toCsv } from "./observation.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const SNAPSHOT = resolve(ROOT, "data/snapshot");
const POSTCODE = "018956";
const COLUMNS = ["retailer", "url", "qty", "live_price", "live_savings", "cart_subtotal", "note"];

const money = (text: string | undefined) => (text ? text.replace(/[^\d.]/g, "") : "");

/** FairPrice as a guest: a fresh browser context per item, so each cart holds one line. */
async function fairpriceCart(browser: Browser, url: string, qty: number): Promise<string> {
  const context = await browser.newContext({
    locale: "en-SG",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.getByTestId("SvgAddToCart").first().click();
    await page.getByTestId("addressSearch").fill(POSTCODE);
    await page.getByText("BAYFRONT AVENUE").first().click();
    await page.getByText("Select this location").click();
    await setQuantity(page, qty);
    await page.goto("https://www.fairprice.com.sg/cart", { waitUntil: "domcontentloaded" });
    // The cart fills in after the page loads; wait until its subtotal shows an amount.
    await page.waitForFunction(() => /Subtotal\s+\$\d/.test(document.body.innerText), null, {
      timeout: 30_000,
    });
    const text = await page.evaluate(() => document.body.innerText);
    const subtotal = text.match(/Subtotal\s+(\$[\d.,]+)/)?.[1];
    if (!subtotal)
      throw new Error(`No subtotal in cart: ${text.slice(text.indexOf("Shopping cart"), 400)}`);
    return money(subtotal);
  } finally {
    await context.close();
  }
}

/** Clicks the product's "+" until its quantity box shows `qty`. */
async function setQuantity(page: Page, qty: number): Promise<void> {
  const box = page.locator("input[aria-label='quantity']").first();
  await box.waitFor({ timeout: 20_000 });
  for (let attempt = 0; attempt < qty * 3 && Number(await box.inputValue()) < qty; attempt += 1) {
    const bounds = await box.boundingBox();
    if (!bounds) throw new Error("No quantity box");
    await page.mouse.click(bounds.x + bounds.width + 28, bounds.y + bounds.height / 2);
    await page.waitForTimeout(2_000);
  }
  if (Number(await box.inputValue()) !== qty) throw new Error(`Could not set quantity ${qty}`);
}

/** Logged-in browser profiles; RedMart shares the scraper's Lazada profile. */
const PROFILES: Record<string, string> = {
  "cold-storage": resolve(ROOT, ".cache/checkout-profile"),
  redmart: resolve(ROOT, ".cache/lazada-profile"),
};
const LOGIN: Record<string, string> = {
  "cold-storage": "https://coldstorage.com.sg/",
  redmart: "https://member.lazada.sg/user/login",
};

const retailer = process.argv[2];
if (retailer === "login") {
  // Opens a window on the profile the logged-in checks use; log in, then close it.
  const site = LOGIN[process.argv[3] ?? ""];
  const profile = PROFILES[process.argv[3] ?? ""];
  if (!site || !profile) {
    throw new Error("Usage: node scripts/scrape/checkout.ts login cold-storage|redmart");
  }
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chrome",
    headless: false,
  });
  await (context.pages()[0] ?? (await context.newPage())).goto(site);
  console.log("Log in in the window, then close it.");
  await new Promise((done) => context.on("close", done));
  process.exit(0);
}
if (retailer !== "fairprice" && retailer !== "cold-storage") {
  console.error(
    "Usage: node scripts/scrape/checkout.ts fairprice|cold-storage | login cold-storage|redmart",
  );
  process.exit(2);
}
const scraper = retailer === "fairprice" ? fairprice : coldStorage;
const sample = fromCsv(readFileSync(resolve(SNAPSHOT, "checkout-sample.csv"), "utf8")).filter(
  (row) => row.retailer === retailer,
);
const browser = await chromium.launch({
  channel: "chrome",
  headless: !process.argv.includes("--headed"),
});
const rows: Record<string, string>[] = [];
try {
  for (const item of sample) {
    const url = item.url ?? "";
    const qty = Number(item.qty);
    const live = await scraper.product(url);
    const base = { retailer, url, qty: String(qty) };
    if (live === "not_found") {
      rows.push({
        ...base,
        live_price: "",
        live_savings: "",
        cart_subtotal: "",
        note: "page gone",
      });
      continue;
    }
    let subtotal = "";
    let note = "";
    if (retailer === "cold-storage") note = "terms only";
    else
      try {
        subtotal = await fairpriceCart(browser, url, qty);
      } catch (error) {
        note = String(error).split("\n")[0] ?? "";
      }
    rows.push({
      ...base,
      live_price: live["Product Price"],
      live_savings: live.Savings,
      cart_subtotal: subtotal,
      note,
    });
    console.log(
      `${live["Product Name"]}: ${qty} × ${live["Product Price"]} → cart ${subtotal || note}`,
    );
  }
} finally {
  await browser.close();
}
writeFileSync(resolve(SNAPSHOT, `checkout-${retailer}.csv`), toCsv(COLUMNS, rows));
console.log(`Wrote data/snapshot/checkout-${retailer}.csv`);
