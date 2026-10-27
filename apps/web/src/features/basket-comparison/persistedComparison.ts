/**
 * Every read validates the stored snapshot the same way: one malformed value
 * rejects the whole record, and nothing is partially restored or rewritten.
 */

import { MAX_PACKS_PER_LINE, MIN_PACKS_PER_LINE } from "@cartoptix/contracts";
import type { BasketLine } from "../basket/model";
import { type BasketStorage, validStoredBasket } from "../basket/storage";
import type {
  BasketComparisonPresentation,
  BasketSnapshot,
  ComparisonSubmission,
  RetailerOption,
  SubmittedProduct,
} from "./model";

/** Storage key of the tab's last successful comparison; tests clear it between app mounts. */
export const COMPARISON_STORAGE_KEY = "cartoptix:comparison:v1";
const SNAPSHOT_VERSION = 1;

/** The listing price kinds from the contracts; the breakdown renders their label. */
const PRICE_KINDS = ["ordinary", "unconditional_sale"] as const;

type PersistedComparison = {
  version: 1;
  /** The request's success payload, including the submitted basket revision. */
  submitted: ComparisonSubmission;
  result: BasketComparisonPresentation;
};

function tabSessionStorage(): BasketStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * Validates the stored snapshot the same way on every read: one malformed value
 * rejects the whole record, and nothing is partially restored or rewritten.
 */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An integer of at least zero: money amounts, item counts and revisions. */
const isNonNegativeInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** An integer above zero: prices and deal amounts are positive. */
const isPositiveInt = (value: unknown): value is number => isNonNegativeInt(value) && value > 0;

const isPacks = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= MIN_PACKS_PER_LINE &&
  value <= MAX_PACKS_PER_LINE;

/** Validates product lines with their display metadata; malformed data rejects wholesale. */
function submittedProducts(value: unknown): SubmittedProduct[] | null {
  const lines = validStoredBasket(value);
  // validStoredBasket consumed the same array, so the raw positions line up by construction.
  if (!lines || !Array.isArray(value)) return null;
  const products: SubmittedProduct[] = [];
  for (const [index, line] of lines.entries()) {
    const raw = value[index] as Record<string, unknown>;
    // Persisted submissions always carry verified identity; blank identity is malformed.
    if (
      typeof raw.name !== "string" ||
      raw.name.trim() === "" ||
      typeof raw.packDescription !== "string" ||
      raw.packDescription.trim() === ""
    ) {
      return null;
    }
    if (raw.imageUrl !== undefined && raw.imageUrl !== null && typeof raw.imageUrl !== "string")
      return null;
    products.push({
      ...line,
      name: raw.name,
      packDescription: raw.packDescription,
      ...(raw.imageUrl === undefined ? {} : { imageUrl: raw.imageUrl as string | null }),
    });
  }
  return products;
}

/** Validates a persisted basket snapshot; malformed data rejects wholesale. */
function parseBasketSnapshot(value: unknown): BasketSnapshot | null {
  if (!isObject(value)) return null;
  const { revision, products } = value;
  // A non-negative integer — the same guard money amounts use.
  if (!isNonNegativeInt(revision)) return null;
  const lines = submittedProducts(products);
  return lines ? { revision, products: lines } : null;
}

/** Validates a submitted product as option rows and missing-product lists render it. */
function submittedProductLine(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.productId === "string" &&
    typeof value.name === "string" &&
    value.name.trim() !== "" &&
    typeof value.packDescription === "string" &&
    value.packDescription.trim() !== "" &&
    isPacks(value.quantity) &&
    (value.imageUrl === undefined || value.imageUrl === null || typeof value.imageUrl === "string")
  );
}

/** Validates the mandatory per-line charges the breakdown shows. */
function isItemCharge(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.label === "string" &&
    isNonNegativeInt(value.amountCents) &&
    typeof value.includedInPrice === "boolean"
  );
}

