# CartOptix MVP product specification

**Status:** Agreed product requirements from the preliminary-report review and subsequent design and data interviews. Implementation has not yet been verified against these requirements.

This document and the [technical implementation specification](technical-implementation-spec.md) supersede `mvp-implementation-plan.md`. This document defines the product contract; the technical specification defines the delivery plan. Later decisions take precedence over the preliminary report, particularly for availability, collection dates and evaluation targets.

## 1. Purpose and product promise

CartOptix helps Singapore grocery shoppers compare the estimated cost of buying their entire basket from each of RedMart, FairPrice and Cold Storage, including supported promotions and delivery charges.

The MVP is free for shoppers. No subscription or shopper payment is required to use CartOptix; shoppers pay for their groceries on retailer websites.

The MVP must deliver a usable comparison service on AWS, demonstrate its performance and scaling behaviour under an explicit first-year traffic scenario, and gather shopper feedback. It compares all three single-retailer options exactly.

The promise is **the cheapest feasible complete-basket retailer option under the supported pricing rules and recorded dataset**. Every retailer is evaluated, and an unavailable option is shown with its reason rather than priced as a complete basket.

Transparency governs the interface: distinguish estimated costs from current checkout prices, observed data from assumptions, and unavailable retailer options from service failures. Retailer payments never influence eligibility or ranking.

## 2. Users, scope and terminology

Primary users are people who buy groceries online in Singapore and want to compare the cost of buying their complete basket from different retailers.

| Term | Meaning |
| --- | --- |
| Canonical product | A verified product identity shared by eligible retailer listings: same brand, variant, pack size and pack count, or equivalent identifying attributes for a non-food item. |
| Retailer listing | A particular retailer's purchasable listing, linked to a canonical product. |
| Basket line | One canonical product and the requested number of whole packs. |
| Retailer option | The complete basket priced at one retailer when every line has an eligible offer, its delivery rule is verified and the order meets its minimum; otherwise unavailable with a reason. A feasible option does not guarantee current stock or fulfilment. |
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

### J2 — Build a basket

1. Add, remove or change basket lines.
2. Review the snapshot disclaimer and each retailer's delivery rule.
3. Request a comparison.

The normal evaluation basket has 20 distinct lines. The supported maximum is **50 distinct lines**, with **1–20 whole packs per line**. Changing the basket makes an earlier comparison stale; the interface must request a new calculation before presenting it as current.

### J3 — Compare retailer options

Display an option for each of the three retailers. A retailer is feasible only when it has an eligible offer for every line, its delivery rule is verified and its order meets the minimum. Show other options as unavailable with reasons such as missing products, an unmet minimum or an unverified delivery rule. Recommend the cheapest feasible option; never rank a partial basket against a complete one.

Each feasible option shows:

- Products and quantities at that retailer.
- Product subtotals, supported promotions and omitted-promotion notices.
- Delivery charges and other modelled mandatory charges, itemised separately.
- Estimated total; other feasible options may show how much more they cost than the recommendation.

Break ties between equal totals in a stable, documented retailer order. Users choose which feasible option to follow.

### J4 — Follow the purchase plan

The shopper opens product links, rebuilds the chosen retailer's basket and completes checkout on its website. CartOptix does not transfer carts, accept payments, reserve stock or coordinate delivery slots.

Record lightweight outbound-click events for usage evaluation. A tracking failure must not block navigation. Clicks are not commercial billing or purchase-conversion events.

### J5 — Understand an unsuccessful comparison

| Situation | Required behaviour |
| --- | --- |
| Empty basket or invalid input | Explain what must change; do not run a misleading comparison. |
| Some retailers unavailable | Show each unavailable retailer and its reason alongside any feasible complete-basket options. |
| No retailer can fulfil the complete basket | Show **“No feasible purchasing plan available”** with each retailer's reason; the shopper changes the basket themselves. |
| Calculation or service failure | Show a retryable error distinct from a valid business outcome. |

Never price a partial basket as complete or rank it against complete options. Changing the basket is the shopper's decision.

## 4. Product rules and constraints

### PR-01 — Exact products and quantities

