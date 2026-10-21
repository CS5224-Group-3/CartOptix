/**
 * Maps a basket comparison onto the shared contract's response.
 */
import type {
  BasketCompareResponse,
  RetailerOption as ContractOption,
  Order,
  PlanLine,
  UnavailableOption,
} from "@cartoptix/contracts";
import type { PricedLine, PricedRetailerOrder } from "../pricing/index.ts";
import { toWireMultibuy } from "../products/offers.ts";
import type { BasketComparison, RetailerOption, UnavailableRetailerOption } from "./index.ts";
import type { ListingDetails } from "./store.ts";

export function toCompareResponse(
  result: BasketComparison,
  listings: ReadonlyMap<string, ListingDetails>,
): BasketCompareResponse {
  if (result.status === "no_feasible_plan") {
    return { ...result, options: result.options.map((option) => toUnavailable(option, listings)) };
  }
  return { ...result, options: result.options.map((option) => toOption(option, listings)) };
}

function toOption(
  option: RetailerOption,
  listings: ReadonlyMap<string, ListingDetails>,
): ContractOption {
  if (option.status === "unavailable") return toUnavailable(option, listings);
  return { status: "complete", ...toOrder(option.order, listings) };
}

function toUnavailable(
  { partialOrder, ...option }: UnavailableRetailerOption,
  listings: ReadonlyMap<string, ListingDetails>,
): UnavailableOption {
  return partialOrder ? { ...option, partialOrder: toOrder(partialOrder, listings) } : option;
}

function toOrder(order: PricedRetailerOrder, listings: ReadonlyMap<string, ListingDetails>): Order {
  return {
    retailerId: order.retailerId,
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

function toPlanLine(line: PricedLine, listings: ReadonlyMap<string, ListingDetails>): PlanLine {
  const listing = listings.get(line.listingId);
  if (!listing) throw new Error(`No listing details for ${line.listingId}`);
  return {
    productId: line.productId,
    quantity: line.packs,
    listingId: line.listingId,
    productUrl: listing.productUrl,
    priceKind: line.priceKind,
    unitPriceCents: line.unitPrice,
    originalPriceCents: listing.originalPriceCents,
    multibuy: toWireMultibuy(line),
    itemCharges: line.appliedCharges.map((charge) => ({
      label: charge.label,
      amountCents: charge.amount,
      includedInPrice: false,
    })),
    lineTotalCents: line.total,
    excludedPromotions: listing.excludedPromotions,
  };
}
