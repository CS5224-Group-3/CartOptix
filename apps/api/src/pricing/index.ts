/**
 * The shared pricing module (issue #8, technical spec C1).
 *
 * One deterministic place where money is calculated, so offer comparison and
 * basket comparison can never disagree about what something costs. Everything
 * here is pure: no clock, no database, no environment.
 *
 * Scope is verified ordinary and unconditional sale prices, mandatory charges
 * and one documented delivery scenario per retailer. Multibuys are out of
 * scope until #4 verifies one; section 4 allows the initial kernel to omit
 * them entirely.
 *
 * Pack limits and retailer IDs come from `@cartoptix/contracts`, so the
 * module enforces the same bounds and names as the request schema.
 *
 * Results describe pricing outcomes. A caller mistake throws
 * `PricingContractError` instead, because the API validates requests against
 * the contract schemas before pricing runs.
 */

export { type PriceLineInput, priceLine } from "./line.ts";
export {
  isCents,
  type MoneyParseResult,
  multiplyCents,
  parseMoneyToCents,
  sumCents,
} from "./money.ts";
export { type PriceRetailerOrderInput, priceRetailerOrder } from "./order.ts";
export type {
  AppliedCharge,
  Cents,
  DeliveryCharge,
  LinePricingResult,
  OrderCharge,
  OrderInfeasibility,
  PackPricing,
  PricedLine,
  PricedRetailerOrder,
  PriceKind,
  PricingDisclosure,
  PricingDisclosureCode,
  PricingUnavailable,
  PricingUnavailableCode,
  RetailerOrderPricingResult,
} from "./results.ts";
export { PricingContractError } from "./results.ts";
export type {
  DeliveryRule,
  ExcludedPromotionRule,
  MandatoryChargeRule,
  OfferRule,
  OrderChargeRule,
  ThresholdBasis,
} from "./rules.ts";
