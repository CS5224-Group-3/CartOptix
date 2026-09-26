# CartOptix MVP product specification

**Status:** Agreed product requirements from the preliminary-report review and subsequent design and data interviews. Implementation has not yet been verified against these requirements.

This document and the [technical implementation specification](technical-implementation-spec.md) supersede `mvp-implementation-plan.md`. This document defines the product contract; the technical specification defines the delivery plan. Later interview decisions take precedence over the preliminary report, particularly for availability, collection dates, optimisation guarantees and evaluation targets.

## 1. Purpose and product promise

CartOptix helps Singapore grocery shoppers compare the estimated cost of an entire basket across RedMart, FairPrice and Cold Storage, including supported promotions and delivery charges. Shoppers can compare buying from one supermarket with splitting different products across supermarkets.

The MVP is free for shoppers. No subscription or shopper payment is required to use CartOptix; shoppers pay for their groceries on retailer websites.

The MVP must deliver a usable comparison service on AWS, demonstrate its performance and scaling behaviour under an explicit first-year traffic scenario, and gather shopper feedback. It does not need to prove that every recommendation is mathematically optimal.

The promise is **the best valid plan found under the supported pricing rules, recorded dataset and shopper's retailer limit**. When a complete single-retailer option exists, the recommendation must cost no more than the cheapest such option under the same rules. Some baskets will have no benefit from splitting; that is a valid result.

Transparency governs the interface: distinguish estimated costs from current checkout prices, observed data from assumptions, and unsuccessful search from proven impossibility. Retailer payments never influence eligibility or ranking.

## 2. Users, scope and terminology

Primary users are people who buy groceries online in Singapore and want to know whether potential savings justify additional orders and delivery arrangements.

| Term | Meaning |
| --- | --- |
| Canonical product | A verified product identity shared by eligible retailer listings: same brand, variant, pack size and pack count, or equivalent identifying attributes for a non-food item. |
| Retailer listing | A particular retailer's purchasable listing, linked to a canonical product. |
| Basket line | One canonical product and the requested number of whole packs. |
| Complete plan | Every requested line is assigned in full to an eligible retailer, with all modelled order constraints met. This does not guarantee current stock or fulfilment. |
| Single-retailer baseline | The cheapest feasible complete plan using one retailer, calculated with the same dataset and pricing rules as split plans. |
| Eligible offer | A listing approved for the curated dataset with usable pricing, direct supermarket fulfilment and an in-stock source flag. A listing counts as directly fulfilled unless evidence shows otherwise (PR-02). |
| BAU | The prospective business-as-usual service. Its demand and cost estimates are planning assumptions, not demonstrated adoption. |

### Catalogue boundary

The catalogue targets **200–300 canonical products** across these eight categories:

1. Rice & Noodles
2. Drinks
3. Dairy
4. Breakfast Foods
5. Canned & Packaged Food
6. Snacks
7. Household Cleaning
8. Toiletries & Personal Care

Data quality takes precedence over catalogue size. At least **70% of published canonical products should have eligible offers from two or more retailers**. This is a provisional usefulness target; report actual coverage and any shortfall. Do not weaken matching standards or require every product to exist at all three retailers. Retain some single-retailer products to represent coverage gaps.

Only **direct supermarket fulfilment** is in scope. Third-party sellers and separate delivery arrangements are excluded even when their products belong to the selected categories.

## 3. High-level user journeys

These journeys define required steps, on-screen content, states and a small set of binding UX rules. They deliberately leave screen and page structure, navigation model, visual design, component-level interaction and detailed accessibility treatment (beyond keyboard operability) as implementation decisions. Implementers must satisfy the stated content and rules; the shopper study (SC-08) evaluates whether the resulting design is clear and usable, rather than checking it against an upfront visual specification.

### J1 — Find and compare a product

1. Browse categories or search the curated catalogue.
2. Select a specific product and pack configuration.
3. Compare eligible retailer offers for the selected quantity, showing product costs before delivery.
4. Read supported promotion explanations and any notice that an additional promotion was excluded.
5. Add the product and quantity to the basket.