/** Validates the per-line pricing the breakdown and deal notes read. */
function isLinePricing(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    isPositiveInt(value.unitPriceCents) &&
    (value.originalPriceCents === null || isPositiveInt(value.originalPriceCents)) &&
    (value.multibuy === null || isMultibuy(value.multibuy)) &&
    (PRICE_KINDS as readonly unknown[]).includes(value.priceKind) &&
    Array.isArray(value.itemCharges) &&
    value.itemCharges.every(isItemCharge) &&
    Array.isArray(value.excludedPromotions) &&
    value.excludedPromotions.every((promotion) => typeof promotion === "string")
  );
}

/** Validates the multibuy deal fields the option card turns into notes. */
function isMultibuy(value: unknown): boolean {
  return (
    isObject(value) &&
    isPacks(value.packsPerDeal) &&
    isPositiveInt(value.dealPriceCents) &&
    typeof value.mixAndMatch === "boolean" &&
    // The retailer's rounded label: a percentage above zero and below one hundred.
    ((typeof value.percentOff === "number" && value.percentOff > 0 && value.percentOff < 100) ||
      value.percentOff === null) &&
    isNonNegativeInt(value.timesApplied) &&
    isNonNegativeInt(value.savingCents)
  );
}

/** Validates an order as its interactive breakdown and purchase links use it. */
function isOrderPresentation(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    [value.productSubtotalCents, value.deliveryCents, value.estimatedTotalCents].every(
      isNonNegativeInt,
    ) &&
    Array.isArray(value.lines) &&
    value.lines.every((line) => {
      if (!submittedProductLine(line) || !isObject(line)) return false;
      if (!isNonNegativeInt(line.amountCents)) return false;
      // The contract's HTTPS product links; the card's outbound navigation uses them as-is.
      if (typeof line.purchaseUrl !== "string" || !line.purchaseUrl.startsWith("https://"))
        return false;
      return isLinePricing(line.pricing);
    }) &&
    Array.isArray(value.charges) &&
    value.charges.every(
      (charge) =>
        isObject(charge) &&
        typeof charge.label === "string" &&
        isNonNegativeInt(charge.amountCents),
    ) &&
    Array.isArray(value.orderCharges) &&
    value.orderCharges.every(
      (charge) =>
        isObject(charge) &&
        isNonNegativeInt(charge.amountCents) &&
        (charge.waivedFromCents === null || isNonNegativeInt(charge.waivedFromCents)) &&
        typeof charge.waived === "boolean",
    )
  );
}

/** Validates a retailer option card as its page renders it; success or failure verdict is final. */
function isRetailerOption(value: unknown): value is RetailerOption {
  if (!isObject(value)) return false;
  if (value.kind !== "complete" && value.kind !== "unavailable") return false;
  if (
    !isObject(value.retailer) ||
    typeof value.retailer.id !== "string" ||
    typeof value.retailer.name !== "string"
  ) {
    return false;
  }
  if (value.kind === "complete") return isOrderPresentation(value);
  if (
    !Array.isArray(value.reasons) ||
    !value.reasons.every((reason) => typeof reason === "string")
  ) {
    return false;
  }
  if (
    value.explanations !== undefined &&
    (!Array.isArray(value.explanations) ||
      !value.explanations.every(
        (explanation) =>
          isObject(explanation) &&
          isObject(explanation.reason) &&
          typeof explanation.reason.code === "string" &&
          typeof explanation.text === "string",
      ))
  ) {
    return false;
  }
  if (value.partial !== undefined && !isOrderPresentation(value.partial)) return false;
  if (
    value.missingProducts !== undefined &&
    (!Array.isArray(value.missingProducts) || !value.missingProducts.every(submittedProductLine))
  ) {
    return false;
  }
  return true;
}

