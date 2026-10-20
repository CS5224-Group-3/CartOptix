/**
 * Loads what a basket comparison needs from the database, in one read-only
 * repeatable-read transaction, so a concurrent seed import cannot mix old and
 * new prices within one comparison.
 */
import type { RetailerId } from "@cartoptix/contracts";
import { asc, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { deliveryRules, listings, orderCharges, products, retailers } from "../db/schema.ts";
import type { DeliveryRule, OfferRule } from "../pricing/index.ts";

/** Listing fields the response needs that pricing does not carry. */
export interface ListingDetails {
  productUrl: string;
  originalPriceCents: number | null;
  excludedPromotions: string[];
}

export interface BasketData {
  /** Requested product IDs that exist in the seed. */
  knownProductIds: Set<string>;
  retailers: RetailerId[];
  offers: OfferRule[];
  deliveryRules: DeliveryRule[];
  listings: Map<string, ListingDetails>;
}

export async function loadBasketData(
  db: NodePgDatabase,
  productIds: readonly string[],
): Promise<BasketData> {
  return db.transaction(
    async (tx) => {
      const known = await tx
        .select({ productId: products.productId })
        .from(products)
        .where(inArray(products.productId, [...productIds]));
      const listingRows = await tx
        .select()
        .from(listings)
        .where(inArray(listings.productId, [...productIds]));
      const retailerRows = await tx.select({ retailerId: retailers.retailerId }).from(retailers);
      const ruleRows = await tx.select().from(deliveryRules);
      const chargeRows = await tx.select().from(orderCharges).orderBy(asc(orderCharges.label));

      return {
        knownProductIds: new Set(known.map((row) => row.productId)),
        retailers: retailerRows.map((row) => row.retailerId),
        offers: listingRows.map(
          (row): OfferRule => ({
            listingId: row.listingId,
            productId: row.productId,
            retailerId: row.retailerId,
            priceKind: row.priceKind,
            unitPrice: row.unitPriceCents,
            // Only eligible offers are published, and the MVP models no item charges.
            eligible: true,
            charges: [],
            excludedPromotions: row.excludedPromotions.map((detail) => ({ detail })),
          }),
        ),
        deliveryRules: ruleRows.map(
          (row): DeliveryRule => ({
            retailerId: row.retailerId,
            verified: row.status === "verified",
            fee: row.deliveryFeeCents,
            freeDeliveryThreshold: row.freeDeliveryFromCents,
            minimumOrder: row.minimumOrderCents,
            thresholdBasis: {
              includesMandatoryCharges: row.thresholdIncludesMandatoryCharges ?? false,
            },
            orderCharges: chargeRows
              .filter((charge) => charge.retailerId === row.retailerId)
              .map((charge) => ({
                label: charge.label,
                amount: charge.amountCents,
                includedInPrice: false,
                waivedFrom: charge.waivedFromCents,
              })),
          }),
        ),
        listings: new Map(
          listingRows.map((row) => [
            row.listingId,
            {
              productUrl: row.productUrl,
              originalPriceCents: row.originalPriceCents,
              excludedPromotions: row.excludedPromotions,
            },
          ]),
        ),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