Names, pack information and prices must be clear enough to avoid confusing unit prices with the amount payable for the requested packs. Image failure must not prevent product selection.

### J2 — Build a basket and set purchasing preferences

1. Add, remove or change basket lines.
2. Choose a maximum of one, two or three retailers.
3. Review the declared delivery scenario and snapshot disclaimer.
4. Request a comparison.

The normal evaluation basket has 20 distinct lines. The supported maximum is **50 distinct lines**, with **1–20 whole packs per line**. Changing the basket or retailer limit makes an earlier comparison stale; the interface must request a new calculation before presenting it as current.

### J3 — Compare purchasing plans

Display the cheapest feasible complete single-retailer plan and the best-found permitted split plan when each exists. Highlight the overall best-found plan. If splitting provides no improvement, recommend a single retailer. Do not invent a split option or savings when none was found.

Each plan shows:

- Products, quantities and the retailer assigned to each line.
- Product subtotals, supported promotions and omitted-promotion notices.
- Delivery charges and other modelled mandatory charges, itemised separately.
- Estimated total, number of retailer orders and calculation status.
- Estimated savings against the single-retailer baseline, when that baseline exists.

Tie-break equal totals by fewer retailers, followed by a stable ordering. Users choose between plans; the MVP imposes no minimum-saving threshold for another order.

### J4 — Follow the purchase plan

The shopper opens product links, rebuilds the retailer baskets and completes checkout on retailer websites. CartOptix does not transfer carts, accept payments, reserve stock or coordinate delivery slots.

Record lightweight outbound-click events for usage evaluation. A tracking failure must not block navigation. Clicks are not commercial billing or purchase-conversion events.

### J5 — Understand an unsuccessful comparison

| Situation | Required behaviour |
| --- | --- |
| Empty basket or invalid input | Explain what must change; do not run a misleading comparison. |
| No complete single-retailer option | Show a valid split plan if found; mark the single-retailer baseline and savings as unavailable. |
| Proven impossible under the supported model | Explain the established blocker without omitting products or changing preferences. |
| Search finds no valid plan within its limits | Say **“No valid plan found”**; do not claim impossibility. |
| Search limit reached with a valid candidate | Show **“Best plan found”** with its status and full breakdown. |
| Calculation or service failure | Show a retryable error distinct from a valid business outcome. |

Partial baskets must not compete with complete baskets on price. Changing the retailer limit or basket is always the shopper's decision.

## 4. Product rules and constraints

### PR-01 — Exact products and quantities

Each line goes entirely to one retailer. Do not divide its quantity across retailers, substitute brands or pack configurations, add products, or buy extra units to reach a promotion or delivery threshold. Similar names and equivalent total volume alone do not establish an exact match.

### PR-02 — Curated eligibility and availability

Use the source `in-stock = Yes` flag for the real snapshot comparison; exclude `No` offers. Do not overwrite observed unavailability to make a plan feasible. The flag is a snapshot observation, not verification of current availability or sufficient stock for the requested quantity. The MVP does not model stock counts.

Product mappings may be decided with AI assistance. A person reviews every case where the proposed match disagrees with the name rules, and someone who did not produce the matches checks a random sample of published mappings; report the sample size and error rate. Treat a listing as directly fulfilled unless the evidence clearly shows otherwise, remove it only then, and record this as a known limitation. Quarantine unresolved contradictions rather than letting either the title or specification automatically win. Preserve source references and correction reasons. If synthetic fixtures are used for development or demonstrations, distinguish them from the real curated dataset.

### PR-03 — Supported pricing and promotions

Start with ordinary prices and clearly unconditional sale prices. Support same-product multibuys only for selected listings whose terms can be verified and encoded, including eligible quantity, repetition limits and the price of remaining packs.

Multibuy support is optional for the initial MVP, not a release blocker. If reliable terms cannot be recovered within the project's effort budget, proceed with verified ordinary and unconditional sale prices and disclose the excluded promotions. The MVP takes this route: it applies no multibuys, and records them as excluded promotions.

Raw promotion descriptions are evidence, not executable rules. Do not automatically subtract a `Savings` amount from a price that may already include the discount. Do not infer unrestricted repetition or same-product eligibility from “Any N” wording.

