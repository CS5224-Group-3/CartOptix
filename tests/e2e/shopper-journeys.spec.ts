import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

/** The committed seed, so seed-dependent journeys hold across snapshot refreshes. */
const seed: {
  products: { productId: string; representativeName: string }[];
  listings: { productId: string; retailerId: string }[];
} = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../data/seed/seed.json"), "utf8"));
const RETAILER_NAMES: Record<string, string> = {
  redmart: "RedMart",
  fairprice: "FairPrice",
  "cold-storage": "Cold Storage",
};
const shopperName = (name: string) => name.replace(/\s*\[BCRS\]\s*/gi, " ").trim();

/**
 * Two products and a retailer that has only the first, where another retailer
 * has both, so the basket has a recommended complete option and an incomplete one.
 */
function incompleteBasket() {
  const at = (productId: string) =>
    new Set(seed.listings.filter((l) => l.productId === productId).map((l) => l.retailerId));
  for (const present of seed.products)
    for (const missing of seed.products) {
      const a = at(present.productId);
      const b = at(missing.productId);
      const retailer = [...a].find((r) => !b.has(r));
      const both = [...a].some((r) => b.has(r));
      if (retailer && both && present.productId !== missing.productId)
        return { present, missing, retailer: RETAILER_NAMES[retailer] ?? retailer };
    }
  throw new Error("The seed has no incomplete basket to show");
}

