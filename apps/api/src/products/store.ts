import type { OffersResponse, Product, ProductsQuery } from "@cartoptix/contracts";
import { and, asc, count, eq, exists, inArray, like, or, type SQLWrapper, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { offerRule } from "../comparison/store.ts";
import { listings, products } from "../db/schema.ts";
import { priceOffer } from "./offers.ts";

export type ProductSearchQuery = Required<Pick<ProductsQuery, "page" | "pageSize">> &
  Omit<ProductsQuery, "page" | "pageSize">;

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
  // Lower-cases and strips whitespace, so the bound query matches however the
  // text is spaced. Drizzle still binds the user input as a query parameter.
  return sql`regexp_replace(lower(${column}), '\\s+', '', 'g')`;
}

function normalizedNameExpression(column: SQLWrapper) {
  // The shopper never sees the [BCRS] marker, so search must not match it.
  return sql`regexp_replace(lower(${column}), '\\[bcrs\\]|\\s+', '', 'g')`;
}

export interface ProductsStore {
  products(query: ProductSearchQuery): Promise<{ products: Product[]; total: number }>;
  offers(productId: string, quantity: number): Promise<OffersResponse | null>;
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
                like(normalizedNameExpression(products.representativeName), pattern),
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
          const total = Number(countRow?.total ?? 0);
          // A page past the last one is empty. Checking here also keeps a huge
          // `page` from overflowing PostgreSQL's bigint OFFSET.
          const offset = (query.page - 1) * query.pageSize;
          if (offset >= total) return { products: [], total };
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
            .offset(offset);

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
            total,
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
            .select()
            .from(listings)
            .where(eq(listings.productId, productId))
            .orderBy(asc(listings.retailerId), asc(listings.listingId));
          const offers = offerRows
            .map((offer) => priceOffer(offerRule(offer), offer, quantity))
            .filter((offer) => offer !== null)
            .sort((left, right) => left.lineTotalCents - right.lineTotalCents);
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
            offers,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  };
}