When promotion conditions are unresolved, use a verified ordinary price if available and disclose that an additional promotion is excluded. If no reliable applicable price exists, exclude the offer. Cross-product promotions, memberships, vouchers, payment-method discounts and gifts are outside the calculation scope.

Approved promotion rules are fixed within each seed version. Calculations do not re-evaluate them against the current date, so the same basket and seed retain the same pricing rules as the calendar advances. Curate dated promotions only when evidence establishes that they belong in the recorded scenario; otherwise exclude the promotion and apply the reliable-price fallback above. Preserve captured validity terms internally without inventing a collection date. Changes to approved rules require a new seed version. The fixed-dataset disclaimer applies to these promotions as well as prices and availability.

### PR-04 — Delivery and mandatory charges

Use one documented Singapore delivery scenario: a declared serviceable location, standard delivery assumptions and non-member pricing. There is no shopper postcode or delivery-slot selector in the MVP.

Maintain each retailer's delivery fee, free-delivery threshold, minimum-order value, threshold spending basis and relevant mandatory charges. Apply actual verified rules for the selected scenario; do not assume every retailer uses the same pre-/post-discount basis. Record verification evidence internally.

BCRS container deposits are not modelled in the MVP. The same 10¢ per container applies at every retailer, so it cannot change which plan wins; `[BCRS]` listings stay eligible, and the comparison notes that totals exclude the refundable deposit. If a mandatory charge is modelled later, itemise it without double-counting a charge already included in the recorded price, and exclude affected listings while its treatment remains unresolved. Unknown delivery charges must never silently become zero or support a complete-total savings claim.

### PR-05 — Recommendation integrity

All monetary calculations use integer SGD cents. Evaluate complete single-retailer candidates independently, retain the cheapest feasible baseline, and never recommend a more expensive plan when it exists. Estimated savings equal the baseline total minus the recommended total; savings are unavailable when there is no baseline.

The optimiser may use a heuristic. It must validate every returned assignment and distinguish a proven blocker from failure to discover a solution. Retailer participation, commissions and click revenue do not influence recommendations.

### PR-06 — Snapshot disclosure and seed versioning

Do **not** display collection dates on the website. Display this notice near comparisons:

> Prototype using a fixed retailer dataset. Prices and availability may have changed. Confirm details on the retailer's website.

Keep a cleaned, version-controlled seed dataset in the repository. Internal dataset identifiers and source provenance support repeatable calculations; they are not presented as collection dates. Freeze evaluation data on a best-effort basis. Record the seed version used for reported evaluations and rerun affected checks where practical after material corrections.

### PR-07 — Usage measurement

Collect outbound-click events with retailer, listing/product, timestamp and dataset identifier, without collecting user identities for this feature. These events measure use of links, not fulfilled purchases, unique buyers or billable clicks.

## 5. Success criteria

| ID | Criterion | Required evidence |
| --- | --- | --- |
| SC-01 | Shoppers can complete J1–J5 on the deployed service. | End-to-end checks covering valid and unsuccessful journeys; usable mobile layout and keyboard controls. |
| SC-02 | Published data follows PR-01–PR-04 and the seed-versioning requirements of PR-06. | Curation records, import validation, independently checked mapping sample, catalogue size and overlap report, and recorded seed revision/checksum. |
| SC-03 | Returned plans obey quantities, retailer limits, prices and order constraints. | Reference calculations, boundary tests and assignment validation; no recommendation worse than an available baseline. |
| SC-04 | The heuristic finds useful savings in constructed cases and its limitations are measured. | Known splitting/no-splitting cases; small exhaustive-search references with missed-savings and cost-gap results. No blanket optimum claim. |
| SC-05 | Catalogue/search p99 is below 1 second and basket comparison p99 below 2 seconds at declared normal and surge loads. | Endpoint and mixed-workload results, with separate 20-line and 50-line basket results and test configuration. Product-offer latency is reported; no separate numeric target was agreed for it. |
| SC-06 | Unexpected failures are at most 0.1% at the declared normal and surge loads. | Request outcomes including timeouts, connection failures, server errors and capacity-related rejections. Correctly rejected invalid inputs are excluded. |
| SC-07 | AWS elasticity and application-instance fault tolerance are demonstrated. | Automatic scale-out and continued service after terminating one application instance; observations and recovery behaviour reported. |
| SC-08 | Shopper evaluation tests understanding and perceived usefulness. | Findings on comparison comprehension, assumptions and whether savings justify rebuilding carts and placing multiple orders, including negative feedback. |
| SC-09 | The project documents its costs and closes resources on schedule. | Project spend, separate BAU estimate, cloud/on-premise comparison and teardown record. |

