# CartOptix MVP technical implementation specification

**Status:** Delivery design and issue-ready work plan. Product requirements are agreed; implementation defaults below are proposals to validate during setup, not claims that code or infrastructure already exists.

Read this with the [product specification](product-spec.md), which owns user journeys, product rules (`PR-*`) and success criteria (`SC-*`). Together they supersede `mvp-implementation-plan.md`. The repository currently contains documentation, not a completed application. This document defines future tasks; it does not create GitHub issues or assign owners.

## 1. Design decisions and implementation defaults

### Agreed design decisions

- Fixed, curated data for RedMart, FairPrice and Cold Storage; exact product matching and direct supermarket fulfilment only.
- Integer-cent pricing shared by product comparison, basket comparison and result validation.
- Whole-line allocation, at most 50 lines and 20 packs per line, with one to three retailers.
- A heuristic that retains independently calculated single-retailer baselines; no mandatory exact solver.
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
| Persistence | PostgreSQL, Drizzle migrations and bounded `node-postgres` pools. |
| Optimisation | Pure TypeScript pricing/search modules; bounded worker-thread execution to protect the API event loop. HiGHS is not an initial dependency. |
| Packaging | Immutable ARM64-compatible application container; local containerised PostgreSQL. |
| Infrastructure | AWS CDK in TypeScript, with explicit development and presentation profiles. |
| Delivery | GitHub Actions checks, OIDC-based AWS deployment, ECR images and explicit migration execution. |
| Verification | Vitest, API/PostgreSQL integration tests, Playwright journeys and an arrival-rate load tool such as k6. |

Specific package versions, frontend styling, instance sizes for the ASG, origin networking, scaling thresholds, worker limits and search time budgets are engineering choices to validate in the tasks below. They must satisfy the product contract; the old three-second solver limit and five-second watchdog are not retained.

### Adopted and validated in the workspace foundation

These versions were installed, built, tested and run on `arm64` during the workspace foundation task. Later tasks may upgrade them; record the reason when they do.

| Tool | Adopted | Note |
| --- | --- | --- |
| Node.js | 24 (major pinned in `.nvmrc`) | Latest LTS line; minor and patch float during pre-production |
| pnpm | 12.5.1 via Corepack | Pinned in `packageManager`, so only Node must be installed |
| TypeScript | 7.0.2 | Builds all three packages through project references |
| Biome | 2.5.14 | Formatting and linting for JS/TS/JSON; Markdown is not formatted |
| Fastify | 5.12.5 | API |
| React and Vite | React 19.2.0, Vite 8.3.0, `@vitejs/plugin-react` 6.1.1 | Plugin 5.x does not support Vite 8 |
| `pg` | 8.23.0 | Direct driver for the readiness query; Drizzle arrives with the data work |
| Vitest | 5.0.1 | Playwright is deferred until there are journeys to exercise |
| PostgreSQL | 18 locally, matching RDS 18.6 in `ap-southeast-1` | PostgreSQL 18 expects a single mount at `/var/lib/postgresql` |

**Rejected: ESLint with `typescript-eslint`.** `typescript-eslint@8.70.0` declares `typescript >=4.8.4 <6.1.0` and therefore cannot lint a TypeScript 7 codebase. Biome carries its own parser, so it imposes no such constraint. Type-aware lint rules are the cost; `tsc --noEmit` still provides type checking. Revisit only if a needed rule cannot be expressed in Biome.

**Deferred:** React Router, TanStack Query, TypeBox, generated OpenAPI, Drizzle, AWS CDK and k6 remain proposals. Each belongs to the task that first needs it, so the foundation stays free of dependencies nothing yet uses.

## 2. Application architecture

### Runtime boundaries

Use one backend application with catalogue, pricing, optimisation, import and click-event modules. Keep API instances stateless: basket requests contain product IDs, quantities, retailer limit and dataset ID. Do not rely on instance memory or local files for persistent user state.

