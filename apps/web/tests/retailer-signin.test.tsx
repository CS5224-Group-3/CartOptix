import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BasketComparisonPresentation } from "../src/features/basket-comparison/model";
import { RETAILER_SITES } from "../src/features/basket-comparison/retailer-sites";
import BasketComparisonPage from "../src/pages/BasketComparisonPage";
import { comparisonFixtures } from "./support/fixtures";

/**
 * The sign-in row on the comparison table.
 *
 * CartOptix cannot transfer a basket, so finishing an order means signing in
 * to the retailer. These assertions pin the URLs, because each was checked
 * against the retailer's own site rather than guessed from a conventional
 * path, and a silently wrong link sends a shopper to a 404.
 */

function scenario(name: string): BasketComparisonPresentation {
  const result = comparisonFixtures[name];
  if (!result) throw new Error(`Missing fixture ${name}`);
  return result;
}

function signInRow(): HTMLElement {
  return screen.getByRole("row", { name: /^Sign in to check out/ });
}

/** The cell in a given retailer's column, found from the rendered headers. */
function cellFor(row: HTMLElement, retailer: string): HTMLElement {
  const headers = screen.getAllByRole("columnheader").slice(1);
  const index = headers.findIndex((header) => (header.textContent ?? "").startsWith(retailer));
  const cell = within(row).getAllByRole("cell")[index];
  if (!cell) throw new Error(`No ${retailer} cell`);
  return cell;
}

describe("retailer sign-in row", () => {
  it("links each priced retailer to its own sign-in page, in a new tab", () => {
    const result = scenario("complete");
    render(<BasketComparisonPage result={result} />);

    for (const option of result.options) {
      const site = RETAILER_SITES[option.retailer.id as keyof typeof RETAILER_SITES];
      const priced = option.kind === "complete" || option.partial !== undefined;
      if (site === undefined || !priced) continue;

      const cell = within(cellFor(signInRow(), option.retailer.name));
      // The host sits inside the anchor, so it is part of the accessible name.
      const link = cell.getByRole("link", {
        name: `Sign in to ${option.retailer.name} (${site.host})`,
      });
      expect(link.getAttribute("href")).toBe(site.loginUrl);
      expect(link.getAttribute("target")).toBe("_blank");
      // Without noopener the retailer's page can reach back through window.opener.
      expect(link.getAttribute("rel")).toContain("noopener");
    }
  });

  it("makes the host part of the link, not a dead label beside it", () => {
    render(<BasketComparisonPage result={scenario("complete")} />);

    const host = within(signInRow()).getByText("(fairprice.com.sg)");

    expect(host.closest("a")?.getAttribute("href")).toBe("https://www.fairprice.com.sg/login");
  });

  it("offers sign-in on a column that can still sell part of the basket", () => {
    // An incomplete column prices what it has and links to those products, so
    // withholding its sign-in would be the odd half.
    const result = structuredClone(scenario("complete"));
    const option = result.options.find((o) => o.kind === "unavailable");
    const donor = result.options.find((o) => o.kind === "complete");
    if (option?.kind !== "unavailable" || donor?.kind !== "complete") throw new Error("Fixtures");
    option.partial = donor;

    render(<BasketComparisonPage result={result} />);

    const cell = within(cellFor(signInRow(), option.retailer.name));
    expect(cell.getByRole("link", { name: /^Sign in to/ })).toBeDefined();
  });

  it("shows a dash for a column with nothing priced", () => {
    const result = structuredClone(scenario("complete"));
    const bare = result.options.find((o) => o.kind === "unavailable" && o.partial === undefined);
    if (!bare) throw new Error("Fixture has no unpriced column");

    render(<BasketComparisonPage result={result} />);

    const cell = within(cellFor(signInRow(), bare.retailer.name));
    expect(cell.queryByRole("link", { name: /^Sign in to/ })).toBeNull();
    expect(cell.getByText("—")).toBeDefined();
  });

  it("drops the row entirely when nothing can be bought anywhere", () => {
    const result = structuredClone(scenario("infeasible"));
    for (const option of result.options) if (option.kind === "unavailable") delete option.partial;

    render(<BasketComparisonPage result={result} />);

    expect(screen.queryByRole("row", { name: /^Sign in to check out/ })).toBeNull();
  });

  it("points RedMart at its storefront, not Lazada's deep login URL", () => {
    // The deep link reaches Lazada's login widget with no prior session and
    // has been seen to fail there; the storefront carries its own LOGIN.
    expect(RETAILER_SITES.redmart.loginUrl).toBe("https://redmart.lazada.sg/");
  });

  it("does not use Cold Storage's /login path, which is a 404", () => {
    expect(RETAILER_SITES["cold-storage"].loginUrl).toBe("https://coldstorage.com.sg/auth/login");
  });
});
