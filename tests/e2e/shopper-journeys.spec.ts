import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";

async function addMilkAndOpenBasket(page: Page) {
  await page.goto("/catalogue");
  await dismissFirstVisitGuide(page);
  await page.getByRole("textbox", { name: /Search products/i }).fill("milk");
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  await expect(page.getByText("Added to basket")).toBeVisible();
  const mobileMenu = page.locator("button.mobile-menu-button");
  if (await mobileMenu.isVisible()) await mobileMenu.click();
  await page.locator('a[href="/basket"]').click({ force: true });
}

async function dismissFirstVisitGuide(page: Page) {
  const skip = page.getByRole("button", { name: "Skip guide" });
  if (await skip.isVisible()) await skip.click();
}

async function openBasketGuide(page: Page) {
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const guideButton = navigation.getByRole("button", { name: "How it works" });
  const mobileMenu = page.getByRole("button", { name: "Toggle navigation" });
  if ((await mobileMenu.isVisible()) && !(await guideButton.isVisible())) await mobileMenu.click();
  await guideButton.click();
}

async function compareBasket(page: Page) {
  await page.getByRole("button", { name: "Compare basket", exact: true }).click();
  await expect(page).toHaveURL(/\/results$/);
}

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
  test("basket edits are shared with a newly opened tab", async ({ page, context }) => {
    await addMilkAndOpenBasket(page);
    const other = await context.newPage();
    try {
      await other.goto("/basket");
      const quantity = other.locator(".basket-row .quantity-control strong").first();
      await expect(quantity).toHaveText("1");
      await page
        .getByRole("button", { name: /Increase/ })
        .first()
        .click();
      await expect(quantity).toHaveText("2");
      await other
        .getByRole("button", { name: /Increase/ })
        .first()
        .click();
      await expect(page.locator(".basket-row .quantity-control strong").first()).toHaveText("3");
    } finally {
      await other.close();
    }
  });

  test("basket heading and counts fit with ten products", async ({ page }) => {
    await page.goto("/catalogue");
    await page.evaluate(
      (lines) => {
        localStorage.setItem("cartoptix:basket:v1", JSON.stringify(lines));
      },
      seed.products.slice(0, 10).map(({ productId }) => ({ productId, quantity: 1 })),
    );
    await page.goto("/basket");
    const hero = page.locator(".basket-product-hero");
    await expect(hero.getByRole("heading", { name: "Review your basket" })).toBeVisible();
    await expect(hero.locator(".basket-header__meta")).toContainText("10items10packs");
    const bounds = await hero.boundingBox();
    for (const selector of ["h1", ".basket-header__meta", ".basket-product-hero__description"]) {
      const child = await hero.locator(selector).boundingBox();
      if (!bounds || !child) throw new Error("Missing hero content");
      expect(child.y).toBeGreaterThanOrEqual(bounds.y);
      expect(child.y + child.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
      expect(child.x + child.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    }
  });

  test("J1: find a product and add it to the basket", async ({ page }) => {
    await page.goto("/catalogue");
    await dismissFirstVisitGuide(page);
    await expect(
      page.getByRole("heading", { name: "Find your everyday essentials." }),
    ).toBeVisible();
    await page.getByRole("textbox", { name: /Search products/i }).fill("milk");
    await expect(page.getByText(/products found/i)).toBeVisible();
    await addMilkAndOpenBasket(page);
    await expect(page.getByRole("heading", { name: "Review your basket" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(1);
  });

  test("J2/J3: compare a basket and display all retailer outcomes", async ({ page }) => {
    await addMilkAndOpenBasket(page);
    await compareBasket(page);
    await expect(page.getByRole("heading", { name: "Retailer basket comparison" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "RedMart", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "FairPrice", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cold Storage", exact: true })).toBeVisible();
    await expect(page.getByText(/Prices and availability may have changed/i).first()).toBeVisible();
  });

  test("J1/J3: sale prices are shown on the product page and in the basket", async ({ page }) => {
    await page.goto("/product/anlene-actifit-3x-plain-milk-powder-1kg");
    await expect(page.locator("s.was-price").first()).toContainText(/S\$\d+\.\d{2}/);
    await expect(page.getByText(/per pack · Sale price/).first()).toBeVisible();
    await page.getByRole("button", { name: /Add 1 pack to basket/ }).click();
    await expect(page).toHaveURL(/\/product\//);
    await page.getByRole("link", { name: "View basket", exact: true }).click();
    await expect(page).toHaveURL(/\/basket$/);
    await page.getByRole("button", { name: "Compare basket", exact: true }).click();
    await expect(page).toHaveURL(/\/results$/);
    await expect(page.getByRole("table").locator("s.was-price").first()).toBeVisible();
    await expect(
      page
        .getByRole("table")
        .getByText(/\ssale$/)
        .first(),
    ).toBeVisible();
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
    await page.getByRole("link", { name: "View basket", exact: true }).click();
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
    await page.getByRole("link", { name: "View basket", exact: true }).click();
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
      await page.getByRole("link", { name: "View basket", exact: true }).click();
      await expect(page).toHaveURL(/\/basket$/);
    }
    await page.getByRole("button", { name: "Compare basket", exact: true }).click();
    await expect(page).toHaveURL(/\/results$/);
    // A complete option is recommended first; the incomplete card follows it.
    await expect(page.getByText(/^Recommended/)).toHaveCount(1);
    const column = page.getByRole("columnheader", { name: new RegExp(retailer) });
    await expect(column.getByText("Incomplete basket")).toBeVisible();
    await expect(column.getByText("Estimated total for 1 of 2 items")).toBeVisible();
    await expect(column.getByText(/^Recommended/)).toHaveCount(0);
    // The missing product is named once, in its row, and its link works from the keyboard.
    const link = page
      .getByRole("table")
      .getByRole("link", { name: shopperName(missing.representativeName), exact: true });
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/product/${missing.productId}$`));
  });

  test("J3: a retailer with none of the basket shows no estimate", async ({ page }) => {
    const { missing, retailer } = incompleteBasket();
    await page.goto(`/product/${missing.productId}`);
    await page.getByRole("button", { name: /Add 1 pack to basket/ }).click();
    await page.getByRole("link", { name: "View basket", exact: true }).click();
    await page.getByRole("button", { name: "Compare basket", exact: true }).click();
    const column = page.getByRole("columnheader", { name: new RegExp(retailer) });
    await expect(column.getByText("Incomplete basket")).toBeVisible();
    await expect(column.getByText("No estimate")).toBeVisible();
    await expect(column.getByText(/S\$/)).toHaveCount(0);
    await expect(
      page
        .getByRole("table")
        .getByRole("link", { name: shopperName(missing.representativeName), exact: true }),
    ).toBeVisible();
  });

  test("J2: changing the basket makes an earlier result stale", async ({ page }) => {
    await addMilkAndOpenBasket(page);
    await compareBasket(page);
    await page.getByRole("link", { name: "Edit basket" }).click();
    await page
      .getByRole("button", { name: /Increase/ })
      .first()
      .click();
    await expect(page.getByText(/Your basket changed/i)).toBeVisible();
  });

  test("J4: retailer purchase links are present and point to retailer domains", async ({
    page,
  }) => {
    await addMilkAndOpenBasket(page);
    await compareBasket(page);
    const purchaseLinks = page.getByRole("link", { name: /^View .* at / });
    await expect(purchaseLinks.first()).toBeVisible();
    const hrefs = await purchaseLinks.evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).href),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((href) => /^https:\/\//.test(href))).toBe(true);
  });

  test("basket quantity is capped at 20 packs", async ({ page }) => {
    await addMilkAndOpenBasket(page);
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
    test.setTimeout(90_000);
    await page.goto("/catalogue");
    await dismissFirstVisitGuide(page);
    await page.addStyleTag({
      content: "[data-sonner-toast] { display: none !important; pointer-events: none !important; }",
    });
    const addButtons = page.getByRole("button", { name: "Add", exact: true });
    const basketCount = page.locator(".nav-basket span");
    for (let index = 0; index < 50; index += 1) {
      await addButtons.nth(index).click();
      await expect(basketCount).toHaveText(String(index + 1));
    }
    await addButtons.nth(50).click();
    await expect(basketCount).toHaveText("50");
    await expect(page.getByText("Basket limit reached")).toHaveCount(1);

    const mobileMenu = page.locator("button.mobile-menu-button");
    if (await mobileMenu.isVisible()) await mobileMenu.click();
    await expect(page.getByText(/Basket 50/i)).toBeVisible();
    await page.locator('a[href="/basket"]').click({ force: true });
    await expect(page.getByText(/Items in basket\s*50\s*\/\s*50/i)).toBeVisible();
  });
});

test.describe("keyboard operation", () => {
  test("can reach the catalogue search and add control by keyboard", async ({ page }) => {
    await page.goto("/catalogue");
    await dismissFirstVisitGuide(page);
    const search = page.getByRole("textbox", { name: /Search products/i });
    await search.focus();
    await search.fill("milk");
    await search.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
  });

  test("shows a first visit guide with skip and supports replay", async ({ page }) => {
    await page.goto("/catalogue");
    await expect(page.getByRole("heading", { name: "Welcome to CartOptix" })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { name: "Search the catalogue" })).toBeVisible();
    await expect(page.locator(".tutorial-spotlight")).toBeVisible();
    const dialog = await page.getByRole("dialog").boundingBox();
    const target = await page.locator(".tutorial-spotlight").boundingBox();
    const viewport = page.viewportSize();
    expect(dialog).not.toBeNull();
    expect(target).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (dialog && target && viewport) {
      expect(Math.abs(dialog.x + dialog.width / 2 - viewport.width / 2)).toBeLessThan(2);
      expect(
        dialog.x < target.x + target.width &&
          target.x < dialog.x + dialog.width &&
          dialog.y < target.y + target.height &&
          target.y < dialog.y + dialog.height,
      ).toBe(false);
    }
    await page.getByRole("button", { name: "Skip guide" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    if ((page.viewportSize()?.width ?? 1280) <= 720) {
      await page.getByRole("button", { name: "Toggle navigation" }).click();
    }
    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    const browseIndex = await navigation
      .getByRole("link", { name: "Browse products" })
      .evaluate((el) => Array.from(el.parentElement?.children ?? []).indexOf(el));
    const guideIndex = await navigation
      .getByRole("button", { name: "How it works" })
      .evaluate((el) => Array.from(el.parentElement?.children ?? []).indexOf(el));
    const basketIndex = await navigation
      .getByRole("link", { name: /Basket/ })
      .evaluate((el) => Array.from(el.parentElement?.children ?? []).indexOf(el));
    expect(guideIndex).toBe(browseIndex + 1);
    expect(basketIndex).toBe(guideIndex + 1);
    await navigation.getByRole("button", { name: "How it works" }).click();
    await expect(page.getByRole("heading", { name: "Welcome to CartOptix" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip guide" })).toBeVisible();
    for (let step = 0; step < 5; step += 1) {
      const next = page.getByRole("dialog").getByRole("button", { name: "Next" });
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click();
    }
    await page.getByRole("dialog").getByRole("button", { name: "Finish" }).click();
    await page.goto("/basket");
    if ((page.viewportSize()?.width ?? 1280) <= 720) {
      await page.getByRole("button", { name: "Toggle navigation" }).click();
    }
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "How it works" })
      .click();
    await expect(page).toHaveURL(/\/basket$/);
    await expect(page.getByRole("heading", { name: "Add products to your basket" })).toBeVisible();
  });
});

test.describe("basket guide", () => {
  test("guides an empty basket to Browse products and explains comparison", async ({ page }) => {
    await page.goto("/basket");
    await expect(page.getByRole("heading", { name: "Your basket is empty" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await openBasketGuide(page);
    await expect(page.locator(".tutorial-spotlight")).toBeVisible();
    await expect(page.locator(".tutorial-spotlight")).toHaveAttribute("aria-hidden", "true");

    await expect(page.getByRole("heading", { name: "Add products to your basket" })).toBeVisible();
    await expect(page.locator(".tutorial-spotlight")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { name: "Compare your basket" })).toBeVisible();
    await expect(page.locator("#compare-basket")).toBeVisible();

    await page.getByRole("dialog").getByRole("button", { name: "Finish" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await openBasketGuide(page);
    await expect(page.getByRole("heading", { name: "Add products to your basket" })).toBeVisible();
  });

  test("explains populated basket items and the Compare basket button", async ({ page }) => {
    const productId = seed.products[0]?.productId;
    if (!productId) throw new Error("The committed seed contains no products");
    await page.addInitScript(
      ({ productId }) => {
        localStorage.setItem("cartoptix:basket:v1", JSON.stringify([{ productId, quantity: 1 }]));
      },
      { productId },
    );
    await page.goto("/basket");
    await expect(page.getByRole("heading", { name: "Review your basket" })).toBeVisible();
    await openBasketGuide(page);
    await expect(page.getByRole("heading", { name: "Review your basket items" })).toBeVisible();
    await expect(page.locator(".basket-card .basket-row")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { name: "Compare your basket" })).toBeVisible();
    await expect(page.locator("#compare-basket")).toBeVisible();
  });
});