```text
Development POC
Browser -> EC2 t4g.micro [web/API + PostgreSQL on persistent storage]

Presentation (CloudFront/S3 frontend approach proposed, subject to costing)
Browser -> CloudFront -> private S3 frontend assets
                     -> ALB -> EC2 Auto Scaling Group -> private RDS PostgreSQL
                                desired/min 2, max 3      db.t4g.micro, Single-AZ

Offline data preparation -> validated versioned seed -> explicit database import
```

CloudFront/S3 retain the preliminary architecture's frontend approach. Final origin connectivity and networking must be costed before provisioning. ALB routes requests; ASG policies change instance count. RDS remains a single database failure point: surviving an application-instance failure does not demonstrate database failover.

Serve browser traffic over HTTPS. Keep S3 private, restrict application ingress to its intended proxy/load balancer, and restrict database ingress to application instances. Avoid publicly exposed PostgreSQL in both profiles. Select an administration/outbound-access arrangement in the costed infrastructure design rather than adding an unbudgeted NAT gateway by default.

### Import and serving separation

Retailer websites are not runtime dependencies. Import validated seed data through an internal CLI or deployment task, not a public upload endpoint. A live retailer outage does not affect snapshot calculations; relevant serving failures are missing eligible records, invalid imports, database unavailability and application failures.

Imports must be atomic and idempotent. Activate a dataset only after validation and loading succeed. Pin each comparison to one dataset and delivery-rule version. Proposed behaviour for a request using a dataset no longer served: return an explicit version-conflict response and prompt the browser to refresh; never silently mix old basket data with new prices.

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
- Some FairPrice names contain `[BCRS]`; the files do not establish deposit inclusion.

Do not infer seller eligibility, collection dates or canonical identity from these files alone. Titles, URLs and category labels can supply clues but are not sufficient verification.

### Curation pipeline

1. Register original files with checksums and stable file/sheet/row references. Preserve originals outside the clean seed; do not overwrite source observations.
2. Normalise field names, money, units, pack counts and stable retailer listing identifiers. Preserve raw values alongside transformations in provenance records.
3. Restrict candidates to the eight product categories. Treat `Keyword` as source discovery metadata, not the canonical category taxonomy.
4. Exclude source stock `No`, unverifiable prices, third-party fulfilment and unresolved mandatory charges.
5. Propose matches, then manually verify exact identity. Quarantine contradictions and record corrections with evidence.
6. Verify selected promotion terms and one delivery scenario per retailer. Multibuys are optional; if verification effort is disproportionate, publish verified ordinary/unconditional sale prices with omission notices instead. Do not infer unsupported rules. Approve dated promotions only with evidence that they belong in the recorded scenario, preserving the captured validity terms internally.
7. Publish clean, schema-validated seed data with version, coverage report and exclusions. Target 200–300 products, with at least 70% having eligible offers from two or more retailers; reduce size before weakening evidence requirements. Compute coverage as qualifying canonical products divided by all published canonical products, not raw listings.

Start with a small curation pilot (proposed size: about 30 canonical products spread across the categories) before expanding. This is an implementation checkpoint, not a claim that such a sample has already been approved or created. A second reviewer should check a sample of final mappings. Report curation quality; automated precision/recall claims require an actual matcher and independent labels, not rechecking the same manually constructed answers.

### Logical data model

| Entity | Key information |
| --- | --- |
| Retailer | Stable ID, name and allowed product-link domains. |
| Canonical product | ID, category, brand, variant, pack count, per-pack size/unit or equivalent non-food identity, display name. |
| Listing | Retailer ID, source listing/SKU ID, canonical ID, product/image URLs, verified direct-fulfilment status and evidence reference. |
| Dataset | ID/schema version, seed revision/checksum, activation state and import metadata. Import time is not a collection date. |
| Offer | Dataset/listing IDs, price in cents, optional descriptive original price, source stock flag, eligibility and exclusion reason, price/charge inclusion evidence. |
| Supported promotion | Listing/dataset, verified type, qualifying quantity, payable amount, repetition cap/rule, remainder rule, captured validity terms where present, and scenario-approval evidence. Rules are fixed for that seed version. |
| Delivery scenario/rule | Dataset/retailer, declared location/service, explicit non-member eligibility, fee, free-delivery threshold, minimum-order constraint, spending bases, fixed charges and verification evidence. |
| Mandatory item charge | Verified amount/basis, inclusion in the source price and threshold treatment; supports deposits without double-counting. |
| Provenance/correction | Source file/sheet/row, original value, correction, reason and verification reference; may live in seed-side records rather than runtime tables. |
| Click event | Event ID, retailer/listing/product, server timestamp and dataset ID; no user identity. |

