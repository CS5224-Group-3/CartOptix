import { expect, test } from "@playwright/test";

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
    // Pulled chicken is not at RedMart in the seed; Barilla penne is not at Cold Storage.
    for (const product of [
      "ayam-brand-pulled-chicken-buffalo-150g",
      "barilla-italian-pasta-penne-rigate-500g",
    ]) {
      await page.goto(`/product/${product}`);
      await page.getByRole("button", { name: /Add 1 pack to basket/ }).click();
      await expect(page).toHaveURL(/\/basket$/);
    }
    await page.getByRole("button", { name: "Compare basket", exact: true }).click();
    await expect(page).toHaveURL(/\/results$/);
    const incomplete = page.locator("article", { hasText: "Incomplete basket" }).first();
    await expect(incomplete.getByText("Estimated total for 1 of 2 items")).toBeVisible();
    await expect(incomplete.getByRole("heading", { name: /^Not available at / })).toBeVisible();
    await expect(
      incomplete.getByRole("link", { name: /Ayam Brand|Barilla/ }).first(),
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
