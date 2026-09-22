# API and pricing contracts

Implements the API portion of technical task **A2 / GitHub #5 (BE1)**. The shared
interfaces unblock **#8 (C1, pricing)** and **#9 (D1, catalogue/search)** against
synthetic fixtures. Shopper endpoint handlers and the pricing kernel belong to
their downstream issues.

## Source of truth

`packages/contracts` exports TypeBox schemas and inferred TypeScript types. Both
apps import from `@cartoptix/contracts`; fixture consumers import from
`@cartoptix/contracts/fixtures`.

| Module | Contents |
| --- | --- |
| `common.ts` | IDs, dataset references, exact product identity, cents, quantities and disclaimer |
| `api.ts` | Request/response schemas, error envelopes and duplicate-product check |
| `pricing.ts` | Pricing kernel interface, approved pricing inputs and itemised outputs |
| `routes.ts` | Fastify-compatible route schemas and generated OpenAPI 3.1 document |
| `fixtures.ts` | Labelled synthetic response scenarios, pricing inputs/expected outputs and invalid requests |
| `health.ts` | Existing health types derived from schemas |
| `schema.ts` | TypeBox helpers, internal to the package and not re-exported |

The runtime schemas are authoritative for structural validation. TypeScript
cannot enforce numeric bounds or relationships between fields. The semantic
checks below are mandatory in the downstream handlers/kernel; JSON Schema and
response serialisation alone do not establish a valid plan.

Generate OpenAPI JSON on stdout from the same schemas:

```bash
pnpm --filter @cartoptix/contracts build
pnpm --filter @cartoptix/contracts exec node --input-type=module -e \
  'import { openApiDocument } from "./dist/index.js"; console.log(JSON.stringify(openApiDocument, null, 2))'
```

TypeBox `0.34.52` is used for its JSON-Schema/Fastify-compatible schemas and
inferred types. Tests validate the fixtures with TypeBox and strict AJV, compile
the route schemas, and exercise basket response serialisation through Fastify.
OpenAPI is generated in memory rather than maintained as a second schema file.

## Data interface checkpoint with #4

No seed/database checkpoint was published in issue #4 when these contracts were
prepared. This is a concrete adapter proposal, not evidence of agreement with
the data owner or verification of real prices, delivery rules or coverage.

Before integrating the real seed, coordinate these points with #4:

1. Preserve opaque canonical product and listing IDs across dataset versions.
   IDs are case-sensitive, 1–128 ASCII letters/digits/`.`/`_`/`:`/`-`, starting
   with a letter or digit. Retailer IDs are `redmart`, `fairprice`, `cold-storage`.
2. Map the eight product categories to stable IDs. The IDs in `catalogueExample`
   are the proposed mapping; clients read the catalogue rather than hard-code it.
3. A dataset ID binds one immutable set of product mappings, offers, approved
   promotions and delivery rules. `deliveryRuleVersion` identifies that rule
   set; a rule change requires a new dataset ID. Keep checksums and provenance
   internally. Public references expose `dataKind: curated | synthetic` without
   collection dates.
4. `Product.pack.unitCount` counts contained units in one purchasable pack;
   basket `quantity` counts those packs. `sizePerUnit` is an exact display string
   (for example `1.5`), never a floating-point price or matching heuristic.
   Non-food items can use `unit: "piece"` and size `"1"` with an exact variant.
5. Adapt only published, verified, directly fulfilled, source-in-stock offers to
   `OfferPricingInput`. Unresolved charge treatment excludes the listing; an
   empty charge list means verified absence of charges, not missing evidence.
6. Verify threshold bases and deposit inclusion. Unsupported delivery rules are
   represented as `unavailable`, never fabricated zero fees. Rule IDs, charge
   IDs and product/listing references must be unique in their relevant scope.

The fixtures are not a production seed or a database import schema. #4 still owns
seed validation, provenance, database structure and atomic activation.

## HTTP rules

All payloads use JSON and integer SGD cents. Unknown object properties are
rejected. Monetary inputs, sums and products must remain safe integers;
overflow or inconsistent imported data is an operational failure.

For Fastify integration, use `removeAdditional: false`. Validate JSON bodies
without coercion (`coerceTypes: false`) so `"2"`, `true` and `null` cannot become
pack counts. Decode GET integer parameters (`page`, `pageSize`, `quantity`) from
one unsigned decimal string into a safe integer before schema validation. Reject
repeated parameters, fractions, signs, exponent notation and unknown query
parameters. Apply the documented pagination defaults when parameters are absent.
Do not rely on Fastify's default body coercion or unknown-property removal.