Retain a clean JSON seed and its validation schema in Git. Protect referential integrity, positive usable prices, valid quantities, unique stable IDs and consistent pack information. Different listings with similar names are not automatically duplicates. Do not deploy all 177,638 raw rows merely because they were scraped.

Dataset freezing is best-effort. Record seed commit/checksum in evaluation output; record material changes and rerun affected checks where practical. Do not build a collection-date display or invent dates from workbook metadata.

## 4. Pricing and heuristic design

### Shared pricing kernel

One deterministic module calculates product-line costs and retailer-order totals. Use integer SGD cents and parse import values with decimal-aware logic. Fixed-price bundles can be calculated as whole bundles plus remainder packs without dividing the bundle price into fractional cents. If a verified supported rule requires rounding, capture the retailer's rounding basis and stage, document it, and test the boundary; exclude rules whose rounding treatment cannot be established rather than inventing a discount convention.

- Compute the verified ordinary or unconditional sale cost for the exact pack quantity.
- Compare eligible same-product bundles only where terms are encoded; apply verified repetition and remainder rules. Do not stack promotions unless explicitly supported and verified; initial scope excludes stacking.
- Treat original prices and raw savings text as descriptive evidence, not automatic extra discounts.
- Apply verified mandatory item charges, retailer minimum orders, delivery fees and threshold spending bases.
- Return an itemised explanation and excluded-promotion notices, not just a scalar total.

Unknown necessary delivery rules prevent a valid complete-total calculation for that retailer. Do not substitute zero. An unsupported promotion can be ignored only when a verified usable price remains and the omission is disclosed.

Promotion eligibility comes from the approved seed version, not the runtime clock. Advancing the current date must not expire or activate a promotion during calculation. Keep captured validity terms as internal provenance, not website collection dates or live-validity claims. A correction to approved rules produces a new seed version. Reject a promotion from the curated rules when its applicability to the recorded scenario cannot be established; retain a verified ordinary-price fallback only with the required disclosure.

The initial pricing kernel may omit multibuy execution entirely if B3 approves only ordinary/unconditional prices. Keep unsupported rules out of the active seed; bundle-specific implementation and acceptance cases apply only when that promotion type is adopted.

### Search procedure

1. Validate and canonicalise input; merge duplicate product IDs before enforcing line and quantity limits, or reject duplicates consistently in the contract.
2. Load one dataset and precompute each eligible product–retailer cost for the requested quantity.
3. Calculate every feasible complete single-retailer plan independently. Retain the cheapest baseline throughout search.
4. Enumerate retailer subsets within the user's limit (at most seven non-empty subsets for three retailers).
5. For each subset, generate a starting whole-line allocation using product costs and attempt single-line moves, recalculating affected order totals and constraints.
6. Retain only validated feasible candidates. Rank by total, then retailer count, then stable retailer/product ordering.
7. Return the best candidate, baseline and best permitted split candidate if found, with itemised totals and status.

An initially invalid allocation may need constraint-repair moves before it becomes feasible. Specify deterministic move ordering and a bounded repair strategy in the algorithm task. Single-line local search can miss improvements or feasible assignments requiring coordinated moves. Evaluate that limitation before adding complexity or reconsidering an exact solver.

