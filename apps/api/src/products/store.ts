import type { OffersResponse, Product } from "@cartoptix/contracts";
import { offersExample, productsExample } from "@cartoptix/contracts/fixtures";
import { priceOffer } from "./offers.ts";
import { type ProductSearchQuery, searchProducts } from "./search.ts";
import pg from "pg";

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

export function createDatabaseProductsStore(connectionString: string): ProductsStore {
  const pool = new pg.Pool({ connectionString, max: 4 });
  return {
    async products(query) {
      const values: unknown[] = [];
      const filters: string[] = [];
      if (query.q) {
        values.push(`%${query.q}%`);
        filters.push(`LOWER(p.representative_name) LIKE LOWER($${values.length})`);
      }
      if (query.categoryId) {
        values.push(query.categoryId);
        filters.push(`p.category_id = $${values.length}`);
      }
      const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
      const count = await pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM products p ${where}`,
        values,
      );
      const offset = (query.page - 1) * query.pageSize;
      const resultValues = [...values, query.pageSize, offset];
      const result = await pool.query<Product>(
        `SELECT p.product_id AS "productId", p.category_id AS "categoryId",
           p.representative_name AS name,
           COALESCE(l.specification, 'Pack size unavailable') AS "packSize",
           p.image_url AS "imageUrl"
         FROM products p
         LEFT JOIN LATERAL (
           SELECT specification FROM listings
           WHERE product_id = p.product_id ORDER BY listing_id LIMIT 1
         ) l ON true
         ${where} ORDER BY p.product_id
         LIMIT $${resultValues.length - 1} OFFSET $${resultValues.length}`,
        resultValues,
      );
      return { products: result.rows, total: Number(count.rows[0]?.total ?? 0) };
    },
    async offers(productId, quantity) {
      const product = await pool.query<Product>(
        `SELECT p.product_id AS "productId", p.category_id AS "categoryId",
           p.representative_name AS name,
           COALESCE(l.specification, 'Pack size unavailable') AS "packSize",
           p.image_url AS "imageUrl"
         FROM products p
         LEFT JOIN LATERAL (
           SELECT specification FROM listings
           WHERE product_id = p.product_id ORDER BY listing_id LIMIT 1
         ) l ON true WHERE p.product_id = $1`,
        [productId],
      );
      if (!product.rows[0]) return null;
      const listings = await pool.query<{
        retailerId: Product["productId"];
        listingId: string;
        productUrl: string;
        priceKind: "ordinary" | "unconditional_sale";
        unitPriceCents: number;
        excludedPromotions: string[];
      }>(`SELECT retailer_id AS "retailerId", listing_id AS "listingId",
           product_url AS "productUrl", price_kind AS "priceKind",
           unit_price_cents AS "unitPriceCents", excluded_promotions AS "excludedPromotions"
         FROM listings WHERE product_id = $1 ORDER BY unit_price_cents, retailer_id`, [productId]);
      return {
        product: product.rows[0],
        quantity,
        offers: listings.rows.map((offer) => priceOffer({
          ...offer,
          retailerId: offer.retailerId as "redmart" | "fairprice" | "cold-storage",
          itemCharges: [],
          lineTotalCents: offer.unitPriceCents,
        }, quantity)),
      };
    },
    async close() {
      await pool.end();
    },
  };
}