Data-dependent requests require `datasetId`. Serve only the active dataset in
this initial contract. Acquire the dataset reference and all records from one
consistent database snapshot; activation during a request must not mix versions.
Validation order is structural validation, active-dataset lookup/version check,
then resource checks/calculation. If no dataset is available, return 503 rather
than an empty catalogue. A well-formed stale or unknown dataset ID receives 409
with the active ID. The client refreshes and revalidates its basket; it must not
silently resubmit with changed prices.

| Method and path | Request | Success |
| --- | --- | --- |
| `GET /api/v1/catalogue` | No parameters | `CatalogueResponse`, 200 |
| `GET /api/v1/products` | `ProductsQuery` | `ProductsResponse`, 200 |
| `GET /api/v1/products/:id/offers` | `OffersParams`, `OffersQuery` | `OffersResponse`, 200 |
| `POST /api/v1/basket/compare` | `BasketCompareRequest` | `BasketCompareResponse`, 200 for every business outcome |
| `POST /api/v1/events/outbound-click` | `OutboundClickRequest` | 204, no body, after recording |
| `GET /health/live` | None | 200 while the process can respond |
| `GET /health/ready` | None | 200 when required checks pass; otherwise 503 |

### Catalogue, search and offers (#9)

`GET /catalogue` returns all three retailers and eight categories, the declared
standard non-member scenario, each retailer's verified or unavailable delivery
rules, supported pricing kinds and the exact fixed-dataset disclaimer. Retailer,
category and delivery-rule entries must have distinct corresponding IDs.

Search uses a trimmed, case-insensitive **literal substring** of `name`, `brand`
or `variant`; `%` and `_` are literal characters, not SQL wildcards. Combine the
query and category filter with AND. A supplied query must contain a non-space
character and be at most 100 characters long before trimming. Unknown category
IDs return 400. Order by `productId` using stable ASCII ordering, ascending.
`page` defaults to 1; `pageSize` to 20, maximum 100. `pagination.total` is the
count after filtering, before pagination. No matches or a page beyond the last
result returns 200 with an empty list. Database errors return an error envelope,
never an empty success.

Offer requests require quantity 1–20. An unknown/unpublished product is 404;
a known product with no eligible offers returns 200 with `offers: []`. Sort by
line total, retailer ID, then listing ID. Returned IDs and quantity must match
the parent product/request. Prices are product costs **before delivery**, with
mandatory item charges itemised. Links come from approved listing records;
the adapter validates allowed retailer domains. Nullable images must not prevent
product selection. No runtime stock check or stock count is implied.

### Basket outcomes

- Accept 1–50 distinct lines, 1–20 whole packs each and `maxRetailers` 1–3.
- Reject duplicate product IDs with 400, even if the quantities differ or their
  sum would fit. Run `duplicateProductIds` after structural validation. Do not
  merge silently. Unknown/unpublished product IDs also return 400.
- `best_found` carries a complete recommendation, optional best permitted split,
  baseline availability and `searchLimitReached`. It makes no optimality claim.
- `proven_infeasible` requires an actual proof under the supported model. An
  unavailable line can prove it; an unrepaired heuristic assignment cannot.
  `blocker.code` distinguishes the proof: `no_eligible_offer` (a requested line
  has no eligible offer in the dataset), `retailer_limit` (no assignment within
  the requested maximum can cover every line) and `exhaustive_check` (all
  permitted assignments were checked, never a timeout). Confirm `retailer_limit`
  against #8's actual infeasibility proofs before relying on it; it is an
  extrapolation from the technical spec rather than an example it names.
- `no_plan_found` means the search failed to find a complete plan without proving
  impossibility. `searchLimitReached: false` may mean the heuristic exhausted its
  moves rather than all mathematically possible assignments.
- Operational failures use 500/503 and never become a business outcome.

Check every plan against the echoed request: each product appears exactly once
with its entire requested quantity, all offers are eligible under the same
dataset, orders are non-empty with distinct retailers, and all minimum orders
are met. Counts and totals must agree with their breakdowns. No substitutions,
split quantities or extra packs are allowed.

The baseline is the cheapest feasible complete single-retailer plan, evaluated
independently. `baseline.plan` must contain exactly one retailer. The recommendation
must cost no more than that baseline, including when search runs out of time.
`baseline.savingsCents = baseline.plan.totalCents - recommendation.totalCents`.
With no baseline, both its plan and savings are **null**, not zero. A baseline
already found rules out `no_plan_found` and `proven_infeasible`.

`bestSplit`, when present, uses 2–`maxRetailers` retailers and may cost more than
the baseline; only the overall recommendation is protected by the baseline.
For equal totals choose fewer retailers, then compare sorted
`(retailerId, productId, listingId)` assignments lexicographically in ASCII
order. Sort orders by retailer ID and lines by product ID. Recommend the baseline
when splitting gives no improvement. Changing basket lines or the retailer limit
invalidates an earlier result in the UI.

### Errors and readiness