Keep the event loop responsive with bounded workers and queues. Establish a search budget below the end-to-end two-second basket target, leaving room for queueing, database access and response processing. On search-budget exhaustion, return the best validated candidate, including the baseline when available. Capacity rejection or an internal crash is an operational failure, not a valid “no plan found” response.

### Result semantics

Proposed API statuses:

| Status | Meaning |
| --- | --- |
| `best_found` | A validated plan was found; optimality is not claimed. Include whether a search limit was reached. |
| `proven_infeasible` | An explicit check establishes impossibility, such as a requested line with no eligible offer. Return the reason. |
| `no_plan_found` | Bounded search found no valid allocation but did not prove impossibility. |
| Operational error | Invalid data, worker failure, database failure or capacity rejection. Use a distinct error response. |

Missing single-retailer baseline means nullable savings, not zero or a fabricated comparison. Never return a partial basket as a complete result. Record no-plan rates and algorithm quality separately so quick but unhelpful responses cannot masquerade as product success.

## 5. API and interface contracts

Proposed endpoints, preserving the agreed load-test inventory:

| Endpoint | Responsibility |
| --- | --- |
| `GET /api/v1/catalogue` | Dataset ID, retailers, categories, delivery assumptions and supported-pricing disclosures. No collection-date display field. |
| `GET /api/v1/products` | Paginated search/category browse of published products. |
| `GET /api/v1/products/:id/offers?quantity=...` | Quantity-aware eligible offers and shared pricing explanations. |
| `POST /api/v1/basket/compare` | Dataset ID, lines and retailer limit; complete baselines, best-found/split candidates, statuses and breakdowns. |
| `POST /api/v1/events/outbound-click` | Best-effort usage event for a known listing and dataset. |
| `GET /health/live`, `GET /health/ready` | Process health; database and active-dataset readiness. Not substitutes for measured shopper API success. |

Schemas must validate IDs, integer quantities, retailer limits and dataset versions. Client-submitted prices are never trusted. Product links come from approved listing records; avoid an arbitrary redirect service.

The browser holds the basket for the current tab session, includes the full basket in comparisons, invalidates stale results after edits, and renders every non-success state distinctly. Show product identity and pack configuration, estimated costs, excluded promotions, retailer order count and the fixed-data disclaimer. Support mobile layouts and keyboard operation. Accounts and persistent cross-device baskets are excluded.

Outbound links must work without the event API. Send tracking asynchronously with a bounded/non-blocking attempt; a failed event must not cancel navigation. Click-event writes should have bounded database access and must not starve comparison requests.

## 6. Infrastructure, delivery and observability

### Cost and lifecycle

Cost the entire eight-week project in SGD before credits against approximately SGD 84, including the main load-test day. Include both deployment profiles, their actual durations and any overlap, EBS/RDS storage, ALB hours/capacity, public IPv4, CloudFront/S3, traffic, ECR, logs, backups and any secrets/network services selected. Record the pricing date, currency conversion and applicable tax assumptions. No estimate has yet established that the target configuration fits.

Use one `t4g.micro` for the development POC, with app and database sharing its limited resources. The presentation configuration uses two baseline application instances, maximum three, and Single-AZ `db.t4g.micro`. Select application instance sizes after ARM64 and load checks. Shorten the presentation window to five days before weakening the required demonstrations. If still unaffordable, raise an explicit cost/scope decision.

Provision reusable infrastructure, then verify teardown by 13 November 2026. Include resources that continue charging after compute shutdown: volumes, load balancers, snapshots, retained databases and logs. Preserve required seed, results and report artefacts before deletion. Any retained billable resource needs an explicit cost entry.

### Delivery and scaling

PR checks run format, types, relevant tests and builds. Deploy immutable images/assets with GitHub OIDC. Apply database migrations once through a designated task, not concurrently on every ASG instance. Retain a known-good application release and use backward-compatible schema changes for rollback.

Use automatic ASG scaling policies, with a costed maximum of three. Select and document a metric, threshold, warm-up and cooldown from baseline measurements. CPU or ALB requests per target are candidate metrics; the choice is not yet settled. Show scale-out and scale-in under bounded load. The forecast surge may fit baseline capacity, so the trigger demonstration can use a separately labelled higher load.

