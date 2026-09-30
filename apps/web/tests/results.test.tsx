import { SNAPSHOT_DISCLAIMER } from "@cartoptix/contracts";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { comparisonFixtures } from "../src/features/basket-comparison/fixtures";
import type { BasketComparisonPresentation } from "../src/features/basket-comparison/model";
import BasketComparisonPage from "../src/pages/BasketComparisonPage";

function scenario(name: string): BasketComparisonPresentation {
  const result = comparisonFixtures[name];
  if (!result) throw new Error(`Missing fixture ${name}`);
  return result;
}

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
    expect(screen.getAllByRole("article")).toHaveLength(4);
    for (const option of result.options)
      expect(screen.getByRole("article", { name: option.retailer.name })).toBeDefined();
  });

  it("shows products, exact packs, quantities, individual charges and totals", () => {
    render(<BasketComparisonPage result={scenario("complete")} />);
    const card = within(screen.getByRole("article", { name: "FairPrice" }));
    expect(card.getByText("Synthetic White Rice")).toBeDefined();
    expect(card.getByText("Synthetic Milk")).toBeDefined();
    expect(card.getByText("1 kg bag · Quantity: 2 packs")).toBeDefined();
    expect(card.getByText("6 × 250 ml cartons · Quantity: 1 pack")).toBeDefined();
    for (const text of [
      "S$6.00",
      "S$5.00",
      "Product subtotal",
      "S$11.00",
      "Delivery",
      "S$4.00",
      "Handling",
      "S$1.00",
      "Estimated total",
      "S$16.00",
    ])
      expect(card.getByText(text)).toBeDefined();
    expect(card.getByText("Recommended — lowest estimated total")).toBeDefined();
    expect(screen.getAllByText(/^Recommended/)).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
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
    const redmart = within(screen.getByRole("article", { name: "RedMart" }));
    expect(redmart.getByText("Recommended — joint lowest estimated total")).toBeDefined();
    expect(
      within(screen.getByRole("article", { name: "FairPrice" })).queryByText(/^Recommended/),
    ).toBeNull();
    expect(screen.getAllByText(/^Recommended/)).toHaveLength(1);
    expect(screen.queryByText("Recommended — lowest estimated total")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(result.outcome).toEqual({ kind: "recommended", retailerId: "redmart" });
  });

  it.each([
    ["missing retailer", "complete", "missing"],
    ["unavailable retailer", "unavailable", "cold-storage"],
    ["higher-priced complete retailer", "complete", "redmart"],
    ["higher-priced retailer when others tie", "tie", "cold-storage"],
  ])("rejects a recommendation for a %s without replacing it", (_label, fixture, retailerId) => {
    const result = structuredClone(scenario(fixture));
    result.outcome = { kind: "recommended", retailerId };
    const { container } = render(<BasketComparisonPage result={result} />);
    expect(screen.getByRole("alert").textContent).toContain("Comparison data validation failed.");
    expect(screen.queryByText(/^Recommended/)).toBeNull();
    expect(container.textContent).not.toMatch(/lowest|joint-lowest|joint lowest/i);
    expect(container.querySelector(".retailer-option--recommended")).toBeNull();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
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
      expect(screen.queryAllByRole("article")).toHaveLength(0);
      expect(screen.queryByRole("link", { name: /^Visit |^View Synthetic / })).toBeNull();
      expect(container.textContent).not.toMatch(/lowest|joint-lowest|joint lowest/i);
      expect(container.querySelector(".retailer-option--recommended")).toBeNull();
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
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.queryByRole("link", { name: /^Visit |^View Synthetic / })).toBeNull();
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
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.queryByText("No feasible purchasing plan available")).toBeNull();
  });

  it("accepts full basket coverage regardless of line ordering", () => {
    const result = structuredClone(scenario("complete"));
    for (const option of result.options) if (option.kind === "complete") option.lines.reverse();
    render(<BasketComparisonPage result={result} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/^Recommended/)).toBeDefined();
    expect(screen.getAllByRole("article")).toHaveLength(result.options.length);
  });

  it("shows unavailable reasons without a total, purchase action or recommendation", () => {
    render(<BasketComparisonPage result={scenario("unavailable")} />);
    const card = within(screen.getByRole("article", { name: "Cold Storage" }));
    expect(card.getByText("Unavailable")).toBeDefined();
    expect(
      card.getByText("Synthetic Milk has no eligible offer in this fixture dataset."),
    ).toBeDefined();
    expect(card.queryByText(/Recommended|S\$|Estimated total/)).toBeNull();
    expect(card.queryByRole("link")).toBeNull();
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
    expect(screen.queryByText(/Recommended|S\$/)).toBeNull();
  });

  it("provides purchase links, manual guidance and fixed-dataset disclosure", () => {
    render(<BasketComparisonPage result={scenario("complete")} />);
    const card = within(screen.getByRole("article", { name: "FairPrice" }));
    expect(card.getByText(/complete checkout manually/)).toBeDefined();
    expect(
      card
        .getByRole("link", { name: "View Synthetic White Rice at FairPrice" })
        .getAttribute("href"),
    ).toBe("https://example.com/fairprice/fixture-rice");
    const link = card.getByRole("link", { name: "Visit FairPrice" });
    expect(link.getAttribute("href")).toBe("https://www.fairprice.com.sg/");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText(SNAPSHOT_DISCLAIMER, { exact: false })).toBeDefined();
    expect(screen.getByText(/Product links are illustrative/)).toBeDefined();
  });

  it.each(Object.keys(comparisonFixtures))("has no split-plan or savings results in %s", (name) => {
    const { container } = render(<BasketComparisonPage result={scenario(name)} />);
    expect(container.textContent).not.toMatch(/split|baseline|savings|Save S\$|search limit/i);
  });
});
