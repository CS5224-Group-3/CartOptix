/**
 * Validates a parsed seed before anything touches the database.
 *
 * Returns every problem at once, so a curator can fix a seed in one pass. The
 * database constraints repeat the essential rules as a second line of defence.
 */
import { Value } from "typebox/value";
import { type Seed, SeedSchema } from "./schema.ts";

export type SeedValidation = { ok: true; seed: Seed } | { ok: false; errors: string[] };

const RETAILERS = ["redmart", "fairprice", "cold-storage"] as const;
/** Largest amount a PostgreSQL `integer` column holds. */
const MAX_DB_CENTS = 2_147_483_647;

function normalizeSpecification(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/\s+/g, "")
    .replace(/×/g, "x")
    .replace(/(\d+(?:\.\d+)?)kg/g, (_, amount: string) => `${Number(amount) * 1000}g`)
    .replace(/(\d+(?:\.\d+)?)l/g, (_, amount: string) => `${Number(amount) * 1000}ml`);
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

export function validateSeed(input: unknown): SeedValidation {
  if (!Value.Check(SeedSchema, input)) {
    const errors = [...Value.Errors(SeedSchema, input)]
      .slice(0, 50)
      .map((error) => `${error.instancePath || "/"} ${error.message}`);
    return { ok: false, errors };
  }
  const seed = input;
  const errors: string[] = [];
  const report = (kind: string, ids: string[]) => {
    for (const id of ids) errors.push(`Duplicate ${kind}: ${id}`);
  };

  const retailerIds = seed.retailers.map((retailer) => retailer.retailerId);
  report("retailer", duplicates(retailerIds));
  for (const retailerId of RETAILERS) {
    if (!retailerIds.includes(retailerId)) errors.push(`Missing retailer: ${retailerId}`);
    const rules = seed.delivery.rules.filter((rule) => rule.retailerId === retailerId);
    if (rules.length !== 1) {
      errors.push(`Retailer ${retailerId} needs exactly one delivery rule, found ${rules.length}`);
    }
  }
  for (const rule of seed.delivery.rules) {
    if (rule.status === "verified" && rule.note.trim().length === 0) {
      errors.push(`Verified delivery rule for ${rule.retailerId} needs a non-empty note`);
    }
  }

  const categoryIds = new Set(seed.categories.map((category) => category.categoryId));
  report("category", duplicates(seed.categories.map((category) => category.categoryId)));

  const productIds = new Set<string>();
  report("product", duplicates(seed.products.map((product) => product.productId)));
  for (const product of seed.products) {
    productIds.add(product.productId);
    if (!categoryIds.has(product.categoryId)) {
      errors.push(`Product ${product.productId} has unknown category ${product.categoryId}`);
    }
  }

  report("listing", duplicates(seed.listings.map((listing) => listing.listingId)));
  report(
    "product listing at one retailer",
    duplicates(seed.listings.map((listing) => `${listing.productId} at ${listing.retailerId}`)),
  );

  const hosts = new Map(
    seed.retailers.map((retailer) => [retailer.retailerId, retailer.productUrlHosts]),
  );
  for (const listing of seed.listings) {
    if (!productIds.has(listing.productId)) {
      errors.push(`Listing ${listing.listingId} has unknown product ${listing.productId}`);
    }
    // The importer is where a bad link is stopped: the API does not validate most responses.
    const host = new URL(listing.productUrl).host;
    if (!hosts.get(listing.retailerId)?.includes(host)) {
      errors.push(
        `Listing ${listing.listingId} links to ${host}, not an allowed ${listing.retailerId} host`,
      );
    }
    if (listing.unitPriceCents > MAX_DB_CENTS) {
      errors.push(`Listing ${listing.listingId} has an implausible price`);
    }
    if (listing.priceKind === "unconditional_sale") {
      if (listing.originalPriceCents === null || listing.originalPriceCents > MAX_DB_CENTS) {
        errors.push(`Sale listing ${listing.listingId} needs a plausible original price`);
      } else if (listing.originalPriceCents <= listing.unitPriceCents) {
        errors.push(
          `Sale listing ${listing.listingId} has an original price no higher than its price`,
        );
      }
    } else if (listing.originalPriceCents !== null) {
      errors.push(`Ordinary listing ${listing.listingId} cannot have an original price`);
    }
    if (listing.multibuy !== null) {
      if (listing.priceKind === "unconditional_sale") {
        errors.push(`Sale listing ${listing.listingId} cannot also have a multibuy`);
      }
      if (
        listing.multibuy.dealPriceCents >=
        listing.unitPriceCents * listing.multibuy.packsPerDeal
      ) {
        errors.push(`Listing ${listing.listingId} has a multibuy that is not cheaper`);
      }
    }
  }
  for (const productId of productIds) {
    const specifications = seed.listings
      .filter((listing) => listing.productId === productId)
      .map((listing) => normalizeSpecification(listing.specification));
    if (new Set(specifications).size > 1)
      errors.push(`Product ${productId} has conflicting pack specifications`);
  }

  return errors.length === 0 ? { ok: true, seed } : { ok: false, errors };
}