For burstable instances, record CPU credits/throttling and surplus-credit charges where applicable. Limit aggregate worker and database connections across the maximum instance count so application scaling does not exhaust the micro RDS instance.

### Metrics and evidence

Collect per-endpoint request counts, status/outcome, latency distributions, connection/timeout failures from the load generator, search duration, queue pressure, no-plan rates, worker utilisation, DB connections and infrastructure resource metrics. Use bounded log retention and spending alerts.

Proposed daily SLO boundary: midnight-to-midnight Asia/Singapore. Define eligible shopper API requests and report request success as `1 - unexpected_failures / eligible_requests`. Exclude correctly rejected invalid input and health probes. A valid business outcome is successful operation; server errors, capacity rejections, connection failures and timeouts are failures. Zero-traffic days have no observed request-success result. Latency remains a separate metric. Report deliberate overload/fault experiments separately from acceptance runs, without concealing them in the deployment history.

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

Run isolated endpoint tests, then all four endpoints simultaneously at the declared rates. Use open-model arrival-rate generation so slow responses do not silently reduce offered load. Vary products, queries and baskets; include normal 20-line and maximum 50-line baskets, different retailer limits and relevant pricing boundaries. Report basket p99 and sample counts separately for each size, as well as the aggregate, so maximum-sized requests cannot be hidden by the mix. Both sizes must meet the basket target. Do not rely only on cached identical requests. Declare cache settings and test paths.

Acceptance targets are p99 below 1 second for catalogue/search, p99 below 2 seconds for basket comparison, and at most 0.1% unexpected failures. Product-offer latency must be reported; no separate numeric target was agreed for that endpoint. Measure shopper-facing API latency from a documented load-generator location through the deployed ingress, with server-side timings for diagnosis. Report failures separately rather than excluding them silently from success claims.

Choose run durations and sample sizes before execution. Low-RPS endpoints need sufficient samples for a meaningful p99 and failure-rate report; include sample counts and avoid implying statistical certainty from a short run. Rehearse locally, then conduct the main cloud exercise in the allocated day. Measure overload, scale-out/scale-in and one-instance termination separately. A short experiment cannot establish long-term 99.9% daily request success.

### Correctness, quality and user evidence

Reference tests cover exact quantities, multibuy remainders/limits where supported, delivery threshold boundaries, minimum orders, mandatory charges, ties, missing baseline, unavailable offers, heuristic exhaustion, stale datasets and infrastructure errors. Include naive allocations that violate minimum orders, testing bounded repair and honest unresolved-search outcomes. Verify result arithmetic independently and compare small baskets with exhaustive enumeration. Report optimality gaps, missed feasible plans and savings found; do not require mathematical optimality for all production requests.

Recruit 10–15 regular online grocery shoppers for the formative study described in the product specification. Evaluate understanding and perceived value, including cart reconstruction effort. Record negative findings and small fixes; use broader feedback for the report's future-work section. Representative baskets must not be selected solely for savings. Report catalogue overlap and zero-saving outcomes.

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
- **Work:** Define versioned seed schemas, canonical identity, pricing explanations, request limits, result/error statuses and OpenAPI routes from sections 3–5. Resolve duplicate-line handling and version conflicts.
- **Acceptance:** Valid and invalid examples are executable contract fixtures; money uses integer cents; missing baseline and heuristic failure are distinct; no collection-date UI contract is introduced.

### WS-B — Data curation and persistence

#### B1 — Register and profile source exports
- **Blocked by:** None.
- **Work:** Record source checksums/row references, reproduce basic profiling, map source fields and categories, and document malformed prices, stock flags and ambiguous packs.
- **Acceptance:** A repeatable report reproduces or explains differences from the supplied-file counts; raw values remain unchanged and findings are traceable to source rows.