Each complete-basket option places every line with the same retailer. Do not divide a line's quantity across retailers, substitute brands or pack configurations, add products, or buy extra units to reach a promotion or delivery threshold. Similar names and equivalent total volume alone do not establish an exact match.

### PR-02 — Curated eligibility and availability

Use the source `in-stock = Yes` flag for the real snapshot comparison; exclude `No` offers. Do not overwrite observed unavailability to make a plan feasible. The flag is a snapshot observation, not verification of current availability or sufficient stock for the requested quantity. The MVP does not model stock counts.

Product mappings may be decided with AI assistance. As a proof of concept, publish only matches the AI confirms with high confidence and that agree with the name rules; exclude the rest rather than reviewing them by hand. Manual match review is out of scope. Treat a listing as directly fulfilled unless the evidence clearly shows otherwise, remove it only then, and record this as a known limitation. Quarantine unresolved contradictions rather than letting either the title or specification automatically win. Preserve source references and correction reasons. Synthetic fixtures are for development and tests only; never present them as retailer data.

### PR-03 — Supported pricing and promotions

Start with ordinary prices and clearly unconditional sale prices. Support same-product multibuys only for selected listings whose terms can be verified and encoded, including eligible quantity, repetition limits and the price of remaining packs.

Multibuy support is optional for the initial MVP, not a release blocker. If reliable terms cannot be recovered within the project's effort budget, proceed with verified ordinary and unconditional sale prices and disclose the excluded promotions. The MVP takes this route: it applies no multibuys, and records them as excluded promotions.

Raw promotion descriptions are evidence, not executable rules. Do not automatically subtract a `Savings` amount from a price that may already include the discount. Do not infer unrestricted repetition or same-product eligibility from “Any N” wording.

When promotion conditions are unresolved, use a verified ordinary price if available and disclose that an additional promotion is excluded. If no reliable applicable price exists, exclude the offer. Cross-product promotions, memberships, vouchers, payment-method discounts and gifts are outside the calculation scope.

Approved promotion rules are fixed in the committed seed. Calculations do not re-evaluate them against the current date, so the same basket and seed retain the same pricing rules as the calendar advances. Curate dated promotions only when evidence establishes that they belong in the recorded scenario; otherwise exclude the promotion and apply the reliable-price fallback above. Preserve captured validity terms internally without inventing a collection date. Changes to approved rules are made by editing the seed. The fixed-dataset disclaimer applies to these promotions as well as prices and availability.

### PR-04 — Delivery and mandatory charges

Use one documented Singapore delivery scenario: a declared serviceable location, standard delivery assumptions and non-member pricing. There is no shopper postcode or delivery-slot selector in the MVP.

Maintain each retailer's delivery fee, free-delivery threshold, minimum-order value, threshold spending basis and relevant mandatory charges. Apply actual verified rules for the selected scenario; do not assume every retailer uses the same pre-/post-discount basis. Record verification evidence internally.

BCRS container deposits are not modelled in the MVP. The same 10¢ per container applies at every retailer, so it cannot change which option wins; `[BCRS]` listings stay eligible, and the comparison notes that totals exclude the refundable deposit. If a mandatory charge is modelled later, itemise it without double-counting a charge already included in the recorded price, and exclude affected listings while its treatment remains unresolved. An unverified delivery rule makes the retailer unavailable; unknown delivery charges must never silently become zero.

### PR-05 — Recommendation integrity

All monetary calculations use integer SGD cents. Calculate the complete basket independently at each retailer, with the same pricing rules as product comparison, including product costs, supported promotions, delivery fees and thresholds, minimum orders and mandatory order charges. Recommend the cheapest feasible option, with ties resolved as in J3.

Validate every returned complete option and explain each unavailable retailer. Retailer participation, commissions and click revenue do not influence recommendations.

### PR-06 — Snapshot disclosure and seed data

Do **not** display collection dates on the website. Display this notice near comparisons:

> Prototype using a fixed retailer dataset. Prices and availability may have changed. Confirm details on the retailer's website.

Keep one cleaned seed in the repository; it evolves through Git, which is its version history. Source provenance supports repeatable calculations and is not presented as collection dates. Freeze evaluation data on a best-effort basis.

### PR-07 — Usage measurement

