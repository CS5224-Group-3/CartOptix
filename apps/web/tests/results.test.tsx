import { SNAPSHOT_DISCLAIMER } from "@cartoptix/contracts";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BasketComparisonPresentation } from "../src/features/basket-comparison/model";
import BasketComparisonPage from "../src/pages/BasketComparisonPage";
import { comparisonFixtures } from "./support/fixtures";

function scenario(name: string): BasketComparisonPresentation {
  const result = comparisonFixtures[name];
  if (!result) throw new Error(`Missing fixture ${name}`);
  return result;
}

/** The cell a retailer's column holds in a row: columns follow the rendered headers, complete ones first. */
function cellFor(row: HTMLElement, _result: BasketComparisonPresentation, retailer: string) {
  const headers = screen.getAllByRole("columnheader").slice(1);
  const index = headers.findIndex((header) => (header.textContent ?? "").startsWith(retailer));
  const cell = within(row).getAllByRole("cell")[index];
  if (!cell) throw new Error(`No ${retailer} cell`);
  return cell;
}
const header = (retailer: string) =>
  screen.getByRole("columnheader", { name: new RegExp(retailer) });

describe("complete retailer comparison", () => {
  it("renders every supplied retailer, without a fixed retailer count", () => {
    const result = structuredClone(scenario("complete"));
    const first = result.options[0];
    if (!first) throw new Error("Missing option");
    result.options.push({
      ...first,
      retailer: { ...first.retailer, id: "extra", name: "Extra retailer" },
    });
    render(<BasketComparisonPage result={result} />);
    // One corner header plus one column per retailer.
    expect(screen.getAllByRole("columnheader")).toHaveLength(result.options.length + 1);
    for (const option of result.options) expect(header(option.retailer.name)).toBeDefined();
  });

  it("names each product once, with its exact pack and quantity, and shows each retailer's charges and totals", () => {
    const result = scenario("complete");
    render(<BasketComparisonPage result={result} />);
    // Identity is stated once per product, not once per retailer.
    expect(screen.getAllByText("Fixture White Rice")).toHaveLength(1);
    expect(screen.getAllByText("Fixture Plain Drink")).toHaveLength(1);
    const rice = screen.getByRole("row", { name: /^Fixture White Rice/ });
    const drink = screen.getByRole("row", { name: /^Fixture Plain Drink/ });
    expect(within(rice).getByRole("rowheader").textContent).toContain("1 kg · 1 pack");
    expect(within(drink).getByRole("rowheader").textContent).toContain("500 ml · 1 pack");
    expect(cellFor(rice, result, "FairPrice").textContent).toContain("S$4.00");
    expect(cellFor(drink, result, "FairPrice").textContent).toContain("S$2.50");
    const subtotal = screen.getByRole("row", { name: /Product subtotal/ });
    expect(cellFor(subtotal, result, "FairPrice").textContent).toBe("S$6.50");
    const delivery = screen.getByRole("row", { name: /^Delivery S\$/ });
    expect(cellFor(delivery, result, "FairPrice").textContent).toBe("S$0.00");
    const serviceFee = screen.getByRole("row", { name: /^Synthetic service fee/ });
    expect(within(serviceFee).getByText("S$3.99 waived on orders from S$6.00")).toBeDefined();
    const total = screen.getByRole("row", { name: /^Estimated total/ });
    const fair = result.options.find((o) => o.retailer.name === "FairPrice");
    expect(cellFor(total, result, "FairPrice").textContent).toBe(
      fair?.kind === "complete" ? `S$${(fair.estimatedTotalCents / 100).toFixed(2)}` : "",
    );
    expect(
      within(header("FairPrice")).getByText("Recommended — lowest estimated total"),
    ).toBeDefined();
    expect(screen.getAllByText(/^Recommended/)).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains a multibuy line, the mixing note and a promotion left out", () => {
    const result = structuredClone(scenario("complete"));
    const option = result.options.find((candidate) => candidate.retailer.name === "FairPrice");
    const line = option?.kind === "complete" ? option.lines[0] : undefined;
    if (!line) throw new Error("Missing line");
    // Every option and the submitted basket must agree on the quantity.
    for (const product of result.submittedBasket.products)
      if (product.productId === line.productId) product.quantity = 3;
    for (const candidate of result.options)
      if (candidate.kind === "complete")
        for (const other of candidate.lines)
          if (other.productId === line.productId) other.quantity = 3;
    line.pricing = {
      ...line.pricing,
      unitPriceCents: 400,
      originalPriceCents: null,
      multibuy: {
        packsPerDeal: 2,
        dealPriceCents: 700,
        mixAndMatch: true,
        percentOff: null,
        timesApplied: 1,
        savingCents: 100,
      },
      excludedPromotions: ["Spend $30 + Free Gift"],
    };
    render(<BasketComparisonPage result={result} />);
    const cell = within(
      cellFor(screen.getByRole("row", { name: new RegExp(line.name) }), result, "FairPrice"),
    );
    expect(cell.getByText("1 × deal (2 for S$7.00) + 1 × S$4.00 · You save S$1.00")).toBeDefined();
    expect(cell.getByText("Mixing items in this deal may save more")).toBeDefined();
    expect(cell.getByText("Spend $30 + Free Gift — not included in this estimate")).toBeDefined();
  });

  it("keeps a percentage deal's wording and says its price may differ slightly", () => {
    const result = structuredClone(scenario("complete"));
    const option = result.options.find((candidate) => candidate.retailer.name === "FairPrice");
    const line = option?.kind === "complete" ? option.lines[0] : undefined;
    if (!line) throw new Error("Missing line");
    line.pricing = {
      ...line.pricing,
      unitPriceCents: 400,
      originalPriceCents: null,
      multibuy: {
        packsPerDeal: 2,
        dealPriceCents: 700,
        mixAndMatch: false,
        percentOff: 12.5,
        timesApplied: 1,
        savingCents: 100,
      },
    };
    if (line.quantity !== 2) {
      for (const product of result.submittedBasket.products)
        if (product.productId === line.productId) product.quantity = 2;
      for (const candidate of result.options)
        if (candidate.kind === "complete")
          for (const other of candidate.lines)
            if (other.productId === line.productId) other.quantity = 2;
    }
    render(<BasketComparisonPage result={result} />);
    const cell = within(
      cellFor(screen.getByRole("row", { name: new RegExp(line.name) }), result, "FairPrice"),
    );
    expect(cell.getByText("1 × deal (2 save 12.5%) · You save about S$1.00")).toBeDefined();
    expect(
      cell.getByText(
        "The retailer rounds this percentage, so the checkout may differ by a few cents",
      ),
    ).toBeDefined();
  });

  it("does not hint at buying more to reach a deal", () => {
    const result = structuredClone(scenario("complete"));
    const option = result.options.find((candidate) => candidate.retailer.name === "FairPrice");
    const line = option?.kind === "complete" ? option.lines[0] : undefined;
    if (!line) throw new Error("Missing line");
    line.pricing = {
      ...line.pricing,
      multibuy: {
        packsPerDeal: 2,
        dealPriceCents: 700,
        mixAndMatch: false,
        percentOff: null,
        timesApplied: 0,
        savingCents: 0,
      },
    };
    render(<BasketComparisonPage result={result} />);
    expect(screen.queryByText(/Buy 2 for/)).toBeNull();
  });

  it("uses honest tied-cheapest wording", () => {
    render(<BasketComparisonPage result={scenario("tie")} />);
    expect(screen.getByText("Recommended — joint lowest estimated total")).toBeDefined();
    expect(screen.getByText(/More than one complete retailer option shares/)).toBeDefined();
    expect(screen.queryByText("Recommended — lowest estimated total")).toBeNull();
  });

  it("honours a supplied recommendation for the second tied option", () => {
    const result = structuredClone(scenario("tie"));
    result.outcome = { kind: "recommended", retailerId: "redmart" };
    render(<BasketComparisonPage result={result} />);
    expect(
      within(header("RedMart")).getByText("Recommended — joint lowest estimated total"),
    ).toBeDefined();
    expect(within(header("FairPrice")).queryByText(/^Recommended/)).toBeNull();
    expect(screen.getAllByText(/^Recommended/)).toHaveLength(1);
    expect(screen.queryByText("Recommended — lowest estimated total")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(result.outcome).toEqual({ kind: "recommended", retailerId: "redmart" });
  });

  it.each([
    ["missing retailer", "complete", "missing"],
    ["unavailable retailer", "unavailable", "cold-storage"],
    ["higher-priced complete retailer", "complete", "redmart"],
    ["unavailable retailer when others tie", "tie", "cold-storage"],
  ])("rejects a recommendation for a %s without replacing it", (_label, fixture, retailerId) => {
    const result = structuredClone(scenario(fixture));
    result.outcome = { kind: "recommended", retailerId };
    const { container } = render(<BasketComparisonPage result={result} />);
    expect(screen.getByRole("alert").textContent).toContain("Comparison data validation failed.");
    expect(screen.queryByText(/^Recommended/)).toBeNull();
    expect(container.textContent).not.toMatch(/lowest|joint-lowest|joint lowest/i);
    expect(container.querySelector(".matrix__retailer--recommended")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("link", { name: /^Visit / })).toBeNull();
    expect(result.outcome).toEqual({ kind: "recommended", retailerId });
  });

  it.each(["same total", "higher total", "unavailable duplicate"])(
    "rejects duplicate retailer identities with %s without rendering duplicate keys",
    (variant) => {
      const result = structuredClone(scenario("complete"));
      const original = result.options[0];
      const other = result.options[1];
      if (!original || !other) throw new Error("Missing fixture options");
      const duplicate =
        variant === "unavailable duplicate"
          ? {
              kind: "unavailable" as const,
              retailer: { ...original.retailer },
              reasons: ["Synthetic unavailable option"],
            }
          : structuredClone(variant === "higher total" ? other : original);
      duplicate.retailer.id = original.retailer.id;
      result.options.push(duplicate);
      const before = structuredClone(result);
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const { container } = render(<BasketComparisonPage result={result} />);
      expect(screen.getByRole("alert").textContent).toContain("Comparison data validation failed.");
      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.queryByRole("link", { name: /^Visit |^View Fixture / })).toBeNull();
      expect(container.textContent).not.toMatch(/lowest|joint-lowest|joint lowest/i);
      expect(container.querySelector(".matrix__retailer--recommended")).toBeNull();
      expect(result).toEqual(before);
      expect(errors).not.toHaveBeenCalled();
    },
  );

  it.each([
    "missing submitted product",
    "wrong quantity",
    "extra product",
    "duplicate product replacing a missing product",
    "extra duplicate product",
    "wrong product identity",
    "incomplete non-recommended option",
    "duplicate submitted identity",
  ])("rejects %s without repairing the basket or exposing purchase claims", (problem) => {
    const result = structuredClone(scenario("complete"));
    const option = result.options[problem === "incomplete non-recommended option" ? 1 : 0];
    if (option?.kind !== "complete") throw new Error("Missing complete fixture option");
    const first = option.lines[0];
    if (!first) throw new Error("Missing fixture line");
    switch (problem) {
      case "missing submitted product":
      case "incomplete non-recommended option":
        option.lines.pop();
        break;
      case "wrong quantity":
        first.quantity += 1;
        break;
      case "extra product":
        option.lines.push({ ...first, productId: "extra-product" });
        break;
      case "duplicate product replacing a missing product":
        option.lines = [{ ...first }, { ...first }];
        break;
      case "extra duplicate product":
        option.lines.push({ ...first });
        break;
      case "wrong product identity":
        first.productId = "different-product";
        break;
      case "duplicate submitted identity":
        result.submittedBasket.products.push({ ...first });
        break;
    }
    const before = structuredClone(result);
    const { container } = render(<BasketComparisonPage result={result} />);
    expect(screen.getByRole("alert").textContent).toContain("Comparison data validation failed.");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("link", { name: /^Visit |^View Fixture / })).toBeNull();
    expect(screen.queryByText(/^Recommended/)).toBeNull();
    expect(container.textContent).not.toMatch(
      /lowest|joint-lowest|joint lowest|Each complete option/,
    );
    expect(result).toEqual(before);
  });

  it("validates retailer identities even in a no-feasible-plan outcome", () => {
    const result = structuredClone(scenario("infeasible"));
    const first = result.options[0];
    if (!first) throw new Error("Missing fixture option");
    result.options.push(structuredClone(first));
    render(<BasketComparisonPage result={result} />);
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("No feasible purchasing plan available")).toBeNull();
  });

  it("lists complete options before unavailable ones, whatever order the response has", () => {
    const result = structuredClone(scenario("unavailable"));
    result.options.reverse();
    render(<BasketComparisonPage result={result} />);
    const names = screen
      .getAllByRole("columnheader")
      .slice(1)
      .map((h) => h.textContent ?? "");
    const unavailable = result.options
      .filter((o) => o.kind === "unavailable")
      .map((o) => o.retailer.name);
    const firstUnavailable = names.findIndex((name) => unavailable.some((u) => name.startsWith(u)));
    expect(firstUnavailable).toBeGreaterThan(0);
    expect(
      names.slice(firstUnavailable).every((name) => unavailable.some((u) => name.startsWith(u))),
    ).toBe(true);
  });

  it("accepts full basket coverage regardless of line ordering", () => {
    const result = structuredClone(scenario("complete"));
    for (const option of result.options) if (option.kind === "complete") option.lines.reverse();
    render(<BasketComparisonPage result={result} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/^Recommended/)).toBeDefined();
    expect(screen.getAllByRole("columnheader")).toHaveLength(result.options.length + 1);
  });

  it("shows unavailable reasons without a total, purchase action or recommendation", () => {
    const result = scenario("unavailable");
    render(<BasketComparisonPage result={result} />);
    const column = within(header("Cold Storage"));
    expect(column.getByText("Unavailable")).toBeDefined();
    expect(
      column.getByText(
        "Cold Storage's delivery charges could not be confirmed, so no total is shown.",
      ),
    ).toBeDefined();
    expect(column.getByText("No estimate")).toBeDefined();
    expect(column.queryByText(/Recommended|S\$/)).toBeNull();
    expect(column.queryByRole("link")).toBeNull();
    // No product is priced there and nothing can be bought from that column.
    for (const row of screen.getAllByRole("row").slice(1)) {
      const cells = within(row).getAllByRole("cell");
      const text =
        cells[result.options.findIndex((o) => o.retailer.name === "Cold Storage")]?.textContent;
      expect(text === "Not available" || text === "—").toBe(true);
    }
  });

  it("shows the exact no-feasible-plan outcome and all reasons", () => {
    const result = scenario("infeasible");
    render(<BasketComparisonPage result={result} />);
    expect(
      screen.getByRole("heading", { name: "No feasible purchasing plan available" }),
    ).toBeDefined();
    for (const option of result.options)
      if (option.kind === "unavailable")
        for (const reason of option.reasons) expect(screen.getByText(reason)).toBeDefined();
    expect(screen.queryByText(/Recommended/)).toBeNull();
    // Partial checkouts are estimated and labelled; the one with no rule is not.
    const fairprice = within(header("FairPrice"));
    expect(fairprice.getByText("Below minimum order")).toBeDefined();
    expect(fairprice.getByText("S$11.50")).toBeDefined();
    const redmart = within(header("RedMart"));
    expect(redmart.getByText("Incomplete basket")).toBeDefined();
    expect(redmart.getByText("Estimated total for 1 of 2 items")).toBeDefined();
    expect(redmart.getByText("S$8.09")).toBeDefined();
    const missing = screen.getByRole("row", { name: /^Fixture White Rice/ });
    expect(cellFor(missing, result, "RedMart").textContent).toBe("Not available");
    expect(
      within(missing).getByRole("link", { name: "Fixture White Rice" }).getAttribute("href"),
    ).toBe("/product/fixture-rice");
    expect(within(header("Cold Storage")).queryByText(/S\$/)).toBeNull();
  });

  it("renders every product's thumbnail, and nothing broken when one fails to load", () => {
    const result = structuredClone(scenario("infeasible"));
    const rice = result.submittedBasket.products.find(
      (product) => product.productId === "fixture-rice",
    );
    if (!rice) throw new Error("Missing product");
    // Line metadata used to drop the image; rows come from the submitted basket.
    rice.imageUrl = "https://example.com/rice.jpg";
    const { container } = render(<BasketComparisonPage result={result} />);
    const image = container.querySelector("img.matrix__thumb");
    expect(image?.getAttribute("src")).toBe("https://example.com/rice.jpg");
    if (image) fireEvent.error(image);
    expect(container.querySelector("img.matrix__thumb")).toBeNull();
  });

  it("provides purchase links, manual guidance and fixed-dataset disclosure", () => {
    const result = scenario("complete");
    render(<BasketComparisonPage result={result} />);
    expect(screen.getByText(/complete checkout manually/)).toBeDefined();
    const rice = screen.getByRole("row", { name: /^Fixture White Rice/ });
    const link = within(cellFor(rice, result, "FairPrice")).getByRole("link", {
      name: /View Fixture White Rice at FairPrice/,
    });
    expect(link.getAttribute("href")).toBe("https://example.com/fixture-rice-fairprice");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByRole("link", { name: /^Visit / })).toBeNull();
    expect(screen.getByText(SNAPSHOT_DISCLAIMER, { exact: false })).toBeDefined();
  });

  it.each(Object.keys(comparisonFixtures))("has no split-plan or savings results in %s", (name) => {
    const { container } = render(<BasketComparisonPage result={scenario(name)} />);
    expect(container.textContent).not.toMatch(/split|baseline|savings|Save S\$|search limit/i);
  });

  it("keeps repeated charge labels separate", () => {
    const result = structuredClone(scenario("complete"));
    const fairprice = result.options.find((option) => option.retailer.name === "FairPrice");
    if (fairprice?.kind !== "complete" || !fairprice.orderCharges[0])
      throw new Error("Missing charge");
    // The contract permits two charges with the same label; both must keep their amount.
    const first = fairprice.orderCharges[0];
    fairprice.orderCharges.push({ ...first, waived: false, waivedFromCents: null });
    render(<BasketComparisonPage result={result} />);
    const feeRows = screen
      .getAllByRole("row")
      .filter((row) => (row.textContent ?? "").startsWith("Synthetic service fee"));
    expect(feeRows).toHaveLength(2);
    const fairCells = feeRows.map((row) =>
      within(row)
        .getAllByRole("cell")
        .find((cell) => cell.dataset.retailer === "FairPrice"),
    );
    expect(fairCells.map((cell) => cell?.textContent)).toEqual([
      "S$3.99 waived on orders from S$6.00",
      "S$3.99",
    ]);
  });

  it("shows one row for a fee waived at one retailer and paid at the other", () => {
    const result = structuredClone(scenario("complete"));
    const fairprice = result.options.find((option) => option.retailer.name === "FairPrice");
    const redmart = result.options.find((option) => option.retailer.name === "RedMart");
    if (fairprice?.kind !== "complete" || redmart?.kind !== "complete") throw new Error("Fixtures");
    const fairCharge = fairprice.orderCharges[0];
    if (!fairCharge) throw Error("Missing charge");
    // RedMart charges the same fee, unwaived.
    redmart.orderCharges.push({
      ...fairCharge,
      waived: false,
      waivedFromCents: null,
    });
    render(<BasketComparisonPage result={result} />);
    const feeRow = screen
      .getAllByRole("row")
      .filter((row) => (row.textContent ?? "").startsWith("Synthetic service fee"));
    expect(feeRow).toHaveLength(1);
    const [feeRowElement] = feeRow;
    if (!feeRowElement) throw new Error("Missing fee row");
    const cells = within(feeRowElement).getAllByRole("cell");
    expect(cells.find((cell) => cell.dataset.retailer === "FairPrice")?.textContent).toMatch(
      /waived/,
    );
    expect(cells.find((cell) => cell.dataset.retailer === "RedMart")?.textContent).toBe("S$3.99");
  });

  it("still lists the basket when no retailer could price anything", () => {
    const result = structuredClone(scenario("infeasible"));
    for (const option of result.options) if (option.kind === "unavailable") delete option.partial;
    render(<BasketComparisonPage result={result} />);
    expect(screen.getByText("2 products")).toBeDefined();
    expect(screen.getAllByText("Not available")).toHaveLength(6);
    expect(screen.getByRole("row", { name: /^Fixture White Rice/ })).toBeDefined();
  });
});