#### B2 — Curate and independently review a pilot catalogue
- **Blocked by:** A2, B1.
- **Work:** Prepare a small cross-category sample; verify exact matches, direct fulfilment, stock eligibility, prices and charge treatment. Quarantine unresolved rows and record corrections.
- **Acceptance:** Every published pilot offer has evidence for eligibility; known title/specification contradictions are resolved or excluded; a second reviewer checks a sample; pilot coverage and gaps are reported.

#### B3 — Verify delivery scenarios and supported promotion rules
- **Blocked by:** A2, B1.
- **Work:** Capture one delivery scenario per retailer and verify selected ordinary/sale prices, optional multibuy terms and deposit treatment. Record sources, dated-promotion scenario evidence and excluded promotions. Decide whether multibuy support is justified by the evidence and effort required.
- **Acceptance:** Standard non-member eligibility, minimum orders, fees and threshold bases are explicit; unresolved charges cannot become zero; price inclusion prevents double-counted deposits. Multibuys without sufficient terms stay unsupported, and omitting multibuy support does not block completion. Approved dated promotions have recorded scenario evidence and are fixed to a seed version; unresolved promotions use a disclosed reliable-price fallback or the offer is excluded.

#### B4 — Implement database migrations and atomic seed import
- **Blocked by:** A1, A2.
- **Work:** Implement the logical schema, committed migrations, seed validation, idempotent import and atomic dataset activation using fixture seeds first.
- **Acceptance:** Fresh-database setup and repeated import succeed; invalid imports leave the active dataset unchanged; foreign keys and money/quantity checks reject invalid data; dataset identity is queryable.

#### B5 — Publish the version-controlled MVP seed
- **Blocked by:** B2, B3, B4.
- **Work:** Expand the verified catalogue toward 200–300 products, prioritising evidence over size. Commit clean seed/provenance and document versioning, exclusions and review procedure.
- **Acceptance:** Report the proportion of published canonical products with eligible offers from two or more retailers against the 70% target, category coverage and any shortfall; no known-out-of-stock or separately fulfilled offer is eligible; the seed imports reproducibly and has a recorded revision/checksum.

### WS-C — Pricing and recommendation engine

#### C1 — Implement the shared pricing kernel
- **Blocked by:** A2.
- **Work:** Implement product, promotion, mandatory-charge and retailer-order pricing against explicit fixtures. Return itemised explanations and excluded-promotion notices.
- **Acceptance:** Independent reference tests cover cents, supported bundle terms/remainders where adopted, minimum orders, threshold boundaries and charge inclusion; document and test rounding boundaries if any supported rule requires rounding. A clock-change test confirms that advancing the date leaves pricing unchanged for the same basket and approved seed, including dated promotions if adopted. Product and basket paths use the same module. Real rules are validated later in C5.

#### C2 — Implement baselines and assignment validation
- **Blocked by:** C1.
- **Work:** Compute complete single-retailer plans, validate complete assignments, calculate nullable savings and implement cost/retailer-count/stable tie-breaking.
- **Acceptance:** Invalid or partial plans cannot be returned as complete; baseline costs match references; quantities and retailer limits are preserved; absent baselines produce unavailable savings.

#### C3 — Implement bounded heuristic search
- **Blocked by:** C2.
- **Work:** Enumerate retailer subsets, generate starts, implement bounded constraint repair and whole-line local moves, retain baseline/best candidates and expose honest statuses.
- **Acceptance:** Known splitting wins are found; no result is worse than an existing baseline. A starting allocation that violates minimum orders is either repaired within bounds or excluded as an unproven candidate, never used to claim impossibility for the whole basket. Coordinated-move limitations are documented; search failure is not labelled proven infeasibility.

#### C4 — Isolate search execution and control capacity
- **Blocked by:** A1, C3.
- **Work:** Add bounded worker execution, queue limits, cancellation/deadline handling and operational metrics. Set configurable budgets compatible with the two-second target.
- **Acceptance:** Search cannot block catalogue requests indefinitely; budget exhaustion returns a validated candidate when available; worker crashes/capacity rejections remain operational errors; queues do not grow without bound.

