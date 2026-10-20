# CartOptix MVP technical implementation specification

**Status:** Delivery design and issue-ready work plan. Product requirements are agreed; implementation defaults below are proposals to validate during setup, not claims that code or infrastructure already exists.

Read this with the [product specification](product-spec.md), which owns user journeys, product rules (`PR-*`) and success criteria (`SC-*`). Together they supersede `mvp-implementation-plan.md`. The repository currently contains documentation, not a completed application. This document defines future tasks; it does not create GitHub issues or assign owners.

## 1. Design decisions and implementation defaults

### Agreed design decisions

- Fixed, curated data for RedMart, FairPrice and Cold Storage; exact product matching and direct supermarket fulfilment only.
- Integer-cent pricing shared by product comparison, basket comparison and result validation.
- Complete-basket comparison at each of the three retailers, with at most 50 distinct lines and 1–20 whole packs per line; no substitutions or divided lines.
- Exact comparison of all feasible single-retailer options, recommending the cheapest with a stable tie-break.
- Version-controlled clean seed data, no website collection dates, and a visible fixed-dataset disclaimer.
- Two AWS deployment profiles: single-node development and a short-lived ALB/ASG/RDS presentation deployment.
- Automatic scaling and application-instance failure demonstrations; endpoint-RPS load tests.

### Proposed implementation defaults

Retain compatible choices from the previous plan to avoid unnecessary redesign. Validate versions, ARM64 support and operational cost before committing dependencies.

| Area | Default |
| --- | --- |
| Repository | TypeScript pnpm workspace: `apps/web`, `apps/api`, `packages/contracts`, `data/seed`, `infra`, `tests`, `scripts`. |
| Web | React, Vite, React Router, TanStack Query; browser tab-session basket storage; no account system. |
| API | Node.js 24 LTS and Fastify; TypeBox contracts and generated OpenAPI. |
| Persistence | PostgreSQL, Drizzle ORM with drizzle-kit migrations, and bounded `node-postgres` pools. |
| Comparison | Pure TypeScript shared pricing and comparison modules, run in process for all three retailers. |
| Packaging | Immutable ARM64-compatible application container; local containerised PostgreSQL. |
| Infrastructure | Development profile: a hand-provisioned EC2 host running Docker Compose (`deploy/development`). Presentation profile: AWS CDK in TypeScript (`infra/`), deployed and destroyed from an engineer's machine. |
| Delivery | GitHub Actions checks, and publication of commit-tagged arm64 images to ECR from `main`. The development host is updated by hand from those images (E3); the presentation stack is deployed from an engineer's machine and its migrations and seed import are run by hand (E4). OIDC is optional for the POC; credentials are never committed. |
| Verification | Vitest, API/PostgreSQL integration tests, Playwright journeys and an arrival-rate load tool such as k6. |

Specific package versions, frontend styling, instance sizes for the ASG, origin networking and scaling thresholds are engineering choices to validate in the tasks below. They must satisfy the product contract, including the two-second basket target.

### Adopted and validated in the workspace foundation

These versions were installed, built, tested and run on `arm64` during the workspace foundation task. Later tasks may upgrade them; record the reason when they do.

