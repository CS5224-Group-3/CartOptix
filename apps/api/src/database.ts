// Manages the PostgreSQL connection pool, the readiness check and reads for comparison.
import type {
  CatalogueResponse,
  DependencyCheck,
  OffersResponse,
  Product,
} from "@cartoptix/contracts";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createDatabaseCatalogueStore } from "./catalogue/store.ts";
import { type BasketData, loadBasketData } from "./comparison/store.ts";
import { createDatabaseProductsStore, type ProductSearchQuery } from "./products/store.ts";

export interface Database {
  checkConnection(): Promise<DependencyCheck>;
  loadBasket(productIds: readonly string[]): Promise<BasketData>;
  loadCatalogue(): Promise<CatalogueResponse>;
  loadProducts(query: ProductSearchQuery): Promise<{ products: Product[]; total: number }>;
  loadOffers(productId: string, quantity: number): Promise<OffersResponse | null>;
  close(): Promise<void>;
}

export function createDatabase(connectionString: string): Database {
  const pool = new pg.Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 2000,
  });

  // PostgreSQL can close an idle pooled connection at any time, for example on a
  // restart. pg then emits "error" on the pool, and with no listener Node exits.
  // The pool has already discarded that client, so log and carry on; readiness
  // reports any lasting outage on its next query.
  pool.on("error", (error) => {
    console.error("Idle PostgreSQL connection failed:", error.message);
  });

  const db = drizzle(pool);
  const catalogueStore = createDatabaseCatalogueStore(db);
  const productsStore = createDatabaseProductsStore(db);

  return {
    async checkConnection(): Promise<DependencyCheck> {
      try {
        await pool.query("SELECT 1");
        return { status: "ok" };
      } catch (error) {
        return unavailable(error);
      }
    },
    loadBasket: (productIds) => loadBasketData(db, productIds),
    loadCatalogue: () => catalogueStore.catalogue(),
    loadProducts: (query) => productsStore.products(query),
    loadOffers: (productId, quantity) => productsStore.offers(productId, quantity),
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

function unavailable(error: unknown): DependencyCheck {
  return {
    status: "unavailable",
    detail: error instanceof Error ? error.message : "Unknown database error",
  };
}