#### C5 — Evaluate recommendation correctness and quality
- **Blocked by:** B5, C4.
- **Work:** Add small exhaustive-search references and real-seed basket cases; measure cost gaps, missed feasible plans and savings distributions.
- **Acceptance:** Returned plans pass independent arithmetic/constraint checks; known positive and zero-saving cases pass; limitations and any required algorithm changes are recorded without an unsupported optimum claim.

### WS-D — Shopper API and web experience

#### D1 — Deliver catalogue and quantity-aware product comparison
- **Blocked by:** A2, B4, C1.
- **Work:** Implement catalogue/search/offer APIs and browsing interface using fixtures first; include exact identity, pack quantities and pricing disclosures.
- **Acceptance:** Pagination/filtering and quantity validation work; product comparison uses shared pricing; missing images do not block shopping; snapshot notice appears without collection dates.

#### D2 — Deliver basket editing and retailer preferences
- **Blocked by:** D1.
- **Work:** Add tab-session basket storage, editing, 50-line/20-pack limits and the one-to-three retailer selector.
- **Acceptance:** Limits are enforced in UI and API contracts; reloading the tab restores the basket; edits invalidate previous results; no extra items or alternative packs are inserted.

#### D3 — Deliver basket comparison and outcome presentation
- **Blocked by:** D2, C4.
- **Work:** Integrate the comparison API with baseline/split views, itemised retailer receipts, nullable savings and all business/error states.
- **Acceptance:** Complete plans appear side by side where available; ties favour fewer orders; missing baseline, proven blockers, no-plan and operational failures are distinct; stale dataset responses prompt refresh.

#### D4 — Add purchase links and non-blocking click recording
- **Blocked by:** D1, B4.
- **Work:** Add approved product links and the lightweight event endpoint with retailer/listing, timestamp and dataset reference. Collect no user identity for this feature.
- **Acceptance:** Known-listing validation prevents arbitrary redirects/events; navigation works when tracking fails; stored events are labelled usage rather than conversions or billable clicks.

#### D5 — Verify complete shopper journeys
- **Blocked by:** B5, D3, D4, E2, E3.
- **Work:** Release the current application and curated seed to the development AWS deployment, then run mobile, keyboard and end-to-end checks for J1–J5; include stale results, service errors and unsupported-promotion notices. Local checks may run earlier but do not close this task.
- **Acceptance:** Each journey has recorded evidence from the deployed service; explanations match backend totals; current-price/availability or optimality claims do not exceed the model. Repeat deployed smoke checks after moving to the presentation configuration.

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
- **Work:** Add PR checks, immutable image/asset publishing, OIDC, explicit migration/seed tasks and rollback procedures.
- **Acceptance:** Checks block a broken build; no long-lived AWS credentials are committed; migrations run once; a prior application release can be restored without destructive schema rollback.

#### E4 — Provision the presentation architecture
- **Blocked by:** E2, E3.
- **Work:** Deploy CloudFront/S3, ALB, stateless EC2 ASG and private Single-AZ RDS with approved sizing; migrate/import the seed and configure readiness/draining.
- **Acceptance:** Requests work through HTTPS ingress; either application instance serves the same dataset; database access is restricted; the deployed cost assumptions and topology are recorded.

#### E5 — Configure observability and automatic scaling
- **Blocked by:** E4.
- **Work:** Add request/search/queue/DB/resource metrics, bounded logs, spending alerts and configurable scale-out/scale-in policies. Calibrate thresholds through a controlled shakedown.
- **Acceptance:** Scaling metric, bounds, warm-up and cooldown are documented; maximum capacity is three; DB pools/worker limits account for all instances; request failures and search outcomes are distinguishable.

