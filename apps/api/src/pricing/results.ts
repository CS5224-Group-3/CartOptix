import type { Offer, RetailerId } from "@cartoptix/contracts";

/**
 * What the pricing module returns.
 *
 * These live beside the module rather than in `@cartoptix/contracts` because
 * only basket comparison and the endpoints consume them: #10 and #13 map a
 * result onto the wire shapes that #5 owns (`Offer`, `PlanLine`, `Order`).
 * Keeping them here means the module can explain itself in as much detail as
 * comparison needs without that detail becoming a public payload.
 *
 * Every status here is a *business outcome*. A caller mistake — a quantity
 * outside the supported range, an order with no lines, a line belonging to
 * another retailer — throws instead, because the API validates requests
 * against the contract schemas before pricing runs, so reaching the module
 * with one is a bug rather than an answer.
 */

/**
 * A monetary amount in whole Singapore cents.
 *
 * Every calculation uses integers (PR-05). Dollars and floating point never
 * appear, because repeated float arithmetic cannot represent cents exactly and
 * a basket sums many lines.
 */
export type Cents = number;

/**
 * Whether a price is the ordinary price or a clearly unconditional sale price,
 * the only two the product rules allow (PR-03). Taken from the contract so a
 * priced line maps onto `Offer` and `PlanLine` without translation.
 */
export type PriceKind = Offer["priceKind"];

/**
 * Something true of a price that the shopper must be told.
 *
 * Disclosures are how the product rules stay honest: a promotion we could not
 * verify is disclosed rather than silently applied or silently dropped
 * (PR-03).
 */
export interface PricingDisclosure {
  code: PricingDisclosureCode;
  /** Shopper-facing sentence, supplied by curation rather than composed here. */
  detail: string;
}

export type PricingDisclosureCode =
  /** The source data described a promotion the estimate does not include. */
  | "promotion-excluded"
  /** A verified mandatory charge is already inside the recorded price. */
  | "charge-included-in-price";

/**
 * How the cost of one line's packs was reached: whole deals at the deal price,
 * then any remaining packs at the unit price (PR-03, section 4). A segment with
 * no packs is left out.
 */
export type PackPricing =
  | { kind: "unit"; packs: number; unitPrice: Cents; amount: Cents }
  | { kind: "multibuy"; deals: number; packsPerDeal: number; dealPrice: Cents; amount: Cents };

/** A listing's deal as it applied to one line; `deals` is 0 below its pack count. */
export interface LineMultibuy {
  packsPerDeal: number;
  dealPrice: Cents;
  mixAndMatch: boolean;
  deals: number;
  /** Saving against the unit price across the line. */
  saving: Cents;
}

/** A verified mandatory charge added on top of the recorded price. */
export interface AppliedCharge {
  /** Curation's description, for example "Beverage container deposit". */
  label: string;
  /** Amount for one pack, or null for a charge levied once per order. */
  perPack: Cents | null;
  amount: Cents;
}

/** The cost of one product line at one retailer, with its explanation. */
export interface PricedLine {
  productId: string;
  retailerId: RetailerId;
  listingId: string;
  /** Carried from the offer, so callers never re-read it from the raw record. */
  priceKind: PriceKind;
  /** The listing's price for one pack, outside any deal. */
  unitPrice: Cents;
  packs: number;
  /** The listing's deal, or null when it has none or it would not be cheaper. */
  multibuy: LineMultibuy | null;
  /** Cost of the packs themselves, before charges the price excludes. */
  packsSubtotal: Cents;
  /** Every segment of `packsSubtotal`, in the order it was applied. */
  packsBreakdown: PackPricing[];
  /** Charges added because the recorded price does not already include them. */
  appliedCharges: AppliedCharge[];
  /** `packsSubtotal` plus every applied charge. */
  total: Cents;
  disclosures: PricingDisclosure[];
}

/** What the shopper pays to have one retailer's order delivered. */
export interface DeliveryCharge {
  amount: Cents;
  /** True when the order reached the retailer's free-delivery threshold. */
  free: boolean;
  /** Null when the retailer offers no free-delivery threshold. */
  freeThreshold: Cents | null;
  /** The amount measured against the threshold, which may exclude charges. */
  measuredAmount: Cents;
}

/**
 * An order-level charge the recorded prices exclude, such as a service fee.
 *
 * A waived charge stays in the order so the breakdown can show it, but it is
 * not added to the total.
 */
export interface OrderCharge {
  label: string;
  /** The charge's normal amount, even when waived. */
  amount: Cents;
  /** Qualifying spend that waives the charge; null when it is never waived. */
  waivedFrom: Cents | null;
  /** True when this order's qualifying spend reached `waivedFrom`. */
  waived: boolean;
}

/** One retailer's complete order: its lines, its charges and its total. */
export interface PricedRetailerOrder {
  retailerId: RetailerId;
  lines: PricedLine[];
  /** Sum of every line total. */
  itemsTotal: Cents;
  delivery: DeliveryCharge;
  /** Order-level charges other than delivery, waived or not. */
  orderCharges: OrderCharge[];
  /** `itemsTotal` plus delivery plus every order charge that is not waived. */
  total: Cents;
  /** Line disclosures merged with any raised by the order's own rules. */
  disclosures: PricingDisclosure[];
}

/**
 * Why a retailer cannot fulfil this order as requested.
 *
 * This is a property of the basket, not of the data: the same retailer priced
 * a different basket successfully. It makes this retailer unavailable for the
 * basket, not the whole comparison.
 */
export interface OrderInfeasibility {
  code: "minimum-order-not-met";
  detail: string;
  /** The retailer's minimum order. */
  minimumOrder: Cents;
  /** The order's qualifying spend, on the retailer's threshold basis. */
  measuredAmount: Cents;
  /** Extra spend that would satisfy the retailer's minimum order. */
  shortfall: Cents;
}

/**
 * Why no total could be calculated at all.
 *
 * An unverified delivery rule or an unresolved mandatory charge must never
 * become zero, because a zero would understate a total and could support a
 * fabricated savings claim (PR-04).
 */
export interface PricingUnavailable {
  code: PricingUnavailableCode;
  detail: string;
}

export type PricingUnavailableCode =
  /** The retailer's delivery rule for the recorded scenario is unverified. */
  | "delivery-rule-unverified"
  /** A mandatory charge applies but its amount is unresolved. */
  | "charge-unresolved"
  /** The offer is not eligible for use, so it has no usable price. */
  | "offer-ineligible";

/** The result of pricing one line: a price, or an explained absence of one. */
export type LinePricingResult =
  | { status: "priced"; line: PricedLine }
  | { status: "unavailable"; reason: PricingUnavailable };

/**
 * The result of pricing one retailer's order.
 *
 * `infeasible` and `unavailable` stay distinct so a blocker the basket caused
 * can be told apart from missing data (section 4, result semantics).
 */
export type RetailerOrderPricingResult =
  | { status: "priced"; order: PricedRetailerOrder }
  | { status: "infeasible"; reason: OrderInfeasibility }
  | { status: "unavailable"; reason: PricingUnavailable };

/**
 * A caller broke the module's contract.
 *
 * Distinct from every result status above, which describe real pricing
 * outcomes. The API validates requests against the contract schemas before
 * pricing, so this reaching production is a bug to fix, not a state to render.
 */
export class PricingContractError extends Error {
  override readonly name = "PricingContractError";
}