| HTTP | `error.code` | Client action |
| --- | --- | --- |
| 400 | `invalid_request` | Fix input; `issues[].path` is a JSON Pointer into the body or decoded query |
| 404 | `not_found` | Resource/tuple is absent in the active dataset |
| 409 | `dataset_conflict` | Refresh catalogue and revalidate basket before retrying |
| 500 | `calculation_failed`, `internal_error` | Show retryable service failure |
| 503 | `dependency_unavailable`, `dataset_unavailable`, `capacity_exceeded` | Show retryable service failure |

Do not expose SQL, stack traces or credentials in public messages. For an invalid
click tuple use 404; never accept a client URL, timestamp or user identity. A
tracking failure cannot block the retailer link. Clicks measure link use, not
purchases.

Foundation readiness retains its existing real PostgreSQL query. The optional
`checks.activeDataset` field preserves the foundation response while #4 builds
the importer. **Before enabling shopper routes**, integration must supply this
check and make readiness unavailable when no validated dataset is readable.
This contract change does not implement the database check or claim dataset
readiness is already enforced.

## Pricing kernel (#8)

Implement `PricingKernel.priceLine` and `priceOrder` using the shared types.
Inputs are internal trusted-adapter records, not client-submitted prices. The
kernel still checks referential consistency, safe integer arithmetic, unique
lines/charge IDs and nonnegative net merchandise prices.

Initial scope is ordinary and unconditional sale prices. Multibuys, conditional
discounts and rounding-dependent percentage rules are not represented as
executable rules. Add those only after #4 supplies verified terms and the shared
contracts change. Preserve excluded-promotion notices. Raw Savings text and
descriptive original prices never trigger another discount. There is no current
date parameter; the approved dataset fixes pricing eligibility.

For each line:

```text
recordedPriceSubtotal = quantity × unitPriceCents
merchandiseSubtotal  = recordedPriceSubtotal − included item charges
lineTotal            = merchandiseSubtotal + all item charges
                     = recordedPriceSubtotal + added item charges
```

Charge rule amounts are **per purchased pack**, not per contained unit
(`ItemChargeRule.amountPerPackCents`). The adapter must normalise a verified
per-container deposit accordingly. The fixture has two 210-cent packs with
included 10-cent deposits and added 5-cent handling charges: recorded subtotal
420, merchandise 400, item charges 30, payable 430. Each response charge amount
(`AppliedItemCharge.amountCents`) is the **line total** for that charge.

Order rules are fixed fees with optional minimum-order and free-delivery
thresholds. A null threshold means verified absence of that constraint. Unknown
rules use `delivery.status: unavailable`; the result has no invented total.

Each threshold specifies before- or after-discount merchandise and which item
and fixed order charges count. Before-discount merchandise uses only the verified
`beforeDiscountMerchandiseUnitCents`; a missing required value returns
`missing_threshold_basis`. It is not inferred from a marketing original price.
Listed item-charge IDs select charges across the order; an absent charge on a
particular line contributes nothing. The adapter must verify that selectors are
known rule IDs, not misspellings. Fixed order-charge selectors must exist in the
rule. Delivery fees never contribute to either threshold in this initial model;
quarantine rules that require unsupported calculations.

Thresholds are inclusive: `actualCents >= requiredCents`. A failed minimum
returns `minimum_not_met` with no complete order total. Otherwise:

```text
order total = sum(line totals) + fixed order charges + applicable delivery fee
```

`OrderPricingResult.status: priced` requires a met or absent minimum. All offers,
the order and delivery rule must identify the same retailer; every offer must
use the order's exact dataset reference. Unavailable rules block that retailer's
complete-total calculation. They do not prove basket impossibility. Unexpected
invalid imports and overflow raise operational errors instead of zero totals.

## Executable examples and acceptance boundary

`fixtures.ts` supplies normal and empty catalogue/search responses, offers,
splitting savings, single-retailer fallback, missing baseline, unsuccessful
search, proven blockers, dataset conflicts, operational errors and invalid input.
Scenario dataset IDs differ where the underlying offer assumptions differ.
`orderPricingInputExample` and `orderPricingResultExample` provide a hand-calculated
740-cent order (430 line cost + 10 order charge + 300 delivery). `orderPricingCases`
provides nine input/expected-output pairs covering charge inclusion, 399/400
minimum spend, 499/500 free-delivery spend, unknown delivery fees, verified and
missing before-discount bases, and charge-inclusive thresholds.

`pnpm check` exercises these schemas and examples. These checks establish contract
compatibility and fixture consistency, not implemented search/pricing correctness,
real catalogue coverage, database integration, performance or curation approval.
#8 must run its actual kernel against independent boundary and clock-change tests;
#9 must test actual filtering/pagination and database-failure handling. #4 interface
alignment remains open until the data owner publishes its checkpoint.
