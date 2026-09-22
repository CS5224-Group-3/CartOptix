/**
 * The shared pricing module (issue #8, technical spec C1).
 *
 * One deterministic place where money is calculated, so offer comparison and
 * basket comparison can never disagree about what something costs. Everything
 * here is pure: no clock, no database, no environment.
 *
 * Current scope is verified ordinary and unconditional sale prices, mandatory
 * charges and one documented delivery scenario per retailer. Bundle multibuys
 * are modelled and tested but inert until curation approves one (PR-03).
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
  BundlePromotionRule,
  DeliveryRule,
  ExcludedPromotionRule,
  MandatoryChargeRule,
  OfferRule,
  ThresholdBasis,
} from "./rules.ts";
