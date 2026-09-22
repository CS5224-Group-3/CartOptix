import type {
  AppliedCharge,
  Cents,
  DeliveryCharge,
  PricedLine,
  PricingDisclosure,
  RetailerOrderPricingResult,
} from "@cartoptix/contracts";
import { isCents, sumCents } from "./money.ts";
import type { DeliveryRule, MandatoryChargeRule, ThresholdBasis } from "./rules.ts";

/**
 * Cost of one retailer's complete order: its priced lines, plus the charges
 * that only exist because the order is placed with that retailer.
 *
 * This is where a split basket becomes more expensive than it looks, so the
 * optimiser must price every candidate order through here rather than summing
 * line totals.
 *
 * Like `priceLine`, this is pure and never reads the clock.
 */

export interface PriceRetailerOrderInput {
  retailerId: string;
  /** Lines already priced by `priceLine`, all belonging to this retailer. */
  lines: readonly PricedLine[];
  delivery: DeliveryRule;
  /** The active dataset, so a rule approved for another seed is not applied. */
  datasetId: string;
}

/**
 * Whether spending exactly the free-delivery threshold earns free delivery.
 *
 * Retailers state thresholds as "spend $X or more", so the boundary is
 * inclusive. This remains an assumption per retailer until curation verifies
 * each rule (issue #4, PR-04); the boundary is tested explicitly so a
 * correction is a one-line change with a failing test to prove it.
 */
const FREE_DELIVERY_BOUNDARY_IS_INCLUSIVE = true;

export function priceRetailerOrder(input: PriceRetailerOrderInput): RetailerOrderPricingResult {
  const { retailerId, lines, delivery, datasetId } = input;

  if (lines.length === 0) {
    return {
      status: "unavailable",
      reason: { code: "invalid-request", detail: "An order must contain at least one line" },
    };
  }

  const foreign = lines.find((line) => line.retailerId !== retailerId);
  if (foreign !== undefined) {
    return {
      status: "unavailable",
      reason: {
        code: "invalid-request",
        detail: `Line for listing ${foreign.listingId} belongs to retailer ${foreign.retailerId}, not ${retailerId}`,
      },
    };
  }

  if (delivery.retailerId !== retailerId || delivery.datasetId !== datasetId) {
    return {
      status: "unavailable",
      reason: {
        code: "delivery-rule-unverified",
        detail: `No delivery rule for retailer ${retailerId} in dataset ${datasetId}`,
      },
    };
  }

  // An unverified rule is not a free one. Without it there is no complete
  // total for this retailer, and a zero here would support a false saving.
  if (!delivery.verified) {
    return {
      status: "unavailable",
      reason: {
        code: "delivery-rule-unverified",
        detail: `The delivery rule for retailer ${retailerId} is not verified for the recorded scenario`,
      },
    };
  }

  const itemsTotal = sumCents(lines.map((line) => line.total));
  const measuredAmount = measureAgainstThresholds(lines, delivery.thresholdBasis);

  // Checked before the fee, because an order below the minimum cannot be
  // placed whatever delivery would have cost. This is a fact about the basket,
  // not missing data, so it is reported as infeasible rather than unavailable.
  if (delivery.minimumOrder !== null && measuredAmount < delivery.minimumOrder) {
    return {
      status: "infeasible",
      reason: {
        code: "minimum-order-not-met",
        detail: `Retailer ${retailerId} requires a minimum order of ${delivery.minimumOrder} cents`,
        shortfall: delivery.minimumOrder - measuredAmount,
      },
    };
  }

  const free = qualifiesForFreeDelivery(measuredAmount, delivery.freeDeliveryThreshold);
  const fee = free ? 0 : delivery.fee;
  if (fee === null || !isCents(fee) || fee < 0) {
    return {
      status: "unavailable",
      reason: {
        code: "delivery-rule-unverified",
        detail: `The delivery fee for retailer ${retailerId} is unresolved`,
      },
    };
  }

  const deliveryCharge: DeliveryCharge = {
    amount: fee,
    free,
    freeThreshold: delivery.freeDeliveryThreshold,
    measuredAmount,
  };

  const orderCharges = applyOrderCharges(retailerId, delivery.orderCharges);
  if (orderCharges.status === "unavailable") {
    return orderCharges;
  }

  return {
    status: "priced",
    order: {
      retailerId,
      lines: [...lines],
      itemsTotal,
      delivery: deliveryCharge,
      appliedCharges: orderCharges.applied,
      total:
        itemsTotal +
        deliveryCharge.amount +
        sumCents(orderCharges.applied.map((charge) => charge.amount)),
      disclosures: mergeDisclosures(lines, orderCharges.disclosures),
    },
  };
}

