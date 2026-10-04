import type { OffersResponse, Product } from "@cartoptix/contracts";
import { offersExample, productsExample } from "@cartoptix/contracts/fixtures";
import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { listings, products } from "../db/schema.ts";
import { priceOffer } from "./offers.ts";
import { type ProductSearchQuery, searchProducts } from "./search.ts";

function canonicalPackSize(specifications: readonly (string | null)[]): string {
  const values = [...new Set(specifications.filter((value): value is string => value !== null))];
  if (values.length === 0) return "Pack size unavailable";
  const normalized = new Set(values.map((value) => value.replace(/\s+/g, "").toLocaleLowerCase()));
  return normalized.size === 1 ? values[0] : "Pack size unavailable";
}

export interface ProductsStore {
  products(query: ProductSearchQuery): Promise<{ products: Product[]; total: number }>;
  offers(productId: string, quantity: number): Promise<OffersResponse | null>;
  close?(): Promise<void>;
}

/** Test-only store for route tests that do not require PostgreSQL. */
export function createFixtureProductsStore(): ProductsStore {
  const products = productsExample.products.map((product) => ({ ...product }));
  return {
    async products(query) {
      return searchProducts(products, query);
    },
    async offers(productId, quantity) {
      if (productId !== offersExample.product.productId) return null;
      return {
        product: structuredClone(offersExample.product),
        quantity,
        offers: offersExample.offers.map((offer) => priceOffer(offer, quantity)),
      };
    },
  };
}

export function createDatabaseProductsStore(db: NodePgDatabase): ProductsStore {
  return {
    async products(query) {
      return db.transaction(
        async (tx) => {
          const rows = await tx
            .select({
              productId: products.productId,
              categoryId: products.categoryId,
              name: products.representativeName,
              imageUrl: products.imageUrl,
              specification: listings.specification,
            })
            .from(products)
            .leftJoin(listings, eq(listings.productId, products.productId))
            .orderBy(asc(products.productId), asc(listings.listingId));
          const specifications = new Map<string, string[]>();
          for (const row of rows) {
              if (row.specification !== null)
                specifications.set(row.productId, [
                  ...(specifications.get(row.productId) ?? []),
                  row.specification,
                ]);
          }
          const result: Product[] = [];
          for (const row of rows) {
            if (result.some((product) => product.productId === row.productId)) continue;
            result.push({
              productId: row.productId,
              categoryId: row.categoryId,
              name: row.name,
              packSize: canonicalPackSize(specifications.get(row.productId) ?? []),
              available: (specifications.get(row.productId)?.length ?? 0) > 0,
              imageUrl: row.imageUrl,
            });
          }
          return searchProducts(result, query);
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
    async offers(productId, quantity) {
      return db.transaction(
        async (tx) => {
          const productRows = await tx
            .select({
              productId: products.productId,
              categoryId: products.categoryId,
              name: products.representativeName,
              imageUrl: products.imageUrl,
              specification: listings.specification,
            })
            .from(products)
            .leftJoin(listings, eq(listings.productId, products.productId))
            .where(eq(products.productId, productId))
            .orderBy(asc(listings.listingId));
          if (!productRows[0]) return null;
          const offerRows = await tx
            .select({
              retailerId: listings.retailerId,
              listingId: listings.listingId,
              productUrl: listings.productUrl,
              priceKind: listings.priceKind,
              unitPriceCents: listings.unitPriceCents,
              excludedPromotions: listings.excludedPromotions,
            })
            .from(listings)
            .where(eq(listings.productId, productId))
            .orderBy(asc(listings.unitPriceCents), asc(listings.retailerId));
          return {
            product: {
              productId: productRows[0].productId,
              categoryId: productRows[0].categoryId,
              name: productRows[0].name,
              packSize: canonicalPackSize(productRows.map((row) => row.specification)),
              available: productRows.some((row) => row.specification !== null),
              imageUrl: productRows[0].imageUrl,
            },
            quantity,
            offers: offerRows.map((offer) =>
              priceOffer(
                {
                  ...offer,
                  // BCRS deposits are intentionally not modelled in the MVP; see product spec.
                  itemCharges: [],
                  lineTotalCents: offer.unitPriceCents,
                },
                quantity,
              ),
            ),
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  };
}