#### E6 — Execute and verify project teardown
- **Blocked by:** F5.
- **Work:** Prepare the teardown procedure early; after the final presentation, preserve required artefacts and delete project services and unneeded retained resources by 13 November 2026.
- **Acceptance:** A resource inventory confirms shutdown/deletion and identifies any intentionally retained costs; seed and evaluation evidence remain available. Do not wait until the deadline to discover teardown blockers. F5 is the planned sequencing dependency, not permission to keep services running past the deadline if reporting is delayed; preserve the evidence and finish writing offline.

### WS-F — Evaluation and reporting

#### F1 — Build the endpoint load-test harness
- **Blocked by:** A2.
- **Work:** Implement the four-endpoint arrival-rate workload, varied inputs, separate isolated/mixed/overload scenarios and result collection. Define run duration, sample counts, generator location and metric denominators.
- **Acceptance:** Offered load does not fall silently when responses slow; 2.4/12 RPS profiles are reproducible; 20-/50-line baskets are covered; health/click traffic is accounted for separately. Scripts can be prepared against fixtures.

#### F2 — Run normal/surge performance acceptance tests
- **Blocked by:** C5, D5, E5, F1.
- **Work:** Use the allocated cloud load-test day to run isolated and mixed tests, capture latency/error/resource data and record code/seed/configuration versions.
- **Acceptance:** Report p99 and sample counts per endpoint and separately for 20-line and 50-line basket requests, thresholds from SC-05/SC-06, offered/achieved throughput, failures and credit/DB pressure. Product-offer latency is reported without inventing a new threshold. Record failures honestly and remediate/retest affected cases; do not change targets silently.

#### F3 — Demonstrate autoscaling and instance-failure behaviour
- **Blocked by:** E5, F1.
- **Work:** In a separately labelled portion of the test exercise, force bounded scale-out, observe scale-in and terminate one application instance while traffic continues.
- **Acceptance:** Record capacity changes, delay, request outcomes and continued service; do not claim database failover or long-term SLO compliance. Explain if baseline capacity already handles forecast surge.

#### F4 — Conduct the shopper study and record small refinements
- **Blocked by:** D5.
- **Work:** Recruit 10–15 regular online grocery shoppers; conduct representative tasks on the verified AWS deployment and interviews/questionnaires covering comprehension, trust, value and cart reconstruction effort. The study may use the development deployment; record which configuration and seed were used.
- **Acceptance:** Report deployed task evidence, negative and positive findings, task outcomes, assumption comprehension and changes made; interest is not labelled adoption; longer-term suggestions remain separate from MVP scope.

#### F5 — Assemble the final evaluation and cost report
- **Blocked by:** F2, F3, F4.
- **Work:** Assemble correctness/coverage results, heuristic limitations, performance, observed request success, shopper findings, project spend and BAU cloud/on-premise comparison.
- **Acceptance:** Trace results to versions/configuration; report target shortfalls, zero-saving cases and assumptions; update preliminary-report claims about dates, availability and optimality; prepare presentation artefacts before teardown.

## 9. Delivery sequence and completion gate

1. **Foundation and evidence:** A1–A2, B1 and E1. Prepare F1 once contracts exist.
2. **Vertical slice:** B2–B4, C1–C4 and D1–D3 using clearly labelled fixtures where needed; establish E2–E3.
3. **Curated MVP:** B5, C5 and D4–D5. Confirm coverage and acceptable heuristic behaviour before presenting recommendations as useful.
4. **Cloud evaluation:** E4–E5, F2–F4. Keep the presentation window within the costed allowance and coordinate the one-day main load exercise.
5. **Report and close:** F5, final presentation, E6 by the shutdown deadline.

Parallel work is possible across data, pricing, frontend and infrastructure after contracts are agreed. Issue dependencies above are the authoritative task ordering; phases describe the overall sequence rather than forcing all workstreams to run serially.

Completion requires a deployed end-to-end comparison service, curated seed/provenance, validated recommendations, reported performance/scaling and shopper evidence, cost reporting and teardown. Catalogue overlap, performance, budget and algorithm quality remain targets until measured. If a target is missed, document the finding and resolve or explicitly accept the shortfall; a report must not turn an unmet target into an achieved claim.