/**
 * The amount this retailer measures against its free-delivery threshold and
 * minimum order.
 *
 * Retailers do not share a convention, so the basis travels with the rule
 * rather than being assumed here (PR-04). Both thresholds use the one basis;
 * if evidence later shows a retailer measures them differently, the rule gains
 * a second basis rather than this function gaining a guess.
 */
function measureAgainstThresholds(lines: readonly PricedLine[], basis: ThresholdBasis): Cents {
  const items = sumCents(
    lines.map((line) =>
      basis.amount === "paid" ? line.packsSubtotal : line.undiscountedPacksSubtotal,
    ),
  );

  if (!basis.includesMandatoryCharges) {
    return items;
  }

  return (
    items + sumCents(lines.flatMap((line) => line.appliedCharges.map((charge) => charge.amount)))
  );
}

function qualifiesForFreeDelivery(measuredAmount: Cents, threshold: Cents | null): boolean {
  if (threshold === null) {
    return false;
  }

  return FREE_DELIVERY_BOUNDARY_IS_INCLUSIVE
    ? measuredAmount >= threshold
    : measuredAmount > threshold;
}

type OrderChargeResult =
  | { status: "ok"; applied: AppliedCharge[]; disclosures: PricingDisclosure[] }
  | Extract<RetailerOrderPricingResult, { status: "unavailable" }>;

/**
 * Order-level mandatory charges, levied once rather than per pack.
 *
 * Treated exactly as line charges are: unresolved blocks the total, and one
 * already inside the recorded prices is disclosed but not added.
 */
function applyOrderCharges(
  retailerId: string,
  charges: readonly MandatoryChargeRule[],
): OrderChargeResult {
  const applied: AppliedCharge[] = [];
  const disclosures: PricingDisclosure[] = [];

  for (const charge of charges) {
    if (charge.amount === null || !isCents(charge.amount) || charge.amount < 0) {
      return {
        status: "unavailable",
        reason: {
          code: "charge-unresolved",
          detail: `Order charge "${charge.label}" for retailer ${retailerId} has no resolved amount`,
        },
      };
    }

    if (charge.includedInPrice) {
      disclosures.push({
        code: "charge-included-in-price",
        detail: `${charge.label} is already included in these prices`,
      });
      continue;
    }

    applied.push({ label: charge.label, perPack: null, amount: charge.amount });
  }

  return { status: "ok", applied, disclosures };
}

/**
 * Collects every disclosure the order must carry, keeping each distinct one
 * once.
 *
 * Several lines commonly raise the identical notice — a deposit included in
 * the price, say — and repeating it once per line would bury the rest. First
 * occurrence wins, so the order stays deterministic.
 */
function mergeDisclosures(
  lines: readonly PricedLine[],
  orderDisclosures: readonly PricingDisclosure[],
): PricingDisclosure[] {
  const seen = new Set<string>();
  const merged: PricingDisclosure[] = [];

  for (const disclosure of [...lines.flatMap((line) => line.disclosures), ...orderDisclosures]) {
    const key = `${disclosure.code}\u0000${disclosure.detail}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(disclosure);
  }

  return merged;
}