Collect outbound-click events with retailer, listing/product and timestamp, without collecting user identities for this feature. These events measure use of links, not fulfilled purchases, unique buyers or billable clicks.

## 5. Success criteria

| ID | Criterion | Required evidence |
| --- | --- | --- |
| SC-01 | Shoppers can complete J1–J5 on the deployed service. | End-to-end checks covering valid and unsuccessful journeys; usable mobile layout and keyboard controls. |
| SC-02 | Published data follows PR-01–PR-04 and the seed requirements of PR-06. | Curation records, import validation, and catalogue size and overlap report. |
| SC-03 | Returned options obey quantities, prices and order constraints. | Reference calculations, boundary tests and complete-basket validation; the recommendation is the cheapest feasible option. |
| SC-04 | Comparison results and unavailability reasons are correct for all three retailers. | Constructed and real-seed baskets checking exact totals, recommendation, ties and each retailer's reason when unavailable. |
| SC-05 | Catalogue/search p99 is below 1 second and basket comparison p99 below 2 seconds at declared normal and surge loads. | Endpoint and mixed-workload results, with separate 20-line and 50-line basket results and test configuration. Product-offer latency is reported; no separate numeric target was agreed for it. |
| SC-06 | Unexpected failures are at most 0.1% at the declared normal and surge loads. | Request outcomes including timeouts, connection failures, server errors and capacity-related rejections. Correctly rejected invalid inputs are excluded. |
| SC-07 | AWS elasticity and application-instance fault tolerance are demonstrated. | Automatic scale-out and continued service after terminating one application instance; observations and recovery behaviour reported. |
| SC-08 | Shopper evaluation tests understanding and perceived usefulness. | Findings on comparison comprehension, assumptions and whether price differences justify rebuilding a retailer cart, including negative feedback. |
| SC-09 | The project documents its costs and closes resources on schedule. | Project spend, separate BAU estimate, cloud/on-premise comparison and teardown record. |

Performance is distinct from availability. The prospective BAU **request-success SLO is 99.9% per day**, not a contractual SLA or a time-based uptime guarantee. A short load test does not establish long-term availability. Report observed prototype request success separately; report deliberate overload and fault injection separately from normal/surge acceptance runs.

For requirement traceability, SC-03/SC-04 verify PR-05 comparison correctness and recommendation integrity. SC-01/SC-02 verify PR-06 disclosures and versioned-data evidence. SC-01 includes PR-07 click recording and navigation when tracking fails.

### Shopper study

Retain the preliminary report's target of **10–15 people who regularly shop for groceries online**. Use realistic basket-comparison tasks and interviews/questionnaires to assess ease of use, clarity, trust, usefulness and willingness to use the app. Include the effort of rebuilding retailer carts in the discussion or task. Gather open-ended feedback and record whether assumptions are understood.

The study validates the idea and informs small MVP adjustments and longer-term recommendations. It does not substantially redefine the deliverables. Reported interest is not demonstrated adoption. Select representative evaluation baskets independently of those yielding the largest price differences; report equal-cost outcomes and coverage gaps.

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

Live price/availability checks, scheduled refresh, partner APIs, stock reservations, substitutions, alternative pack-size fulfilment, cross-product promotions, splitting a basket across retailers, splitting one line across retailers, extra purchases to qualify for discounts, accounts, cross-device saved baskets and integrated checkout are outside scope.

Pay-per-click partnerships, affiliate conversion tracking and cashback remain commercial hypotheses or future work. Lightweight click recording is included; commercial billing, attribution and fraud controls are not. Database failover and a demonstrated long-term BAU SLO are not claims of the Single-AZ prototype.

The intended commercial progression is to explore retailer-funded pay-per-click partnerships first, then purchase-based affiliate commissions, and potentially return part of those commissions to shoppers as cashback. This is a proposed business model, not evidence of partner agreements or an MVP implementation commitment. It does not change recommendation independence.

## 8. Evidence still required

The raw files have been profiled, but listing eligibility, exact matches and promotion terms have not been fully verified. The project must still establish a reliable curated catalogue, price the complete AWS configuration and measure comparison correctness and system capacity. Record shortfalls and revisit affected decisions instead of presenting these targets as achieved results.