Performance is distinct from availability. The prospective BAU **request-success SLO is 99.9% per day**, not a contractual SLA or a time-based uptime guarantee. A short load test does not establish long-term availability. Report observed prototype request success separately; report deliberate overload and fault injection separately from normal/surge acceptance runs.

For requirement traceability, SC-03/SC-04 verify PR-05 recommendation integrity. SC-01/SC-02 verify PR-06 disclosures and versioned-data evidence. SC-01 includes PR-07 click recording and navigation when tracking fails.

### Shopper study

Retain the preliminary report's target of **10–15 people who regularly shop for groceries online**. Use realistic basket-comparison tasks and interviews/questionnaires to assess ease of use, clarity, trust, usefulness and willingness to use the app. Include the effort of rebuilding retailer carts in the discussion or task. Gather open-ended feedback and record whether assumptions are understood.

The study validates the idea and informs small MVP adjustments and longer-term recommendations. It does not substantially redefine the deliverables. Reported interest is not demonstrated adoption. Select representative evaluation baskets independently of the products yielding the greatest savings; report zero-saving outcomes and coverage gaps.

## 6. Deployment and planning constraints

- AWS Singapore (`ap-southeast-1`); eight-week project operating envelope of approximately **SGD 84**, averaging SGD 1.50/day before credits and including the planned load-test day.
- For most development, use one `t4g.micro` EC2 instance hosting the application and PostgreSQL.
- For the presentation configuration, use ALB, an EC2 Auto Scaling Group and Single-AZ `db.t4g.micro` RDS PostgreSQL. Plan for two baseline application instances and a maximum of three, subject to costing.
- The presentation window can shrink from 2–3 weeks to **five days** to fit the budget. If that is still unaffordable, explicitly revisit cost or scope rather than silently drop a demonstration requirement.
- Allow one day for the main load-testing exercise. Prepare scripts, data and local checks beforehand.
- Shut down project services by **13 November 2026**, coordinating the final presentation before teardown.
- Estimate continuously operating BAU costs separately; temporary development shutdowns are not evidence of affordable continuous service.

The first-year planning scenario is 1,000 daily active shoppers, two sessions per day, 20% of sessions starting in the busiest hour, and a fivefold surge. These are assumptions, not market evidence. The agreed endpoint-RPS workload is specified in the technical document; the project will not simulate complete shopper sessions for load generation.

## 7. Outside the MVP

Live price/availability checks, scheduled refresh, partner APIs, stock reservations, substitutions, alternative pack-size fulfilment, cross-product promotions, splitting one line across retailers, extra purchases to qualify for discounts, accounts, cross-device saved baskets and integrated checkout are outside scope.

Pay-per-click partnerships, affiliate conversion tracking and cashback remain commercial hypotheses or future work. Lightweight click recording is included; commercial billing, attribution and fraud controls are not. Database failover and a demonstrated long-term BAU SLO are not claims of the Single-AZ prototype.

The intended commercial progression is to explore retailer-funded pay-per-click partnerships first, then purchase-based affiliate commissions, and potentially return part of those commissions to shoppers as cashback. This is a proposed business model, not evidence of partner agreements or an MVP implementation commitment. It does not change recommendation independence.

## 8. Evidence still required

The raw files have been profiled, but listing eligibility, exact matches and promotion terms have not been fully verified. The project must still establish a reliable curated catalogue, price the complete AWS configuration and measure heuristic quality and system capacity. Record shortfalls and revisit affected decisions instead of presenting these targets as achieved results.