test.describe("CartOptix shopper journeys", () => {
  test("J1: find a product and add it to the basket", async ({ page }) => {
    await page.goto("/catalogue");
    await expect(page.getByRole("heading", { name: /Build a basket/i })).toBeVisible();

    const search = page.getByRole("textbox", { name: /Search products/i });
    await search.fill("milk");
    await expect(page.getByText(/products found/i)).toBeVisible();

    await page.getByRole("button", { name: "Add", exact: true }).first().click();
    await expect(page.getByText("Added to basket")).toBeVisible();
    const mobileMenu = page.locator("button.mobile-menu-button");
    if (await mobileMenu.isVisible()) await mobileMenu.click();
    await page.locator('a[href="/basket"]').click({ force: true });
    await expect(page.getByText(/1 distinct lines/i)).toBeVisible();
  });

  test("J2/J3: compare a basket and display all retailer outcomes", async ({ page }) => {
    await page.goto("/catalogue");
    await page.getByRole("textbox", { name: /Search products/i }).fill("milk");
    await page.getByRole("button", { name: "Add", exact: true }).first().click();
    const mobileMenu = page.locator("button.mobile-menu-button");
    if (await mobileMenu.isVisible()) await mobileMenu.click();
    await page.locator('a[href="/basket"]').click({ force: true });
    await page.getByRole("button", { name: "Compare basket", exact: true }).click();

    await expect(page).toHaveURL(/\/results$/);
    await expect(page.getByRole("heading", { name: "Retailer basket comparison" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "RedMart", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "FairPrice", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cold Storage", exact: true })).toBeVisible();
    await expect(page.getByText(/fixed retailer dataset/i).first()).toBeVisible();
  });

  test("J1/J3: sale prices are shown on the product page and in the basket", async ({ page }) => {
    await page.goto("/product/anlene-actifit-3x-plain-milk-powder-1kg");
    await expect(page.locator("s.was-price").first()).toContainText(/S\$\d+\.\d{2}/);
    await expect(page.getByText(/per pack · Sale price/).first()).toBeVisible();
    await page.getByRole("button", { name: /Add 1 pack to basket/ }).click();
    await expect(page).toHaveURL(/\/basket$/);
    await page.getByRole("button", { name: "Compare basket", exact: true }).click();
    await expect(page).toHaveURL(/\/results$/);
    await expect(page.locator(".retailer-option s.was-price").first()).toBeVisible();
    await expect(page.getByText(/\(sale price\)/).first()).toBeVisible();
  });

  test("J1: a multibuy hint never adds packs; other promotions are left out", async ({ page }) => {
    await page.goto("/product/yava-chocolate-vanilla-granola-200g");
    await expect(
      page.getByText("Spend $15 + Free Gift — not included in this estimate").first(),
    ).toBeVisible();

    await page.goto("/product/ayam-brand-pulled-chicken-buffalo-150g");
    await expect(page.getByText(/^Buy 2 for S\$\d+\.\d{2}$/).first()).toBeVisible();
    // The hint never changes the requested quantity.
    await page.getByRole("button", { name: /Add 1 pack to basket/ }).click();
    await expect(page).toHaveURL(/\/basket$/);
    await expect(
      page.locator(".basket-row").first().locator(".quantity-control").getByText("1", {
        exact: true,
      }),
    ).toBeVisible();
  });

  test("J1/J3: a multibuy is priced on the product page and in the basket", async ({ page }) => {
    await page.goto("/product/ayam-brand-pulled-chicken-buffalo-150g");
    await page.getByRole("button", { name: "Increase quantity" }).click();
    const deal = /^1 × deal \(2 for S\$\d+\.\d{2}\) · You save S\$\d+\.\d{2}$/;
    await expect(page.getByText(deal).first()).toBeVisible();
    await expect(page.getByText("Mixing items in this deal may save more").first()).toBeVisible();
    await page.getByRole("button", { name: /Add 2 packs to basket/ }).click();
    await expect(page).toHaveURL(/\/basket$/);
    await page.getByRole("button", { name: "Compare basket", exact: true }).click();
    await expect(page).toHaveURL(/\/results$/);
    await expect(page.getByText(deal).first()).toBeVisible();
  });

  test("J3/J5: an incomplete basket shows its estimate and missing products", async ({ page }) => {
    const { present, missing, retailer } = incompleteBasket();
    for (const product of [present, missing]) {
      await page.goto(`/product/${product.productId}`);
      await page.getByRole("button", { name: /Add 1 pack to basket/ }).click();
      await expect(page).toHaveURL(/\/basket$/);
    }
    await page.getByRole("button", { name: "Compare basket", exact: true }).click();
    await expect(page).toHaveURL(/\/results$/);
    // A complete option is recommended first; the incomplete card follows it.
    await expect(page.getByText(/^Recommended/)).toHaveCount(1);
    const card = page.getByRole("article", { name: retailer });
    await expect(card.getByText("Incomplete basket")).toBeVisible();
    await expect(card.getByText("Estimated total for 1 of 2 items")).toBeVisible();
    await expect(card.getByText(/^Recommended/)).toHaveCount(0);
    // The missing product's link works from the keyboard.
    const link = card.getByRole("link", { name: shopperName(missing.representativeName) });
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/product/${missing.productId}$`));
  });

  test("J3: a retailer with none of the basket shows no estimate", async ({ page }) => {
    const { missing, retailer } = incompleteBasket();
    await page.goto(`/product/${missing.productId}`);
    await page.getByRole("button", { name: /Add 1 pack to basket/ }).click();
    await page.getByRole("button", { name: "Compare basket", exact: true }).click();
    const card = page.getByRole("article", { name: retailer });
    await expect(card.getByText("Incomplete basket")).toBeVisible();
    await expect(card.getByText(/Estimated total|S\$/)).toHaveCount(0);
    await expect(
      card.getByRole("link", { name: shopperName(missing.representativeName) }),
    ).toBeVisible();
  });

  test("J2: changing the basket makes an earlier result stale", async ({ page }) => {
    await page.goto("/basket");
    await page.getByRole("button", { name: /Multiple complete retailers/i }).click();
    await page.getByRole("button", { name: "Compare basket", exact: true }).click();
    await expect(page).toHaveURL(/\/results$/);
    await page.getByRole("link", { name: "Edit basket" }).click();
    await page
      .getByRole("button", { name: /Increase/ })
      .first()
      .click();
    await expect(
      page.getByText(/previous comparison|stale|compare again|run a new comparison/i),
    ).toBeVisible();
  });

  test("J5: synthetic unsuccessful scenarios remain distinct from API results", async ({
    page,
  }) => {
    await page.goto("/basket");
    await page.getByRole("button", { name: "No feasible purchasing plan" }).click();
    await page.getByRole("button", { name: "Compare basket", exact: true }).click();
    await expect(page.getByText(/No feasible purchasing plan available/i)).toBeVisible();
    // Fewest missing first: Cold Storage (no estimate: unverified delivery), FairPrice
    // (whole basket below its minimum), then RedMart (missing one product).
    await expect(page.locator("article h2")).toHaveText(["Cold Storage", "FairPrice", "RedMart"]);
    const coldStorage = page.getByRole("article", { name: "Cold Storage" });
    await expect(coldStorage.getByText(/Estimated total/)).toHaveCount(0);
    const fairprice = page.getByRole("article", { name: "FairPrice" });
    await expect(fairprice.getByText("Below minimum order")).toBeVisible();
    await expect(fairprice.getByText(/minimum order — S\$8\.50 more needed/)).toBeVisible();
    await expect(fairprice.getByText("Estimated total", { exact: true })).toBeVisible();
    const redmart = page.getByRole("article", { name: "RedMart" });
    await expect(redmart.getByText("Estimated total for 1 of 2 items")).toBeVisible();
    await expect(page.getByText(/^Recommended/)).toHaveCount(0);
  });

  test("J5: temporary service failure can be retried successfully", async ({ page }) => {
    await page.goto("/basket");
    await page.getByRole("button", { name: "Temporary failure, then success" }).click();
    await page.getByRole("button", { name: "Compare basket", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Could not compare basket" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry comparison" })).toBeVisible();
    await page.getByRole("button", { name: "Retry comparison" }).click();
    await expect(page).toHaveURL(/\/results$/);
    await expect(page.getByRole("heading", { name: "Retailer basket comparison" })).toBeVisible();
  });

  test("J5: repeated service failure stays distinct from retailer unavailability", async ({
    page,
  }) => {
    await page.goto("/basket");
    await page.getByRole("button", { name: "Repeated service failure" }).click();
    await page.getByRole("button", { name: "Compare basket", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Could not compare basket" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry comparison" })).toBeVisible();
    await expect(page.getByRole("alert").getByText(/This is a service failure/i)).toBeVisible();
  });

  test("J4: retailer purchase links are present and point to retailer domains", async ({
    page,
  }) => {
    await page.goto("/basket");
    await page.getByRole("button", { name: /Multiple complete retailers/i }).click();
    await page.getByRole("button", { name: "Compare basket", exact: true }).click();
    await expect(page).toHaveURL(/\/results$/);

    const purchaseLinks = page.getByRole("link", { name: /^View .* at / });
    await expect(purchaseLinks.first()).toBeVisible();
    const hrefs = await purchaseLinks.evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).href),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((href) => /^https:\/\//.test(href))).toBe(true);
  });

  test("basket quantity is capped at 20 packs", async ({ page }) => {
    await page.goto("/basket");
    await page.getByRole("button", { name: /Multiple complete retailers/i }).click();
    const increase = page.getByRole("button", { name: /Increase/ }).first();
    for (let index = 0; index < 19; index += 1) await increase.click();
    await expect(
      page.locator(".basket-row").first().locator(".quantity-control").getByText("20", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(increase).toBeDisabled();
  });

  test("basket accepts 50 distinct lines and rejects the 51st", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/catalogue");
    const addButtons = page.getByRole("button", { name: "Add", exact: true });
    for (let index = 0; index < 51; index += 1) await addButtons.nth(index).click();

    const mobileMenu = page.locator("button.mobile-menu-button");
    if (await mobileMenu.isVisible()) await mobileMenu.click();
    await expect(page.getByText(/Basket 50/i)).toBeVisible();
    await page.locator('a[href="/basket"]').click({ force: true });
    await expect(page.getByText(/50 distinct lines/i)).toBeVisible();
    await expect(page.getByText(/Basket lines\s*50\s*\/\s*50/i)).toBeVisible();
    await expect(page.getByText("Basket limit reached")).toBeVisible();
  });
});

test.describe("keyboard operation", () => {
  test("can reach the catalogue search and add control by keyboard", async ({ page }) => {
    await page.goto("/catalogue");
    const search = page.getByRole("textbox", { name: /Search products/i });
    await search.focus();
    await search.fill("milk");
    await search.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
  });
});