| Tool | Adopted | Note |
| --- | --- | --- |
| Node.js | 24 (major pinned in `.nvmrc`) | Latest LTS line; minor and patch float during pre-production |
| pnpm | 12.5.1 via Corepack | Pinned in `packageManager`, so only Node must be installed |
| TypeScript | 7.0.2 | Builds all three packages through project references |
| Biome | 2.5.14 | Formatting and linting for JS/TS/JSON; Markdown is not formatted. `nursery/noMisusedPromises` is off because its type inference overflows the stack on TypeBox types (biomejs/biome#10277). The npm wrapper is patched (`patches/`) so a crash fails the run; unpatched, it exits 0 and a partial check passes. When upgrading Biome, redo the patch or drop it if the wrapper is fixed. |
| Fastify | 5.12.5 | API |
| React and Vite | React 19.2.0, Vite 8.3.0, `@vitejs/plugin-react` 6.1.1 | Plugin 5.x does not support Vite 8 |
| `pg` | 8.23.0 | Driver for readiness, migrations and seed import |
| Drizzle | `drizzle-orm` 0.45.3, `drizzle-kit` 0.31.11 | Schema in `apps/api/src/db/schema.ts`; generated SQL migrations in `apps/api/migrations` |
| Vitest | 5.0.1 | Playwright is deferred until there are journeys to exercise |
| PostgreSQL | `18-alpine` locally (18.6), matching RDS 18.6 in `ap-southeast-1` | Alpine keeps the local image lean (~264 MB vs ~458 MB for the Debian-based tag); PostgreSQL 18 expects a single mount at `/var/lib/postgresql` |
| AWS CDK | `aws-cdk-lib` 2.273.0, `aws-cdk` CLI 2.1145.0, `constructs` 10.8.1 | Presentation stack in `infra/` (E4). Synthesised by `pnpm check` without AWS credentials, so it must not use context lookups; not yet deployed |

**Rejected: ESLint with `typescript-eslint`.** `typescript-eslint@8.70.0` declares `typescript >=4.8.4 <6.1.0` and therefore cannot lint a TypeScript 7 codebase. Biome carries its own parser, so it imposes no such constraint. Type-aware lint rules are the cost; `tsc --noEmit` still provides type checking. Revisit only if a needed rule cannot be expressed in Biome.

**Contracts (A2 / #5):** `typebox` 1.3.34 defines the shared schemas, with types inferred from them. It is the 1.x line that `@fastify/type-provider-typebox` 6 requires; the older `@sinclair/typebox` 0.34 line was dropped. Tests check that Fastify 5's default validator and serialiser accept the schemas. Generated OpenAPI was evaluated and deferred: both sides share TypeScript types directly, so nothing reads it. Add `@fastify/swagger` if an external consumer appears.

**Seed import (B4 / #4):** the database holds the one committed seed. An import validates the seed, then replaces every row in one transaction; rolling back means re-importing an older seed from Git. The schema keeps keys, references and uniqueness, and the importer's validation enforces value rules.

**Deferred:** React Router, generated OpenAPI and k6 remain proposals. Each belongs to the task that first needs it, so the foundation stays free of dependencies nothing yet uses.

## 2. Application architecture

### Runtime boundaries

Use one backend application with catalogue, pricing, comparison, import and click-event modules. Keep API instances stateless: basket requests contain product IDs and quantities, and the server prices them from the loaded seed. Do not rely on instance memory or local files for persistent user state.

```text
Development POC
Browser -> EC2 t4g.micro [web/API + PostgreSQL on persistent storage]

Presentation
Browser -HTTPS-> CloudFront (*.cloudfront.net)
                  ├─ default -> private S3 bucket (frontend build)
                  └─ /api/*  -> VPC origin -> internal ALB -> EC2 Auto Scaling Group -> private RDS PostgreSQL
                                                             min 2 (1 while building), max 3   db.t4g.micro, Single-AZ

Offline data preparation -> validated committed seed -> explicit database import
```

The presentation frontend is served from S3 through CloudFront, and the API from the ASG. One origin for both means the browser makes no cross-origin requests, so production needs no CORS handling. ALB routes requests; ASG policies change instance count. RDS remains a single database failure point: surviving an application-instance failure does not demonstrate database failover.

**Baseline capacity.** The evaluation and presentation window, and every result reported from it, run two baseline instances (minimum and desired 2, maximum 3). The minimum is set at deploy time, so moving between configurations needs no code change.

**Technical debt: one baseline instance while building.** For cost, the stack runs one instance (minimum and desired 1, maximum 3) while it is being built and tested. Until it scales out, the application is then also a single point of failure: if that instance fails, the API is unavailable until the ASG launches and health-checks a replacement, which takes minutes. The static frontend stays up because CloudFront serves it from S3. A production deployment would keep the minimum at 2.

Serve browser traffic over HTTPS. The CloudFront-to-ALB connection uses HTTP inside AWS's network, because there is no custom domain to certify the ALB; this is a recorded limitation. Keep any S3 bucket private, restrict application ingress to its intended proxy/load balancer, and restrict database ingress to application instances. Avoid publicly exposed PostgreSQL in both profiles.

Presentation networking is chosen for cost: the ALB is internal and reached through a CloudFront VPC origin, which has no extra charge and needs no public IPv4 for the ALB. There is no NAT gateway and no interface endpoint; application instances reach ECR and Systems Manager through their own public IPv4 addresses, and accept traffic only from the ALB.

Instance health is separate from database health. The ALB and ASG judge instances by liveness (`/health/live`), so a database outage does not drain or replace them; instances stay in service and return `ErrorResponse`. Readiness (`/health/ready`) reports the database and may gate a new release's rollout.

Instances boot from the stock Amazon Linux 2023 arm64 image and install Docker at boot. On a `t4g.micro` that install has taken up to six minutes, so a new instance can take several minutes to serve traffic; scale-out observations (F3) include this delay. The ECS-optimised AMI, which ships with Docker, is the fallback if it matters.

### Import and serving separation

Retailer websites are not runtime dependencies. Import validated seed data through an internal CLI or deployment task, not a public upload endpoint. A live retailer outage does not affect snapshot calculations; relevant serving failures are missing eligible records, invalid imports, database unavailability and application failures.

Imports must be atomic and idempotent. Replace the loaded data only after validation and loading succeed, in one transaction. Each request reads the data, including delivery rules, from one consistent database snapshot, so an import during a request cannot mix old and new rows. The browser basket holds only product IDs and quantities, and the server prices every line itself, so there is no stale client pricing to detect. A product removed by a correction is rejected as unknown. Evaluation data stays frozen on a best-effort basis (section 3).

## 3. Data design and curation

### Source evidence

Source folder: [CartOptix retailer exports](https://drive.google.com/drive/folders/1qc-q8jvodbYKcvYxTux3aqJzMn4xxOO1).

| Source file | Rows | Source stock `No` | Blank specifications | Blank brands |
| --- | ---: | ---: | ---: | ---: |
| `coldstorage_all_products_final.xlsx` | 10,457 | 1,403 | 0 | 0 (224 contain `*`) |
| `fairprice_all_products_final.xlsx` | 69,402 | 4,878 | 234 | 1,063 |
| `redmart_all_products_final.xlsx` | 97,779 | 24,804 | 6,681 | 5,116 |

These are profiling results for the supplied files, not verified product counts or cross-retailer matches. All rows have names, prices, product URLs and Yes/No stock flags. No explicit collection-date, seller, delivery-rule or canonical-product-ID fields were found. `Savings` contains free-text offers; `offer` is a flag. `Brand`/`brand` casing varies, and empty `other comments` columns add no evidence.

Known examples requiring validation:

- FairPrice has two zero-priced records, both marked out of stock; reject zero prices as ordinary purchasable offers.
- RedMart has floating-point representations such as `19.899999999999999`; normalise numerical artefacts to cents without accepting arbitrary ambiguous prices.
- RedMart's “Sainsbury's Creme Brulee 2X90G” has a `2 × 180 g` specification.
- Cold Storage's strawberry almond milk title states `3 x 180ml`, while its specification says `180ml`.
- Matching “AAA Artificial Vinegar” names appear with 5 L and 640 ml specifications.
- Some FairPrice names contain `[BCRS]`; the files do not establish deposit inclusion. The MVP does not model BCRS deposits (PR-04), so these listings stay eligible.

Do not infer seller eligibility, collection dates or canonical identity from these files alone. Titles, URLs and category labels can supply clues but are not sufficient verification.

### Curation pipeline

1. Keep the original exports unchanged outside the clean seed, and give each listing a stable source reference (`source_record_id`).
2. Normalise field names, money, units, pack counts and stable retailer listing identifiers.
3. Restrict candidates to the eight product categories. Treat `Keyword` as source discovery metadata, not the canonical category taxonomy.
4. Exclude source stock `No`, unverifiable prices, listings the evidence shows are third-party fulfilled, and unresolved mandatory charges. Listings count as directly fulfilled otherwise (PR-02).
5. Propose matches, which may use AI. Publish only high-confidence AI matches that agree with the name rules and exclude the rest; manual match review is out of scope for the proof of concept.
6. Verify one delivery scenario per retailer. Publish verified ordinary and unconditional sale prices and same-product multibuys (PR-03), recording other promotions as excluded; do not infer unsupported rules.
7. Publish clean, schema-validated seed data with a coverage report and exclusions. Target 200–300 products, with at least 70% having eligible offers from two or more retailers; reduce size before weakening evidence requirements. Compute coverage as qualifying canonical products divided by all published canonical products, not raw listings.

Start with a small curation pilot (proposed size: about 30 canonical products spread across the categories) before expanding, published in the final seed format and importable with the real migrations so the catalogue and comparison APIs can integrate early. This is an implementation checkpoint, not a claim that such a sample has already been approved or created. Report curation quality; automated precision/recall claims require an actual matcher and independent labels, not rechecking the same manually constructed answers.

### Logical data model

| Entity | Key information |
| --- | --- |
| Retailer | Stable ID, name and allowed product-link domains. |
| Canonical product | ID, category, brand, variant, pack count, per-pack size/unit or equivalent non-food identity, display name. |
| Listing | Retailer ID, source listing/SKU ID, canonical ID, product/image URLs, direct-fulfilment status and any evidence reference. |
| Offer | Listing ID, price in cents, optional descriptive original price, source stock flag, eligibility and exclusion reason, price/charge inclusion evidence. |
| Supported promotion | A listing's same-product multibuy: packs per deal, deal price in cents (any percentage already rounded half-up by curation) and whether the retailer's wording was "Any N". Deals repeat; remaining packs use the unit price. No validity terms are kept. Rules are fixed in the committed seed. |
| Delivery rule | Retailer, declared location/service, explicit non-member eligibility, fee, free-delivery threshold, minimum-order constraint, spending bases, fixed charges and verification evidence. |
| Mandatory item charge | Verified amount/basis, inclusion in the source price and threshold treatment; supports deposits without double-counting. Unused in the MVP, which does not model BCRS deposits. |
| Click event | Event ID, retailer/listing/product and the server-recorded timestamp; no user identity. |

Retain a clean JSON seed and its validation schema in Git (`data/seed/`; schema in `apps/api/src/seed/schema.ts`). Protect referential integrity, positive usable prices, valid quantities, unique stable IDs and consistent pack information. Different listings with similar names are not automatically duplicates. Do not deploy all 177,638 raw rows merely because they were scraped.

Freezing evaluation data is best-effort; record material changes and rerun affected checks where practical. Do not build a collection-date display or invent dates from workbook metadata.

## 4. Pricing and comparison design

### Shared pricing kernel

One deterministic module calculates product-line costs and retailer-order totals. Use integer SGD cents and parse import values with decimal-aware logic. Multibuys are calculated as whole deals plus remainder packs without dividing the deal price into fractional cents. Percentage deals are rounded once, half-up to the cent per deal, when curation builds the seed, so the module never rounds; the live-checkout evidence for PR-03 confirms the convention, and a deal type that disagrees stays excluded.

- Compute the verified ordinary or unconditional sale cost for the exact pack quantity.
- Apply a listing's same-product multibuy: floor(quantity ÷ packs per deal) deals, the rest at the unit price, and only when the deal is cheaper. Never count packs from another line, and never stack promotions.
- Treat original prices and raw savings text as descriptive evidence, not automatic extra discounts.
- Apply verified mandatory item charges, retailer minimum orders, delivery fees and threshold spending bases.
- Return an itemised explanation and excluded-promotion notices, not just a scalar total.

Unknown necessary delivery rules prevent a valid complete-total calculation for that retailer. Do not substitute zero. An unsupported promotion can be ignored only when a verified usable price remains and the omission is disclosed.

Promotion eligibility comes from the committed seed, not the runtime clock. There is no date handling: curation strips validity wording, and advancing the current date never expires or activates a promotion. Keep unsupported rules out of the active seed and disclose them as excluded promotions.

### Comparison procedure

1. Validate input, rejecting duplicate product IDs as the contract requires (section 5).
2. Read the seed data from one consistent snapshot and price the complete basket independently at each of the three retailers through the shared pricing module.
3. For each retailer, require eligible offers for every line, a verified delivery rule and an order that meets its minimum. Otherwise mark that option unavailable with its reason; do not price a partial basket as complete.
4. Validate each feasible option and its itemised product costs, supported promotions, excluded-promotion notices, delivery and other mandatory order charges, and estimated total.
5. Recommend the cheapest feasible option, breaking ties by retailer ID in code-point order. Return every retailer's option, including unavailability reasons.

All three options are computed exactly; there is no search budget or optimality caveat. Keep end-to-end basket comparison p99 below two seconds at the declared loads. An internal failure is an operational error, not an unavailable retailer option.

### Result semantics

| Outcome | Meaning |
| --- | --- |
| Feasible options | Return each retailer's complete-basket option or unavailability reason, and recommend the cheapest feasible option using the documented tie-break. |
| No feasible plan | Show “No feasible purchasing plan available” with each retailer's reason; the shopper changes the basket themselves. |
| Operational error | Internal or database failure uses a distinct retryable service-error response rather than a business outcome. Invalid shopper input is rejected separately. |

Never return a partial basket as a complete result or compare its price with complete options. Report unavailable options and no-feasible-plan rates separately from operational failures.

## 5. API and interface contracts

`packages/contracts` defines the first four endpoints below as schemas with inferred types and `routes` for Fastify registration. Synthetic fixtures for each outcome are exported from `@cartoptix/contracts/fixtures`. Handlers belong to their implementation issues. The outbound-click contract belongs to #19, and health responses stay as they are until #13.

| Endpoint | Responsibility |
| --- | --- |
| `GET /api/v1/catalogue` | Retailers, categories and each retailer's delivery rule. No collection-date display field. |
| `GET /api/v1/products` | Paginated search/category browse of published products. |
| `GET /api/v1/products/:id/offers?quantity=...` | Quantity-aware eligible offers and shared pricing explanations. |
| `POST /api/v1/basket/compare` | Basket lines; complete or unavailable options for all three retailers, itemised breakdowns, a cheapest feasible recommendation or no feasible plan. |
| `POST /api/v1/events/outbound-click` | Best-effort usage event for a known listing. |
| `GET /health/live`, `GET /health/ready` | Process health; database readiness. Not substitutes for measured shopper API success. |

Schemas must validate IDs and integer quantities. Client-submitted prices are never trusted. Product links come from approved listing records; avoid an arbitrary redirect service.

Contract decisions (#5):

- **Money and limits.** Integer SGD cents; 1–50 distinct lines and 1–20 whole packs per line.
- **Seed data.** The database holds the one committed seed, which evolves in Git; Git history is its version record. There are no dataset IDs or versions: neither requests nor responses identify a seed, and a correction is an edit to the seed file.
- **Catalogue search.** Product search is case- and whitespace-insensitive substring matching across the shopper-facing product name (including brand and variant, without the `[BCRS]` marker) and the pack-size text of the product's listings. `%`, `_`, and `\` are ordinary search characters, not wildcards. Empty results are successful responses; database or seed failures are service errors.
- **Duplicate lines.** A product listed twice returns 400 rather than being merged.
- **Comparison results.** The request carries only basket lines. The response is either `recommended`, with the recommended retailer, or `no_feasible_plan`. Both return an option for each retailer: a priced complete basket with an itemised breakdown, or unavailable with its reasons (missing products, below the minimum order, or an unverified delivery rule). Complete options come first, cheapest first, then unavailable ones, so a recommendation is always the first option. Ties, and the order of unavailable options, follow retailer ID in code-point order. Other feasible options may show the difference from the recommendation.
- **Errors.** One body shape, `{ error: { code, message } }`, with codes only where the client acts differently: `invalid_request`, `not_found` and `service_error`. 4xx or 5xx decides whether to offer a retry. The API's error handler maps Fastify validation errors to this shape.
- **Pricing on the wire.** Ordinary and unconditional sale prices, and same-product multibuys. Each line carries its listing's deal, or null: packs per deal, deal price, whether the retailer's wording was "Any N", how many deals the line applied and the saving against the unit price. The deal is present even when the line is too small to qualify, so the client can say what it needs. Mandatory charges are itemised. An unconditional sale also carries its original price (`originalPriceCents`, null for ordinary prices) so the client can show it struck through; it is display only and never enters a total. A line total is the deals at the deal price, the remaining packs at the unit price, plus charges with `includedInPrice: false`; charges already in the price are shown but not added, so nothing is counted twice or dropped. An order charge with a waiver threshold (such as FairPrice's service fee) carries the threshold and whether the order reached it; a waived charge is shown but not added to the total. Prices are positive. An unknown delivery rule is `unavailable`, never a zero fee. BCRS container deposits are not modelled in the MVP: the same 10¢ per container applies at every retailer, so it cannot change which option wins, and the client shows the exported `DEPOSIT_NOTICE` instead. Item charges stay in the contract so deposits can be modelled later. The pricing module's results stay inside `apps/api`; #10 and #13 map them onto these shapes, and the client composes price wording from their structured fields.
- **Pricing outcomes at the boundary.** The pricing module's outcomes reach shoppers as follows:
  - An order below a retailer's minimum makes that retailer's option unavailable, not the basket.
  - An unverified delivery rule makes that retailer's option unavailable rather than failing the request, because a retry cannot fix it and it would count against SC-06.
  - Missing eligible offers make the affected retailer unavailable. An unresolved charge or an ineligible offer incorrectly passed to the pricing module should be stopped by the importer (#4); if it reaches pricing, return `service_error`.
- **Limits.** `MAX_BASKET_LINES` and the per-line pack range are exported constants, so the web client enforces the same bounds as the API.
- **Validation.** Fastify defaults: query strings are coerced, unknown fields stripped, and pagination defaults applied. Responses reject undeclared fields, so a collection date cannot be added by accident. The disclaimer and deposit notice are exported constants (`SNAPSHOT_DISCLAIMER`, `DEPOSIT_NOTICE`), not response fields.
- **Data the seed must supply (#4).** These contracts define what the API needs, and the seed and import supply it, as the A2-before-B2–B4 ordering in section 8 intends. The seed carries whatever curation knows, without pruning, and the API derives display fields when serving. The seed provides at least:
  - The three retailers with display names, and the eight categories with stable IDs and names.
  - Per retailer, either the verified delivery fee, free-delivery threshold and minimum order (each may be absent) with a short note, or an explicit "unverified". Threshold basis and fixed order-level charges remain internal pricing inputs and are not exposed by `DeliveryRuleSchema`.
  - Per product: category, a representative listing name, listing specifications and an optional image URL. The API derives `name` from the representative name, removing any `[BCRS]` tag, and `packSize` from normalized eligible listing specifications, with units lower-cased. Unresolved specification conflicts are rejected during seed import; a product with no listing is accepted. Products without an eligible listing remain browseable with `available: false` and cannot be added to a basket. Separate canonical pack count/size/unit fields remain future work.
  - Per eligible offer, meaning in stock and directly fulfilled: retailer, product, approved product URL, price kind (ordinary or unconditional sale), a positive unit price in integer cents, for a sale its higher original price in integer cents, any approved same-product multibuy, and excluded promotions as the retailer worded them. Mandatory item charges, with a label, per-pack amount and whether the price already includes them, are needed only once a charge is modelled; the MVP has none, since BCRS deposits are not modelled.
  - Fixed order-level charges per retailer, and whatever rule inputs the pricing module (#8) needs to compute totals.
  - Product, listing and category IDs as opaque strings of 1–128 URL-safe characters (letters, digits, `.`, `_`, `~` and `-`, starting with a letter or digit), since product IDs appear in request paths. Product and listing IDs stay the same across seed edits, because browser baskets keep product IDs through a correction.
  - Product and image URLs over `https`, with each product link checked against its retailer's allowed domains at import. The API does not validate most responses, so the importer is where a bad link is stopped.

The browser holds the basket for the current tab session, includes the full basket in comparisons, invalidates stale results after edits, and renders every non-success state distinctly. Show product identity and pack configuration, estimated costs, excluded promotions, per-retailer availability reasons and the fixed-data disclaimer. Support mobile layouts and keyboard operation. Accounts and persistent cross-device baskets are excluded.

Outbound links must work without the event API. Send tracking asynchronously with a bounded/non-blocking attempt; a failed event must not cancel navigation. Click-event writes should have bounded database access and must not starve comparison requests.

## 6. Infrastructure, delivery and observability

### Cost and lifecycle

Cost the entire eight-week project in SGD before credits against approximately SGD 84, including the main load-test day. Include both deployment profiles, their actual durations and any overlap, EBS/RDS storage, ALB hours/capacity, public IPv4, CloudFront/S3, traffic, ECR, logs, backups and any secrets/network services selected. Record the pricing date, currency conversion and applicable tax assumptions. No estimate has yet established that the target configuration fits.

Use one `t4g.micro` for the development POC, with app and database sharing its limited resources. The presentation configuration uses two baseline application instances during the evaluation and presentation window (one while building, as accepted technical debt; section 2), maximum three, and Single-AZ `db.t4g.micro`. Select application instance sizes after ARM64 and load checks. Shorten the presentation window to five days before weakening the required demonstrations. If still unaffordable, raise an explicit cost/scope decision.

Provision reusable infrastructure, then verify teardown by 13 November 2026. Include resources that continue charging after compute shutdown: volumes, load balancers, snapshots, retained databases and logs. Preserve required seed, results and report artefacts before deletion. Any retained billable resource needs an explicit cost entry.

The presentation stack is destroyed when it is not in use, checked daily, and recreated when needed, and the development host stays stopped while the presentation stack is up. Every project resource is tagged `Project=cartoptix`, and the spending alert is a budget filtered by that tag, because the AWS account also holds unrelated workloads.

### Delivery and scaling

PR checks run format, types, relevant tests and builds. Deploy identifiable builds; OIDC is optional for the POC, and credentials are never committed. Apply database migrations once through a designated task, not concurrently on every ASG instance. Retain a known-good application release; rollback restores it when the schema is still compatible, otherwise fix forward. Schema changes need not be backward compatible during the MVP.

Use automatic ASG scaling policies, with a costed maximum of three. Select and document a metric, threshold, warm-up and cooldown from baseline measurements. CPU or ALB requests per target are candidate metrics; the choice is not yet settled. Show scale-out and scale-in under bounded load. The forecast surge may fit baseline capacity, so the trigger demonstration can use a separately labelled higher load.

For burstable instances, record CPU credits/throttling and surplus-credit charges where applicable. Limit database connections across the maximum instance count so application scaling does not exhaust the micro RDS instance.

### Metrics and evidence

Collect per-endpoint request counts, status/outcome, latency distributions, connection/timeout failures from the load generator, comparison duration, no-feasible-plan rates, DB connections and infrastructure resource metrics. Use bounded log retention and spending alerts.

Proposed daily SLO boundary: midnight-to-midnight Asia/Singapore. Define eligible shopper API requests and report request success as `1 - unexpected_failures / eligible_requests`. Exclude correctly rejected invalid input and health probes. A valid business outcome is successful operation; server errors, capacity rejections, connection failures and timeouts are failures. Zero-traffic days have no observed request-success result. Latency remains a separate metric. Report the deliberate resilience experiment separately from acceptance runs, without concealing them in the deployment history.

## 7. Evaluation plan

### Workload contract

The first-year scenario is 1,000 daily active shoppers, two sessions each, 20% arriving in the busiest hour and a fivefold surge. That is 400 peak-hour session starts and 2,000 during the surge, not concurrent requests. The following endpoint rates are independently agreed provisional engineering inputs, not derived measurements of shopper behaviour.

| Endpoint | Normal peak | Surge |
| --- | ---: | ---: |
| `GET /catalogue` | 0.2 RPS | 1 RPS |
| `GET /products` | 1 RPS | 5 RPS |
| `GET /products/:id/offers` | 1 RPS | 5 RPS |
| `POST /basket/compare` | 0.2 RPS | 1 RPS |
| **Total** | **2.4 RPS** | **12 RPS** |

Paths above omit `/api/v1`. Health and click endpoints are outside this four-endpoint forecast; record their additional traffic explicitly. Verify click tracking under concurrent activity without relabelling the four-endpoint totals.

Run all four endpoints simultaneously at the declared surge rates, which are at least the normal rates on every endpoint. Isolated endpoint runs are diagnostic, for a mixed run that misses a target. Separately, measure the highest mixed load the three-instance maximum sustains. Use open-model arrival-rate generation so slow responses do not silently reduce offered load. Vary products, queries and baskets; include normal 20-line and maximum 50-line baskets and relevant pricing boundaries. Report basket p99 and sample counts separately for each size, as well as the aggregate, so maximum-sized requests cannot be hidden by the mix. Both sizes must meet the basket target. Do not rely only on cached identical requests. Declare cache settings and test paths.

Acceptance targets are p99 below 1 second for catalogue/search, p99 below 2 seconds for basket comparison, and at most 0.1% unexpected failures. Product-offer latency must be reported; no separate numeric target was agreed for that endpoint. Measure shopper-facing API latency from a documented load-generator location through the deployed ingress, with server-side timings for diagnosis. Report failures separately rather than excluding them silently from success claims.

The outbound-click endpoint is **excluded from the SC-06 failure measurement**. It answers `204` for every outcome, following the GA Measurement Protocol, so a rejected or dropped event is indistinguishable from a recorded one by status code, and counting its responses would report a success rate that means nothing. Lost events are visible in the server logs instead, and #22 reports them from there. Its latency and throughput are still reported, separately from the four shopper endpoints.

Choose run durations and sample sizes before execution. Low-RPS endpoints need sufficient samples for a meaningful p99 and failure-rate report; include sample counts and avoid implying statistical certainty from a short run. Rehearse locally, then conduct the main cloud exercise in the allocated day. Measure scale-out/scale-in and one-instance termination separately from the acceptance runs. A short experiment cannot establish long-term 99.9% daily request success. Measured capacity, scaling and instance-termination results are recorded in [capacity findings](capacity-findings.md).

### Correctness, quality and user evidence

Reference tests cover exact quantities, multibuy remainders/limits where supported, delivery threshold boundaries, minimum orders, mandatory charges, ties, missing offers, unverified delivery rules and infrastructure errors. Check constructed and real-seed baskets: independently verify each complete retailer total, each unavailability reason, the cheapest recommendation and the no-feasible-plan outcome. Every retailer option is computed exactly.

Recruit 10–15 regular online grocery shoppers for the formative study described in the product specification. Evaluate understanding and perceived value, including cart reconstruction effort. Record negative findings and small fixes; use broader feedback for the report's future-work section. Representative baskets must not be selected solely for large price differences. Report catalogue overlap and equal-cost outcomes.

Estimate continuous BAU cloud costs and compare with on-premise under equivalent workload and availability assumptions. Include fixed provisioned costs, storage/networking and stated hardware depreciation, power and administration assumptions. Keep project spend, BAU estimates and measured resource consumption distinct.

## 8. Workstreams and issue-ready tasks

Each task below is intended to become one GitHub issue. IDs are local planning IDs, not existing issue numbers. `Blocked by` identifies completion dependencies; tasks may develop against agreed contracts and labelled fixtures before real data is ready. During issue creation, retain the scope, acceptance criteria and dependency links, then assign an owner and milestone. Split tasks further only where an independently verifiable deliverable warrants it.

### WS-A — Foundation and contracts

#### A1 — Establish the workspace and ARM64 development baseline
- **Blocked by:** None.
- **Work:** Create the proposed workspace, pin compatible versions, configure local PostgreSQL, formatting/type checks, test commands and an ARM64 application image.
- **Acceptance:** A clean checkout installs, builds and runs a minimal API/web path; the container runs on ARM64; setup instructions are repeatable.

#### A2 — Define the seed schema and public API contracts
- **Blocked by:** A1.
- **Work:** Define seed schemas, canonical identity, pricing explanations, request limits, result/error statuses and OpenAPI routes from sections 3–5. Resolve duplicate-line handling.
- **Acceptance:** Valid and invalid examples are executable contract fixtures; money uses integer cents; no collection-date UI contract is introduced. The comparison fixtures distinguish complete, unavailable and no-feasible-plan outcomes, separate from service errors.

### WS-B — Data curation and persistence

#### B1 — Register and profile source exports
- **Blocked by:** None.
- **Work:** Profile the exports, map source fields and categories, and note malformed prices, stock flags and ambiguous packs.
- **Acceptance:** Raw exports stay unchanged, and each seed listing keeps a reference to its source row.

#### B2 — Curate a pilot catalogue
- **Blocked by:** A2, B1.
- **Work:** Prepare a small cross-category sample in the final seed format; decide exact matches (AI-assisted matching is allowed), check stock eligibility and prices, and remove listings the evidence shows are not directly fulfilled. Quarantine unresolved rows and record corrections.
- **Acceptance:** Every published pilot offer is in stock with a reliable positive price; only high-confidence matches that agree with the name rules are published; known title/specification contradictions are excluded; pilot coverage and gaps are reported.

#### B3 — Verify delivery scenarios and supported prices
- **Blocked by:** A2, B1.
- **Work:** Capture one standard non-member delivery scenario per retailer, with its sources, and confirm each offer's price kind (ordinary or unconditional sale). Encode same-product multibuys and check a sample against the live checkout (PR-03). Record other promotions as excluded. BCRS deposits are out of scope for the MVP (PR-04).
- **Acceptance:** Each retailer's fee, free-delivery threshold, minimum order, threshold basis and fixed order-level charges are verified with evidence, or the rule is explicitly unverified; unknown fees cannot become zero. Offers without a reliable ordinary or unconditional sale price are excluded.

#### B4 — Implement database migrations and atomic seed import
- **Blocked by:** A1, A2.
- **Work:** Implement the logical schema, committed migrations, seed validation and an idempotent, atomic import using fixture seeds first.
- **Acceptance:** Fresh-database setup and repeated import succeed; invalid imports leave the loaded data unchanged; seed validation rejects invalid values and foreign keys keep references intact.

#### B5 — Publish the version-controlled MVP seed
- **Blocked by:** B2, B3, B4.
- **Work:** Expand the verified catalogue toward 200–300 products, prioritising evidence over size. Commit the clean seed and the scripts that build it. Rerun documentation and clearing out intermediates are out of scope for the proof of concept.
- **Acceptance:** Report the proportion of published canonical products with eligible offers from two or more retailers against the 70% target, category coverage and any shortfall; no known-out-of-stock or separately fulfilled offer is eligible; the seed supplies the fields in section 5, with product and listing IDs stable across seed edits and product links checked against retailer domains at import; the seed imports repeatably.

### WS-C — Pricing and recommendation engine

#### C1 — Implement the shared pricing kernel
- **Blocked by:** A2.
- **Work:** Implement product, promotion, mandatory-charge and retailer-order pricing against explicit fixtures. Return itemised explanations and excluded-promotion notices.
- **Acceptance:** Independent reference tests cover cents, multibuy deals and remainders, deals that are not cheaper, minimum orders, threshold boundaries and charge inclusion; percentage rounding happens once in curation and is checked against the live checkout (PR-03). A clock-change test confirms that advancing the date leaves pricing unchanged for the same basket and approved seed. Product and basket paths use the same module. Real rules are validated later in C5.

#### C2 — Price every retailer's complete basket and validate plans
- **Blocked by:** C1.
- **Work:** Price each retailer's complete basket using the shared module, validate all feasible options, record unavailability reasons and recommend the cheapest, breaking ties by retailer ID.
- **Acceptance:** Invalid or partial baskets cannot be returned as complete; totals match references; quantities are preserved; missing offers, unverified delivery rules and unmet minimums make the affected retailer unavailable; ties follow the documented order.

#### C3–C4 — Deferred split-basket search
- **Status:** Deferred; no issue is planned for the MVP, and nothing depends on it.
- **Work:** Splitting a basket across retailers, including its search and time limits, is future work. IDs C3 and C4 are retained for traceability.

#### C5 — Evaluate comparison correctness
- **Blocked by:** B5, C2.
- **Work:** Check constructed reference baskets and real-seed baskets against independent pricing calculations, including unavailable retailers and ties.
- **Acceptance:** Each complete option passes arithmetic and constraint checks; unavailability reasons and the cheapest recommendation match references; no-feasible-plan cases are reported correctly. An independent reference prices every seed listing at 1–20 packs and matches the API, in CI, so every committed snapshot is checked.

### WS-D — Shopper API and web experience

#### D1 — Deliver catalogue and quantity-aware product comparison
- **Blocked by:** A2, B4, C1.
- **Work:** Implement catalogue/search/offer APIs and browsing interface using fixtures first; include exact identity, pack quantities and pricing disclosures.
- **Acceptance:** Pagination/filtering and quantity validation work; product comparison uses shared pricing; missing images do not block shopping; snapshot notice appears without collection dates.

#### D2 — Deliver basket editing
- **Blocked by:** D1.
- **Work:** Add tab-session basket storage, editing and 50-line/20-pack limits.
- **Acceptance:** Limits are enforced in UI and API contracts; reloading the tab restores the basket; edits invalidate previous results; no extra items or alternative packs are inserted.

#### D3 — Deliver basket comparison and outcome presentation
- **Blocked by:** D2, C2.
- **Work:** Integrate the comparison API with per-retailer options, itemised breakdowns, recommendation, unavailability reasons and all business/error states.
- **Acceptance:** All three retailers appear as complete or unavailable; the cheapest feasible option is recommended with the documented tie-break; no feasible plan and retryable service failures are distinct.

#### D4 — Add purchase links and non-blocking click recording
- **Blocked by:** D1, B4.
- **Work:** Add approved product links and the lightweight event endpoint with retailer/listing, plus a server-recorded timestamp. Collect no user identity for this feature.
- **Acceptance:** Known-listing validation prevents arbitrary redirects/events; navigation works when tracking fails; stored events are labelled usage rather than conversions or billable clicks.

#### D5 — Verify complete shopper journeys (tracked with the system evaluation)
- **Blocked by:** B5, D3, D4, E2, E3.
- **Work:** Release the current application and curated seed to the development AWS deployment, then run mobile, keyboard and end-to-end checks for J1–J5; include stale results, service errors and unsupported-promotion notices. Local checks may run earlier but do not close this task.
- **Acceptance:** Each journey has recorded evidence from the deployed service; explanations match backend totals; current-price/availability claims do not exceed the model. Repeat deployed smoke checks after moving to the presentation configuration.

### WS-E — AWS, delivery and lifecycle

#### E1 — Cost both deployment profiles and choose networking
- **Blocked by:** None.
- **Work:** Price Singapore resources and durations before credits; select origin connectivity, administration, application instance sizes and retention assumptions. Separate project and continuous BAU estimates.
- **Acceptance:** A dated SGD estimate covers ancillary costs and the load-test day; origin connectivity and outbound/administration arrangements are documented with their cost impact. The presentation window is affordable or a specific budget/scope decision is raised; two baseline/max-three capacity remains conditional until this check.

#### E2 — Deploy the single-node development POC
- **Blocked by:** A1, B4, E1.
- **Work:** Provision `t4g.micro` app/DB hosting with persistent storage, restricted access, configuration and repeatable seed loading.
- **Acceptance:** A deployed smoke path works; PostgreSQL is not publicly accessible; data survives app restart; resource pressure and POC limitations are documented.

#### E3 — Establish CI and repeatable release delivery
- **Blocked by:** A1, B4, E1.
- **Work:** Add PR checks, identifiable build publishing, explicit migration/seed tasks and a documented rollback. OIDC is optional for the POC.
- **Acceptance:** Checks block a broken build; no long-lived AWS credentials are committed; migrations run once; a prior application release can be restored without destructive schema rollback.

#### E4 — Provision the presentation architecture
- **Blocked by:** E2, E3.
- **Work:** Define in CDK, and deploy from an engineer's machine, an internal ALB, a stateless EC2 ASG (maximum 3; minimum 2 for evaluation and the presentation, 1 while building) running the commit-tagged API image from ECR, private Single-AZ RDS with approved sizing, and CloudFront serving the frontend from a private S3 bucket; configure liveness-based health checks and draining. An engineer runs the migrations and the one-time seed import by hand, following the runbook. Deployment from CI is out of scope.
- **Acceptance:** Requests work through HTTPS ingress; when scaled out, every application instance serves the same data; database access is restricted; a database outage does not drain or replace application instances; the stack is created and destroyed from code; the deployed cost assumptions and topology are recorded.

#### E5 — Configure observability and automatic scaling
- **Blocked by:** E4.
- **Work:** Add request, outcome, latency, DB and resource metrics, bounded logs, a spending alert and a configurable scale-out/scale-in policy. Calibrate thresholds through a controlled shakedown.
- **Acceptance:** Scaling metric, bounds, warm-up and cooldown are documented; maximum capacity is three; DB connection limits account for all instances; request failures and comparison outcomes are distinguishable.

#### E6 — Execute and verify project teardown
- **Blocked by:** F5.
- **Work:** Prepare the teardown procedure early; after the final presentation, preserve required artefacts and delete project services and unneeded retained resources by 13 November 2026.
- **Acceptance:** A resource inventory confirms shutdown/deletion and identifies any intentionally retained costs; seed and evaluation evidence remain available. Do not wait until the deadline to discover teardown blockers. F5 is the planned sequencing dependency, not permission to keep services running past the deadline if reporting is delayed; preserve the evidence and finish writing offline.

### WS-F — Evaluation and reporting

#### F1 — Build the endpoint load-test harness
- **Blocked by:** A2.
- **Work:** Implement the four-endpoint arrival-rate workload, varied inputs, isolated and mixed scenarios and result collection. Define run duration, sample counts, generator location and metric denominators.
- **Acceptance:** Offered load does not fall silently when responses slow; 2.4/12 RPS profiles are reproducible; 20-/50-line baskets are covered; health/click traffic is accounted for separately. Scripts can be prepared against fixtures.

#### F2 — Run surge performance acceptance tests
- **Blocked by:** C5, D5, E5, F1.
- **Work:** Use the allocated cloud load-test day to run the mixed surge test and the three-instance maximum-load test, capture latency/error/resource data and record the code and configuration tested. Include a mixed outbound-click and basket-comparison case, because the claim that click tracking cannot slow comparison is currently reasoned from a separate connection pool rather than measured; clicks still share the database's connection limit, CPU and I/O.
- **Acceptance:** Report p99 and sample counts per endpoint and separately for 20-line and 50-line basket requests, thresholds from SC-05/SC-06, offered/achieved throughput, failures and credit/DB pressure. Product-offer latency is reported without inventing a new threshold. Comparison p99 under concurrent click load is reported against its ordinary p99, so any interference is visible rather than assumed absent. Record failures honestly and remediate/retest affected cases; do not change targets silently.

#### F3 — Demonstrate autoscaling and instance-failure behaviour
- **Blocked by:** E5, F1.
- **Work:** In a separately labelled portion of the test exercise, force bounded scale-out, observe scale-in and terminate one application instance while traffic continues, with the two-instance baseline deployed.
- **Acceptance:** Record capacity changes, delay, request outcomes and continued service; do not claim database failover or long-term SLO compliance. Explain if baseline capacity already handles forecast surge.

#### F4 — Conduct the shopper study and record small refinements
- **Blocked by:** D5.
- **Work:** Recruit 10–15 regular online grocery shoppers; conduct representative tasks on the verified AWS deployment and interviews/questionnaires covering comprehension, trust, value and cart reconstruction effort. The study may use the development deployment; record which configuration and seed were used.
- **Acceptance:** Report deployed task evidence, negative and positive findings, task outcomes, assumption comprehension and changes made; interest is not labelled adoption; longer-term suggestions remain separate from MVP scope.

#### F5 — Assemble the final evaluation and cost report
- **Blocked by:** F2, F3, F4.
- **Work:** Assemble comparison correctness/coverage results, performance, observed request success, shopper findings, project spend and BAU cloud/on-premise comparison.
- **Acceptance:** Note the code and configuration behind the results; report target shortfalls, equal-cost cases and assumptions; update preliminary-report claims about collection dates, availability and the retailer limit; prepare presentation artefacts before teardown.

## 9. Delivery sequence and completion gate

1. **Foundation and evidence:** A1–A2, B1 and E1. Prepare F1 once contracts exist.
2. **Vertical slice:** B2–B4, C1–C2 and D1–D3 using clearly labelled fixtures where needed; establish E2–E3.
3. **Curated MVP:** B5, C5 and D4–D5. Confirm coverage and correct comparisons before presenting recommendations as useful.
4. **Cloud evaluation:** E4–E5, F2–F4. Keep the presentation window within the costed allowance and coordinate the one-day main load exercise.
5. **Report and close:** F5, final presentation, E6 by the shutdown deadline.

Parallel work is possible across data, pricing, frontend and infrastructure after contracts are agreed. Issue dependencies above are the authoritative task ordering; phases describe the overall sequence rather than forcing all workstreams to run serially.

Completion requires a deployed end-to-end comparison service, curated seed, validated recommendations, reported performance/scaling and shopper evidence, cost reporting and teardown. Catalogue overlap, performance, budget and comparison correctness remain targets until measured. If a target is missed, document the finding and resolve or explicitly accept the shortfall; a report must not turn an unmet target into an achieved claim.
