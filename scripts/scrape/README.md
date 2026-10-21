# Retailer scrapers and snapshot refresh

These scripts take a new snapshot of the published catalogue and rebuild the seed from it. An engineer runs them by hand; the app never contacts a retailer, and there is no schedule. Each refresh replaces the previous snapshot entirely and remains a fixed dataset until the next one (PR-06).

## Prerequisites

- Node.js 24 and `pnpm install` (the RedMart scraper uses the Playwright Chromium the end-to-end tests install: `pnpm exec playwright install chromium`).
- Python 3.12 or later. The refresh builder needs only the standard library.

## Steps

Run everything from the repository root.

0. **Start a snapshot.** Removes the previous snapshot's files from `data/snapshot`, so nothing from it can be built into the new seed.

   ```sh
   node scripts/scrape/refresh.ts new
   ```

1. **Read every catalogue listing again.** The catalogue is the seed plus the products that dropped out of it (`data/seed/retired.json`), so a product can come back. Writes `data/snapshot/listings-<retailer>.csv`. Name retailers to collect only those, e.g. `… listings redmart`.

   ```sh
   node scripts/scrape/refresh.ts listings
   ```

2. **Search for missing retailers.** For each product, searches every retailer it is not yet listed at, keeps hits that pass the name rules (`match.ts`: same pack size, the brand's word, similar name) and reads their pages. Writes `data/snapshot/candidates-<retailer>.csv`.

   ```sh
   node scripts/scrape/refresh.ts search
   ```

3. **Read RedMart sellers again, if needed.** Lazada's catalogue does not say who sells an item, so the scraper reads each RedMart product page for its "Sold by" line. A page that loads without seller data leaves the seller empty; this reads those pages again and records what it finds in `data/snapshot/seller-checks.csv`:

   ```sh
   node scripts/scrape/refresh.ts sellers --headed
   ```

4. **AI review of the candidates (PR-02).** An AI reviewer judges each candidate against its product with the Stage 2F rubric (same brand, product line, variant, per-pack size and pack count) and records `product_id`, `product url`, `decision` (MATCH, NOT_MATCH or UNSURE), `confidence` (HIGH, MEDIUM or LOW) and `reason` in `data/snapshot/match-decisions.csv`. Only MATCH with HIGH confidence publishes.

5. **Build the seed.** Writes `data/seed/seed.json`, `data/seed/product_ids.csv` and `data/snapshot/report.md`.

   ```sh
   python3 scripts/refresh_seed.py
   pnpm exec biome format --write data/seed
   ```

   If a RedMart seller is still unknown, the build stops with status 2 and lists those pages in `data/snapshot/seller-checks-needed.csv`. Open each one, note the seller ("RedMart" when there is no "Sold by" line), add the rows to `data/snapshot/seller-checks.csv` and run the build again. This is the only manual check.

6. **Check and release.** `pnpm check` runs the seed integration tests and the reference price checker against the new seed. Commit the snapshot files and the seed, release, and re-import the seed (`infra/RUNBOOK.md`).

## Rules

- **Lazada's slider check.** Lazada answers fast or repeated requests with a slider check. The RedMart scraper reads one page per listing through one browser profile (`.cache/lazada-profile`, not committed), at one request every eight seconds, using the installed Google Chrome when there is one. Run RedMart steps with `--headed`: when the check appears, the scraper waits up to ten minutes for you to complete it in the window, then carries on. A headless run stops at the first check rather than retrying. Collecting RedMart takes about an hour.
- **All or nothing, per retailer.** A page is recorded as gone only on positive evidence: a 404 at FairPrice or Cold Storage; FairPrice's empty product detail, or its product page with no product for an old link; or Lazada's "no longer available" page without product data. Any other failure, including a page in an unexpected shape, deletes that retailer's file, so a failed refresh cannot leave an earlier observation to build from. Collect a retailer that failed again the same day: one snapshot covers all three retailers within one short window. A missing file, or a seed listing without a new observation, stops the build.
- **Columns.** Observations keep the source workbooks' columns (`data/raw/README.md`), so `derive_offer_prices.py` applies the same price, sale and multibuy rules, and add `retailer` and `seller`. `Savings` holds every promotion in the retailer's wording, separated by " | ": a multibuy is applied, a sale's plain saving dropped and anything else shown as an excluded promotion. Nothing records when they were collected.
- **Eligibility.** A listing publishes when its page exists, it is in stock, its price is reliable and, at RedMart, RedMart sells it. A product publishes when two or more retailers have an eligible listing. Product IDs, categories and listing IDs stay stable. A product that drops out moves, without prices, to `data/seed/retired.json`; later refreshes read its listings again and bring it back under the same ID once two retailers have it.
- **Pack rules.** A search hit must state the same pack count and per-pack size as the product (2 × 500 g is not 1 kg), and a hit whose title and specification disagree is never matched.
- **Sellers.** The RedMart seller is read from the page data's "Sold by:" entry. With none, a page whose seller module is RedMart's is RedMart's; anything else is left for a hand check.

## How each retailer is read

| Retailer | Product page | Search |
| --- | --- | --- |
| FairPrice | Next.js data (`__NEXT_DATA__`): `mrp` less `discount`, store stock, offers for two or more packs. | `/search?query=` page data. |
| Cold Storage | Server-component data: `price`, `promoPrice`, `inventoryStatus`, `discountLabel`. | `/search?q=` page data. |
| RedMart | Lazada's product page data (`window.__moduleData__`), read with the installed Google Chrome (or Playwright's Chromium): price, crossed-out price, stock, pack size, promotion tags and the "Sold by" seller, in one page per listing. | Lazada's catalogue JSON limited to RedMart (`m=redmart`), searched by name. |

Retailers change their pages. When a scraper breaks, `scrape.test.ts` documents the fields it expects.
