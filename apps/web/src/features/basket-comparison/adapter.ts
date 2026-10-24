import {
  type BasketCompareResponse,
  MAX_BASKET_LINES,
  MAX_PACKS_PER_LINE,
  MIN_PACKS_PER_LINE,
  type Order,
  type PlanLine,
  type UnavailableOption,
  type UnavailableReason,
} from "@cartoptix/contracts";
import { formatSgd, orderChargeLabel, RETAILER_DISPLAY } from "../../lib/format";
import {
  type BasketComparisonPresentation,
  type BasketSnapshot,
  type ComparisonProvenance,
  type OrderPresentation,
  PresentationDataFailure,
  type RetailerPresentation,
  type SubmittedProduct,
  type UnavailableRetailerOption,
} from "./model";
import { validateRecommendation } from "./validation";

export const apiProvenance: ComparisonProvenance = {
  kind: "curated",
  description:
    "Prices come from CartOptix's curated retailer dataset, not live retailer prices. Product links open the retailer's own page.",
};

function requireData(condition: unknown): asserts condition {
  if (!condition) throw new PresentationDataFailure();
}
const cents = (value: number) => Number.isSafeInteger(value) && value >= 0;
const text = (value: string) => typeof value === "string" && value.trim().length > 0;
const strings = (value: string[]) => Array.isArray(value) && value.every(text);

export function validateSnapshot(basket: BasketSnapshot): void {
  try {
    requireData(Number.isSafeInteger(basket.revision) && basket.revision >= 0);
    requireData(
      Array.isArray(basket.products) &&
        basket.products.length > 0 &&
        basket.products.length <= MAX_BASKET_LINES,
    );
    requireData(
      new Set(basket.products.map((product) => product.productId)).size === basket.products.length,
    );
    for (const product of basket.products) {
      requireData(text(product.productId) && text(product.name) && text(product.packDescription));
      requireData(
        Number.isInteger(product.quantity) &&
          product.quantity >= MIN_PACKS_PER_LINE &&
          product.quantity <= MAX_PACKS_PER_LINE,
      );
    }
  } catch {
    throw new PresentationDataFailure();
  }
}

/**
 * What a line's packs cost: whole deals at the deal price, the rest at the unit
 * price. Rejects a deal whose counts or saving do not add up.
 */
function packsCost({ quantity, unitPriceCents, priceKind, multibuy }: PlanLine): number {
  if (multibuy === null) return unitPriceCents * quantity;
  // A deal never stacks on a sale price (PR-03).
  requireData(priceKind === "ordinary");
  const { packsPerDeal, dealPriceCents, timesApplied, savingCents } = multibuy;
  requireData(
    Number.isInteger(packsPerDeal) &&
      packsPerDeal >= 2 &&
      cents(dealPriceCents) &&
      dealPriceCents > 0 &&
      dealPriceCents < unitPriceCents * packsPerDeal &&
      typeof multibuy.mixAndMatch === "boolean" &&
      (multibuy.percentOff === null ||
        (typeof multibuy.percentOff === "number" &&
          multibuy.percentOff > 0 &&
          multibuy.percentOff < 100)),
  );
  requireData(timesApplied === Math.floor(quantity / packsPerDeal));
  requireData(savingCents === timesApplied * (unitPriceCents * packsPerDeal - dealPriceCents));
  return timesApplied * dealPriceCents + (quantity - timesApplied * packsPerDeal) * unitPriceCents;
}

function explain(reason: UnavailableReason, names: Map<string, string>, retailer: string): string {
  switch (reason.code) {
    case "missing_products":
      requireData(strings(reason.productIds) && reason.productIds.length > 0);
      return `Not available at ${retailer}: ${reason.productIds.map((id) => names.get(id) ?? id).join(", ")}.`;
    case "below_minimum_order":
      requireData(cents(reason.minimumOrderCents) && cents(reason.spendCents));
      requireData(reason.spendCents < reason.minimumOrderCents);
      return `Below ${retailer}'s ${formatSgd(reason.minimumOrderCents)} minimum order — ${formatSgd(reason.minimumOrderCents - reason.spendCents)} more needed.`;
    case "delivery_rule_unverified":
      return `${retailer}'s delivery charges could not be confirmed, so no total is shown.`;
    default:
      throw new PresentationDataFailure();
  }
}

