/**
 * Maps a basket comparison onto the shared contract's response.
 */
import type {
  BasketCompareResponse,
  RetailerOption as ContractOption,
  PlanLine,
} from "@cartoptix/contracts";
import type { PricedLine } from "../pricing/index.ts";
import type { BasketComparison, RetailerOption } from "./index.ts";
import type { ListingDetails } from "./store.ts";

/** Unavailable options are already contract values; only priced orders need mapping. */
export function toCompareResponse(
  result: BasketComparison,
  listings: ReadonlyMap<string, ListingDetails>,
): BasketCompareResponse {
  if (result.status === "no_feasible_plan") return result;
  return { ...result, options: result.options.map((option) => toOption(option, listings)) };
}

function toOption(
  option: RetailerOption,
  listings: ReadonlyMap<string, ListingDetails>,
): ContractOption {
  if (option.status === "unavailable") return option;
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
