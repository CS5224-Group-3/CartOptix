import {
  CatalogueResponseSchema,
  OffersResponseSchema,
  ProductsResponseSchema,
  routes,
} from "@cartoptix/contracts";
import { Value } from "typebox/value";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../src/database.ts";
import { runMigrations } from "../../src/db/migrate.ts";
import { importSeed } from "../../src/seed/import.ts";
import { buildServer } from "../../src/server.ts";
import {
  committedSeedBytes,
  connectionString,
  createThrowawayDatabase,
  type ThrowawayDatabase,
} from "../support/database.ts";

describe.skipIf(connectionString === undefined)(
  "catalogue and products on the committed seed",
  () => {
    let throwaway: ThrowawayDatabase;
    let database: Database;
    let server: ReturnType<typeof buildServer>;

    beforeAll(async () => {
      throwaway = await createThrowawayDatabase("cartoptix_catalogue_products");
      await runMigrations(throwaway.client);
      expect(await importSeed(throwaway.client, committedSeedBytes)).toEqual({
        status: "imported",
      });
      database = createDatabase(throwaway.url);
      server = buildServer({ database });
    });

    afterAll(async () => {
      await server?.close();
      await throwaway?.drop();
    });

    it("returns the seeded catalogue", async () => {
      const response = await server.inject({ method: "GET", url: routes.catalogue.url });

      expect(response.statusCode).toBe(200);
      expect(Value.Check(CatalogueResponseSchema, response.json())).toBe(true);
      expect(response.json().retailers).toHaveLength(3);
      expect(response.json().categories).toHaveLength(8);
    });

    it("searches and paginates seeded products", async () => {
      const search = await server.inject({
        method: "GET",
        url: `${routes.products.url}?q=1%20kg&page=1&pageSize=10`,
      });
      const page = await server.inject({
        method: "GET",
        url: `${routes.products.url}?page=2&pageSize=10`,
      });
      const firstPage = await server.inject({
        method: "GET",
        url: `${routes.products.url}?page=1&pageSize=10`,
      });
      const repeatedPage = await server.inject({
        method: "GET",
        url: `${routes.products.url}?page=2&pageSize=10`,
      });

      expect(search.statusCode).toBe(200);
      expect(Value.Check(ProductsResponseSchema, search.json())).toBe(true);
      expect(search.json().products.length).toBeGreaterThan(0);
      expect(
        search
          .json()
          .products.some((product: { packSize: string }) => /kg/i.test(product.packSize)),
      ).toBe(true);
      expect(page.statusCode).toBe(200);
      expect(Value.Check(ProductsResponseSchema, page.json())).toBe(true);
      expect(page.json().products.length).toBeGreaterThan(0);
      expect(firstPage.statusCode).toBe(200);
      expect(repeatedPage.statusCode).toBe(200);
      expect(firstPage.json().total).toBe(page.json().total);
      expect(page.json().total).toBe(repeatedPage.json().total);

      const firstPageIds = firstPage
        .json()
        .products.map((product: { productId: string }) => product.productId);
      const pageIds = page
        .json()
        .products.map((product: { productId: string }) => product.productId);
      expect(new Set(firstPageIds).size).toBe(firstPageIds.length);
      expect(new Set(pageIds).size).toBe(pageIds.length);
      expect(pageIds.filter((productId) => firstPageIds.includes(productId))).toEqual([]);
      expect(
        repeatedPage.json().products.map((product: { productId: string }) => product.productId),
      ).toEqual(pageIds);

      const wildcard = await server.inject({
        method: "GET",
        url: `${routes.products.url}?q=%25&page=1&pageSize=10`,
      });
      expect(wildcard.statusCode).toBe(200);
      expect(wildcard.json().total).toBeGreaterThan(0);
      expect(
        wildcard.json().products.every((product: { name: string }) => product.name.includes("%")),
      ).toBe(true);
    });

    it("returns an empty page, not an error, past the last page", async () => {
      const beyond = await server.inject({
        method: "GET",
        url: `${routes.products.url}?page=100&pageSize=100`,
      });
      // (page - 1) * pageSize would overflow PostgreSQL's bigint OFFSET.
      const huge = await server.inject({
        method: "GET",
        url: `${routes.products.url}?page=100000000000000000&pageSize=100`,
      });

      for (const response of [beyond, huge]) {
        expect(response.statusCode).toBe(200);
        expect(Value.Check(ProductsResponseSchema, response.json())).toBe(true);
        expect(response.json().products).toEqual([]);
        expect(response.json().total).toBeGreaterThan(0);
      }
    });

    it("returns quantity-aware offers for a seeded product", async () => {
      const response = await server.inject({
        method: "GET",
        url: `${routes.offers.url.replace(":id", "songhe-glutinous-rice-1kg")}?quantity=2`,
      });

      expect(response.statusCode).toBe(200);
      expect(Value.Check(OffersResponseSchema, response.json())).toBe(true);
      expect(response.json().product.productId).toBe("songhe-glutinous-rice-1kg");
      expect(response.json().offers.length).toBeGreaterThan(0);
      for (const offer of response.json().offers) {
        const addedCharges = offer.itemCharges
          .filter((charge: { includedInPrice: boolean }) => !charge.includedInPrice)
          .reduce(
            (total: number, charge: { amountCents: number }) => total + charge.amountCents,
            0,
          );
        expect(offer.lineTotalCents).toBe(offer.unitPriceCents * 2 + addedCharges);
      }
    });

    it("keeps a product with no listing visible and unavailable", async () => {
      await throwaway.client.query(
        `INSERT INTO products (product_id, category_id, representative_name, image_url)
       VALUES ('unlisted-test-product', 'drinks', 'Unlisted test product', NULL)`,
      );

      const response = await server.inject({
        method: "GET",
        url: `${routes.products.url}?q=unlisted%20test%20product&page=1&pageSize=10`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().products).toContainEqual({
        productId: "unlisted-test-product",
        categoryId: "drinks",
        name: "Unlisted test product",
        packSize: "Pack size unavailable",
        available: false,
        imageUrl: null,
      });
    });

    it("reports conflicting pack specifications as unavailable", async () => {
      await throwaway.client.query(
        `INSERT INTO products (product_id, category_id, representative_name, image_url)
       VALUES ('conflicting-pack-test-product', 'drinks', 'Conflicting pack test product', NULL)`,
      );
      await throwaway.client.query(
        `INSERT INTO listings
        (listing_id, product_id, retailer_id, source_record_id, name, specification,
         product_url, price_kind, unit_price_cents, excluded_promotions)
       VALUES
        ('conflicting-pack-redmart', 'conflicting-pack-test-product', 'redmart',
         'redmart_conflicting_pack', 'Conflicting pack test product', '6 x 250ml',
         'https://www.lazada.sg/products/conflicting-pack-redmart', 'ordinary', 100, '{}'),
        ('conflicting-pack-fairprice', 'conflicting-pack-test-product', 'fairprice',
         'fairprice_conflicting_pack', 'Conflicting pack test product', '6 x 330ml',
         'https://www.fairprice.com.sg/product/conflicting-pack-fairprice', 'ordinary', 110, '{}')`,
      );

      const response = await server.inject({
        method: "GET",
        url: `${routes.products.url}?q=conflicting%20pack%20test%20product&page=1&pageSize=10`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().products).toContainEqual({
        productId: "conflicting-pack-test-product",
        categoryId: "drinks",
        name: "Conflicting pack test product",
        packSize: "Pack size unavailable",
        available: true,
        imageUrl: null,
      });
    });
  },
);
