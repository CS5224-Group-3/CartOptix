/**
 * Maps a basket comparison onto the shared contract's response.
 */
import type {
  BasketCompareResponse,
  RetailerOption as ContractOption,
  UnavailableReason as ContractReason,
  PlanLine,
} from "@cartoptix/contracts";
import type { PricedLine } from "../pricing/index.ts";
import type { BasketComparison, RetailerOption, UnavailableReason } from "./index.ts";
import type { ListingDetails } from "./store.ts";

export function toCompareResponse(
  result: BasketComparison,
  listings: ReadonlyMap<string, ListingDetails>,
): BasketCompareResponse {
  if (result.status === "no-feasible-plan") {
    return {
      status: "no_feasible_plan",
      options: result.options.map((option) => {
        if (option.status !== "unavailable") throw new Error("A complete option has no plan");
        return unavailable(option);
      }),
    };
  }
  return {
    status: "recommended",
    recommendedRetailerId: result.recommendedRetailerId,
    options: result.options.map((option) => toOption(option, listings)),
  };
}

function toOption(
  option: RetailerOption,
  listings: ReadonlyMap<string, ListingDetails>,
): ContractOption {
  if (option.status === "unavailable") return unavailable(option);
  const { order } = option;
  return {
    status: "complete",
    retailerId: option.retailerId,
    lines: order.lines.map((line) => toPlanLine(line, listings)),
    orderCharges: order.orderCharges.map((charge) => ({
      label: charge.label,
      amountCents: charge.amount,
      waivedFromCents: charge.waivedFrom,
      waived: charge.waived,
    })),
    deliveryCents: order.delivery.amount,
    totalCents: order.total,
  };
}

function unavailable(option: Extract<RetailerOption, { status: "unavailable" }>) {
  return {
    status: "unavailable" as const,
    retailerId: option.retailerId,
    reasons: option.reasons.map(toReason),
  };
}

function toReason(reason: UnavailableReason): ContractReason {
  switch (reason.code) {
    case "missing-products":
      return { code: "missing_products", productIds: reason.productIds };
    case "below-minimum-order":
      return {
        code: "below_minimum_order",
        minimumOrderCents: reason.minimumOrder,
        spendCents: reason.measuredAmount,
      };
    case "delivery-rule-unverified":
      return { code: "delivery_rule_unverified" };
  }
}

function toPlanLine(line: PricedLine, listings: ReadonlyMap<string, ListingDetails>): PlanLine {
  const listing = listings.get(line.listingId);
  const [segment] = line.packsBreakdown;
  if (!listing || !segment) throw new Error(`No listing details for ${line.listingId}`);
  return {
    productId: line.productId,
    quantity: line.packs,
    listingId: line.listingId,
    productUrl: listing.productUrl,
    priceKind: line.priceKind,
    unitPriceCents: segment.unitPrice,
    itemCharges: line.appliedCharges.map((charge) => ({
      label: charge.label,
      amountCents: charge.amount,
      includedInPrice: false,
    })),
    lineTotalCents: line.total,
    excludedPromotions: listing.excludedPromotions,
  };
}