/** Validates the comparison presentation the results and basket pages render directly. */
function parsePresentation(value: unknown): BasketComparisonPresentation | null {
  if (!isObject(value)) return null;
  const submittedBasket = parseBasketSnapshot(value.submittedBasket);
  if (!submittedBasket || !Array.isArray(value.options)) return null;
  if (!value.options.every(isRetailerOption)) return null;
  if (!isObject(value.outcome)) return null;
  let outcome: BasketComparisonPresentation["outcome"];
  if (value.outcome.kind === "recommended") {
    if (typeof value.outcome.retailerId !== "string") return null;
    outcome = { kind: "recommended", retailerId: value.outcome.retailerId };
  } else if (value.outcome.kind === "no-feasible-plan") {
    outcome = { kind: "no-feasible-plan" };
  } else {
    return null;
  }
  if (value.fixtureLabel !== undefined && typeof value.fixtureLabel !== "string") return null;
  return {
    submittedBasket,
    // Every element passed retailerOption, so the spread builds the option union.
    options: [...value.options],
    outcome,
    ...(typeof value.fixtureLabel === "string" ? { fixtureLabel: value.fixtureLabel } : {}),
  };
}

function parsePersistedRecord(value: unknown): PersistedComparison | null {
  if (!isObject(value) || value.version !== SNAPSHOT_VERSION) return null;
  const submittedSnapshot = parseBasketSnapshot(
    isObject(value.submitted) ? value.submitted.basket : undefined,
  );
  if (!submittedSnapshot) return null;
  const result = parsePresentation(value.result);
  if (!result) return null;
  // Request and result describe one submission; a disagreement is corrupt beyond display.
  if (!sameBasket(result.submittedBasket.products, submittedSnapshot.products)) return null;
  return {
    version: SNAPSHOT_VERSION,
    submitted: { basket: submittedSnapshot },
    result,
  };
}

export type RestoredComparison = {
  /** The comparison to seed as the request succeeded. */
  result: BasketComparisonPresentation;
  /** The success-phase payload to seed alongside the result. */
  submitted: ComparisonSubmission;
  /**
   * Revision token to seed the tab's counter with: the submitted revision while
   * the restored basket still matches the persisted one, otherwise a distinct
   * value so the comparison reads as stale immediately. Like the in-memory
   * revision logic, matching is content-blind: an edit that returns the basket
   * to the exact submitted lines reads as current.
   */
  revisionSeed: number;
};

/** Whether two product lists line up exactly, by identity and quantity in order. */
function sameBasket(submitted: BasketLine[], basket: BasketLine[]): boolean {
  return (
    submitted.length === basket.length &&
    submitted.every((product, index) => {
      const line = basket[index];
      return (
        line !== undefined &&
        line.productId === product.productId &&
        line.quantity === product.quantity
      );
    })
  );
}

/** Restores the tab's last successful comparison, or null when absent or malformed. */
export function restoreComparison(basket: BasketLine[]): RestoredComparison | null {
  let serialized: string | null;
  try {
    serialized = tabSessionStorage()?.getItem(COMPARISON_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
  if (serialized === null) return null;
  let record: PersistedComparison | null;
  try {
    record = parsePersistedRecord(JSON.parse(serialized));
  } catch {
    return null;
  }
  if (!record) return null;
  return {
    result: record.result,
    submitted: record.submitted,
    revisionSeed: sameBasket(record.submitted.basket.products, basket)
      ? // The basket unchanged: keep the persisted revision as the tab's current
        // token, so isStale stays false until the shopper edits again.
        record.submitted.basket.revision
      : // The basket differs: seed one past the persisted revision so nothing
        // later can equal it — the snapshot reads as stale immediately and
        // stays stale under every further edit.
        record.submitted.basket.revision + 1,
  };
}

/** Remembers the tab's last successful comparison for its next load. */
export function persistComparison(
  submitted: ComparisonSubmission,
  result: BasketComparisonPresentation,
): void {
  try {
    tabSessionStorage()?.setItem(
      COMPARISON_STORAGE_KEY,
      JSON.stringify({
        version: SNAPSHOT_VERSION,
        submitted,
        result,
      } satisfies PersistedComparison),
    );
  } catch {
    // Storage may be unavailable or full; a reload then behaves as before this fix.
  }
}
