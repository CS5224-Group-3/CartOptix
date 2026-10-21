import {
  type BasketCompareResponse,
  MAX_BASKET_LINES,
  MAX_PACKS_PER_LINE,
  MIN_PACKS_PER_LINE,
  type PlanLine,
  type UnavailableReason,
} from "@cartoptix/contracts";
import { formatSgd, orderChargeLabel, RETAILER_DISPLAY } from "../../lib/format";
import {
  type BasketComparisonPresentation,
  type BasketSnapshot,
  type ComparisonProvenance,
  PresentationDataFailure,
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

function explain(reason: UnavailableReason, names: Map<string, string>): string {
  switch (reason.code) {
    case "missing_products":
      requireData(strings(reason.productIds) && reason.productIds.length > 0);
      return `No eligible offer for ${reason.productIds.map((id) => names.get(id) ?? id).join(", ")}.`;
    case "below_minimum_order":
      requireData(cents(reason.minimumOrderCents) && cents(reason.spendCents));
      return `Qualifying spend of ${formatSgd(reason.spendCents)} is below the ${formatSgd(reason.minimumOrderCents)} minimum order.`;
    case "delivery_rule_unverified":
      return "Delivery charges could not be verified, so a complete total is not shown.";
    default:
      throw new PresentationDataFailure();
  }
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
    const names = new Map(basket.products.map((product) => [product.productId, product.name]));
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
        if (option.status === "unavailable") {
          requireData(Array.isArray(option.reasons) && option.reasons.length > 0);
          const explanations = option.reasons.map((reason) => ({
            reason: structuredClone(reason),
            text: explain(reason, names),
          }));
          return {
            kind: "unavailable",
            retailer,
            explanations,
            reasons: explanations.map(({ text }) => text),
          };
        }
        requireData(option.status === "complete" && response.status === "recommended");
        requireData(Array.isArray(option.lines) && Array.isArray(option.orderCharges));
        requireData(cents(option.deliveryCents) && cents(option.totalCents));
        const lines = option.lines.map((line) => {
          const product = metadata.get(line.productId);
          requireData(product && text(product.name) && text(product.packDescription));
          requireData(
            Number.isInteger(line.quantity) &&
              line.quantity >= MIN_PACKS_PER_LINE &&
              line.quantity <= MAX_PACKS_PER_LINE,
          );
          requireData(
            text(line.listingId) && cents(line.unitPriceCents) && line.unitPriceCents > 0,
          );
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
        for (const charge of option.orderCharges) {
          requireData(
            text(charge.label) && cents(charge.amountCents) && typeof charge.waived === "boolean",
          );
          requireData(charge.waivedFromCents === null || cents(charge.waivedFromCents));
          requireData(!charge.waived || charge.waivedFromCents !== null);
        }
        const productSubtotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
        const charges = [
          { label: "Delivery", amountCents: option.deliveryCents },
          ...option.orderCharges.map((charge) => ({
            label: orderChargeLabel(charge),
            amountCents: charge.waived ? 0 : charge.amountCents,
          })),
        ];
        requireData(cents(productSubtotalCents));
        requireData(
          productSubtotalCents + charges.reduce((sum, charge) => sum + charge.amountCents, 0) ===
            option.totalCents,
        );
        return {
          kind: "complete",
          retailer,
          lines,
          productSubtotalCents,
          charges,
          orderCharges: structuredClone(option.orderCharges),
          deliveryCents: option.deliveryCents,
          estimatedTotalCents: option.totalCents,
        };
      }),
    };
    requireData(validateRecommendation(result).kind !== "invalid");
    return result;
  } catch {
    throw new PresentationDataFailure();
  }
}