/** One order's lines, charges and total, checked to reconcile. */
function adaptOrder(order: Order, metadata: Map<string, SubmittedProduct>): OrderPresentation {
  requireData(Array.isArray(order.lines) && order.lines.length > 0);
  requireData(Array.isArray(order.orderCharges));
  requireData(cents(order.deliveryCents) && cents(order.totalCents));
  requireData(new Set(order.lines.map((line) => line.productId)).size === order.lines.length);
  const lines = order.lines.map((line) => {
    const product = metadata.get(line.productId);
    requireData(product && text(product.name) && text(product.packDescription));
    requireData(
      Number.isInteger(line.quantity) &&
        line.quantity >= MIN_PACKS_PER_LINE &&
        line.quantity <= MAX_PACKS_PER_LINE,
    );
    requireData(text(line.listingId) && cents(line.unitPriceCents) && line.unitPriceCents > 0);
    requireData(cents(line.lineTotalCents) && line.lineTotalCents > 0);
    requireData(line.priceKind === "ordinary" || line.priceKind === "unconditional_sale");
    const original = line.originalPriceCents;
    requireData(
      line.priceKind === "unconditional_sale"
        ? original !== null && cents(original) && original > line.unitPriceCents
        : original === null,
    );
    requireData(text(line.productUrl) && new URL(line.productUrl).protocol === "https:");
    requireData(Array.isArray(line.itemCharges) && strings(line.excludedPromotions));
    for (const charge of line.itemCharges)
      requireData(
        text(charge.label) &&
          cents(charge.amountCents) &&
          typeof charge.includedInPrice === "boolean",
      );
    // Reconciliation checks reject data; they never replace API amounts.
    requireData(
      line.lineTotalCents ===
        packsCost(line) +
          line.itemCharges.reduce(
            (sum, charge) => sum + (charge.includedInPrice ? 0 : charge.amountCents),
            0,
          ),
    );
    return {
      productId: line.productId,
      quantity: line.quantity,
      name: product.name,
      packDescription: product.packDescription,
      amountCents: line.lineTotalCents,
      purchaseUrl: line.productUrl,
      pricing: structuredClone({
        unitPriceCents: line.unitPriceCents,
        originalPriceCents: line.originalPriceCents,
        priceKind: line.priceKind,
        multibuy: line.multibuy,
        itemCharges: line.itemCharges,
        excludedPromotions: line.excludedPromotions,
      }),
    };
  });
  for (const charge of order.orderCharges) {
    requireData(
      text(charge.label) && cents(charge.amountCents) && typeof charge.waived === "boolean",
    );
    requireData(charge.waivedFromCents === null || cents(charge.waivedFromCents));
    requireData(!charge.waived || charge.waivedFromCents !== null);
  }
  const productSubtotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const charges = [
    { label: "Delivery", amountCents: order.deliveryCents },
    ...order.orderCharges.map((charge) => ({
      label: orderChargeLabel(charge),
      amountCents: charge.waived ? 0 : charge.amountCents,
    })),
  ];
  requireData(cents(productSubtotalCents));
  requireData(
    productSubtotalCents + charges.reduce((sum, charge) => sum + charge.amountCents, 0) ===
      order.totalCents,
  );
  return {
    lines,
    productSubtotalCents,
    charges,
    orderCharges: structuredClone(order.orderCharges),
    deliveryCents: order.deliveryCents,
    estimatedTotalCents: order.totalCents,
  };
}

/**
 * An unavailable option, with what checking out what the retailer has would
 * cost. Its partial order and its missing products must cover the basket
 * exactly, each at the quantity submitted.
 */
function adaptUnavailable(
  option: UnavailableOption,
  retailer: RetailerPresentation,
  metadata: Map<string, SubmittedProduct>,
): UnavailableRetailerOption {
  requireData(Array.isArray(option.reasons) && option.reasons.length > 0);
  const names = new Map([...metadata].map(([id, product]) => [id, product.name]));
  const explanations = option.reasons.map((reason) => ({
    reason: structuredClone(reason),
    text: explain(reason, names, retailer.name),
  }));
  const missingIds = option.reasons.flatMap((reason) =>
    reason.code === "missing_products" ? reason.productIds : [],
  );
  requireData(new Set(missingIds).size === missingIds.length);
  const missingProducts = missingIds.map((id) => {
    const product = metadata.get(id);
    requireData(product);
    return structuredClone(product);
  });
  const result: UnavailableRetailerOption = {
    kind: "unavailable",
    retailer,
    explanations,
    reasons: explanations.map(({ text }) => text),
    missingProducts,
  };
  if (option.partialOrder === undefined) return result;
  // Without a verified delivery rule there is no total to estimate (never a zero fee).
  requireData(option.reasons.every((reason) => reason.code !== "delivery_rule_unverified"));
  requireData(option.partialOrder.retailerId === option.retailerId);
  const partial = adaptOrder(option.partialOrder, metadata);
  const priced = partial.lines.map((line) => line.productId);
  requireData(priced.every((id) => !missingIds.includes(id)));
  requireData(priced.length + missingIds.length === metadata.size);
  for (const line of partial.lines)
    requireData(metadata.get(line.productId)?.quantity === line.quantity);
  return { ...result, partial };
}

/** Display adaptation, not pricing. Input amounts, identities, order and recommendation are retained.
 * Runtime checks protect the boundary because the existing HTTP client casts JSON to its shared type.
 */
export function adaptComparison(
  response: BasketCompareResponse,
  basket: BasketSnapshot,
  provenance: ComparisonProvenance = apiProvenance,
): BasketComparisonPresentation {
  try {
    validateSnapshot(basket);
    requireData(response.status === "recommended" || response.status === "no_feasible_plan");
    requireData(Array.isArray(response.options) && response.options.length > 0);
    const metadata = new Map(basket.products.map((product) => [product.productId, product]));
    const result: BasketComparisonPresentation = {
      submittedBasket: structuredClone(basket),
      provenance: structuredClone(provenance),
      outcome:
        response.status === "recommended"
          ? { kind: "recommended", retailerId: response.recommendedRetailerId }
          : { kind: "no-feasible-plan" },
      options: response.options.map((option) => {
        requireData(Object.hasOwn(RETAILER_DISPLAY, option.retailerId));
        const retailer = { id: option.retailerId, name: RETAILER_DISPLAY[option.retailerId].name };
        if (option.status === "unavailable") return adaptUnavailable(option, retailer, metadata);
        requireData(option.status === "complete" && response.status === "recommended");
        requireData(option.retailerId === retailer.id);
        return { kind: "complete", retailer, ...adaptOrder(option, metadata) };
      }),
    };
    requireData(validateRecommendation(result).kind !== "invalid");
    return result;
  } catch {
    throw new PresentationDataFailure();
  }
}
