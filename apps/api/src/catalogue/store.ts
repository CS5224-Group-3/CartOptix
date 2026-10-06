import type { CatalogueResponse } from "@cartoptix/contracts";
import { asc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { categories, deliveryRules, retailers } from "../db/schema.ts";

export interface CatalogueStore {
  catalogue(): Promise<CatalogueResponse>;
}

export function createDatabaseCatalogueStore(db: NodePgDatabase): CatalogueStore {
  return {
    async catalogue() {
      return db.transaction(
        async (tx) => {
          const retailerRows = await tx
            .select({ retailerId: retailers.retailerId, name: retailers.name })
            .from(retailers)
            .orderBy(asc(retailers.retailerId));
          const categoryRows = await tx
            .select({ categoryId: categories.categoryId, name: categories.name })
            .from(categories)
            .orderBy(asc(categories.categoryId));
          const deliveryRows = await tx
            .select({
              retailerId: deliveryRules.retailerId,
              status: deliveryRules.status,
              deliveryFeeCents: deliveryRules.deliveryFeeCents,
              freeDeliveryFromCents: deliveryRules.freeDeliveryFromCents,
              minimumOrderCents: deliveryRules.minimumOrderCents,
              note: deliveryRules.note,
            })
            .from(deliveryRules)
            .orderBy(asc(deliveryRules.retailerId));

          return {
            retailers: retailerRows,
            categories: categoryRows,
            delivery: {
              rules: deliveryRows.map((rule) => {
                if (rule.status === "verified") {
                  if (rule.note === null || rule.note.trim().length === 0) {
                    throw new Error(`Verified delivery rule for ${rule.retailerId} has no note`);
                  }
                  if (rule.deliveryFeeCents === null) {
                    return { retailerId: rule.retailerId, status: "unavailable" as const };
                  }
                  return {
                    retailerId: rule.retailerId,
                    status: "verified" as const,
                    deliveryFeeCents: rule.deliveryFeeCents,
                    freeDeliveryFromCents: rule.freeDeliveryFromCents,
                    minimumOrderCents: rule.minimumOrderCents,
                    note: rule.note,
                  };
                }
                return { retailerId: rule.retailerId, status: "unavailable" as const };
              }),
            },
          } satisfies CatalogueResponse;
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  };
}
