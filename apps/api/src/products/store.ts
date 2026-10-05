import type { OffersResponse, Product } from "@cartoptix/contracts";
import { offersExample, productsExample } from "@cartoptix/contracts/fixtures";
import { and, asc, count, eq, exists, inArray, like, or, type SQLWrapper, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { listings, products } from "../db/schema.ts";
import { priceOffer } from "./offers.ts";
import { type ProductSearchQuery, searchProducts } from "./search.ts";

export type { ProductSearchQuery } from "./search.ts";

function canonicalPackSize(specifications: readonly (string | null)[]): string {
  const values = [...new Set(specifications.filter((value): value is string => value !== null))];
  if (values.length === 0) return "Pack size unavailable";
  const normalized = new Set(values.map(normalizePackSize));
  return normalized.size === 1
    ? lowerCaseUnits(values[0] ?? "Pack size unavailable")
    : "Pack size unavailable";
}

function shopperName(value: string): string {
  return value.replace(/\s*\[BCRS\]\s*/gi, " ").trim();
}

function lowerCaseUnits(value: string): string {
  return value.replace(/(ml|kg|g|l)\b/gi, (unit) => unit.toLocaleLowerCase());
}

function normalizePackSize(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/\s+/g, "")
    .replace(/×/g, "x")
    .replace(/(\d+(?:\.\d+)?)kg/g, (_, amount: string) => `${Number(amount) * 1000}g`)
    .replace(/(\d+(?:\.\d+)?)l/g, (_, amount: string) => `${Number(amount) * 1000}ml`);
}

function searchLikePattern(value: string): string {
  // Products search treats SQL wildcard characters as ordinary text.
  return `%${value.trim().toLocaleLowerCase().replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_").replace(/\s+/g, "")}%`;
}

function normalizedSearchExpression(column: SQLWrapper) {
  // PostgreSQL does the same normalization as normalizeSearchText(), while
  // Drizzle still binds the user input as a query parameter.
  return sql`regexp_replace(lower(${column}), '\\s+', '', 'g')`;
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
          const predicates = [];
          if (query.categoryId !== undefined) {
            predicates.push(eq(products.categoryId, query.categoryId));
          }
          if (query.q !== undefined) {
            const pattern = searchLikePattern(query.q);
            predicates.push(
              or(
                like(normalizedSearchExpression(products.representativeName), pattern),
                exists(
                  tx
                    .select({ listingId: listings.listingId })
                    .from(listings)
                    .where(
                      and(
                        eq(listings.productId, products.productId),
                        like(normalizedSearchExpression(listings.specification), pattern),
                      ),
                    ),
                ),
              ),
            );
          }
          const where = predicates.length === 0 ? undefined : and(...predicates);
          const [countRow] = await tx.select({ total: count() }).from(products).where(where);
          const total = countRow?.total ?? 0;
          const pageRows = await tx
            .select({
              productId: products.productId,
              categoryId: products.categoryId,
              name: products.representativeName,
              imageUrl: products.imageUrl,
            })
            .from(products)
            .where(where)
            .orderBy(asc(products.productId))
            .limit(query.pageSize)
            .offset((query.page - 1) * query.pageSize);
          if (pageRows.length === 0) return { products: [], total: Number(total) };

          const specificationRows = await tx
            .select({ productId: listings.productId, specification: listings.specification })
            .from(listings)
            .where(
              inArray(
                listings.productId,
                pageRows.map((row) => row.productId),
              ),
            )
            .orderBy(asc(listings.productId), asc(listings.listingId));
          const specifications = new Map<string, string[]>();
          for (const row of specificationRows) {
            specifications.set(row.productId, [
              ...(specifications.get(row.productId) ?? []),
              row.specification,
            ]);
          }
          return {
            products: pageRows.map((row) => ({
              productId: row.productId,
              categoryId: row.categoryId,
              name: shopperName(row.name),
              packSize: canonicalPackSize(specifications.get(row.productId) ?? []),
              available: (specifications.get(row.productId)?.length ?? 0) > 0,
              imageUrl: row.imageUrl,
            })),
            total: Number(total),
          };
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
              name: shopperName(productRows[0].name),
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
