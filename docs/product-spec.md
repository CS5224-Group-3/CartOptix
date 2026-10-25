# CartOptix MVP product specification

**Status:** Agreed product requirements from the preliminary-report review and subsequent design and data interviews. Implementation has not yet been verified against these requirements.

This document and the [technical implementation specification](technical-implementation-spec.md) supersede `mvp-implementation-plan.md`. This document defines the product contract; the technical specification defines the delivery plan. Later decisions take precedence over the preliminary report, particularly for availability, collection dates and evaluation targets.

## 1. Purpose and product promise

CartOptix helps Singapore grocery shoppers compare the estimated cost of buying their entire basket from each of RedMart, FairPrice and Cold Storage, including supported promotions and delivery charges.

The MVP is free for shoppers. No subscription or shopper payment is required to use CartOptix; shoppers pay for their groceries on retailer websites.

The MVP must deliver a usable comparison service on AWS, demonstrate its performance and scaling behaviour under an explicit first-year traffic scenario, and gather shopper feedback. It compares all three single-retailer options exactly.

This is an MVP built to ship fast: it must be good enough to demonstrate the business idea running on the cloud. Formal assurance, exact reproducibility and traceability beyond what the demonstration and evaluation need are out of scope.

The promise is **the cheapest feasible complete-basket retailer option under the supported pricing rules and recorded dataset**. Every retailer is evaluated, and an unavailable option is shown with its reason rather than priced as a complete basket.

Transparency governs the interface: distinguish estimated costs from current checkout prices, observed data from assumptions, and unavailable retailer options from service failures. Retailer payments never influence eligibility or ranking.

## 2. Users, scope and terminology

Primary users are people who buy groceries online in Singapore and want to compare the cost of buying their complete basket from different retailers.

| Term | Meaning |
| --- | --- |
| Canonical product | A verified product identity shared by eligible retailer listings: same brand, variant, pack size and pack count, or equivalent identifying attributes for a non-food item. |
| Retailer listing | A particular retailer's purchasable listing, linked to a canonical product. |
| Basket line | One canonical product and the requested number of whole packs. |
| Retailer option | The complete basket priced at one retailer when every line has an eligible offer, its delivery rule is verified and the order meets its minimum; otherwise unavailable with a reason, and with an estimate of checking out the lines it can supply where there is one (J3). A feasible option does not guarantee current stock or fulfilment. |
| Eligible offer | A listing approved for the curated dataset with usable pricing and an in-stock source flag; direct supermarket fulfilment is required except that RedMart storefront membership qualifies regardless of seller (PR-02). |
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

Data quality takes precedence over catalogue size. At least **70% of published canonical products should have eligible offers from two or more retailers**. This is a provisional usefulness target; report actual coverage and any shortfall. Do not weaken matching standards or require every product to exist at all three retailers. Publish a product only when two or more retailers have an eligible listing, because a product sold at one retailer gives nothing to compare; one that falls below that in a refresh leaves the catalogue and keeps its ID for when it returns.

Only supermarket listings are in scope. For RedMart, listings displayed within the RedMart storefront qualify regardless of the "Sold by" seller; ordinary Lazada marketplace listings outside that storefront do not. Storefront membership is the MVP eligibility criterion, not independent proof of fulfilment. Other retailers retain the direct-supermarket-fulfilment rule. Exact identity, stock and price requirements still apply.

## 3. High-level user journeys

These journeys define required steps, on-screen content, states and a small set of binding UX rules. They deliberately leave screen and page structure, navigation model, visual design, component-level interaction and detailed accessibility treatment (beyond keyboard operability) as implementation decisions. Implementers must satisfy the stated content and rules; the shopper study (SC-08) evaluates whether the resulting design is clear and usable, rather than checking it against an upfront visual specification.

### J1 — Find and compare a product

1. Browse categories or search the curated catalogue.
2. Select a specific product and pack configuration.
3. Compare eligible retailer offers for the selected quantity, showing product costs before delivery.
4. Read supported promotion explanations and any notice that an additional promotion was excluded.
5. Add the product and quantity to the basket.

Adding from product details keeps the shopper on that page, confirms the addition,
and provides a View basket link. The home route opens the catalogue; there is no
separate promotional landing page or shopper-facing demo scenario selector.

Names, pack information and prices must be clear enough to avoid confusing unit prices with the amount payable for the requested packs. Image failure must not prevent product selection.
Products retained in the canonical catalogue without a published eligible listing remain visible for discovery, but are marked unavailable and cannot be added to the basket.
Catalogue search is case- and whitespace-insensitive substring matching across the shopper-facing product name (including brand and variant, without the `[BCRS]` marker) and the pack-size text of the product's listings. `%`, `_`, and `\` are ordinary search characters, not wildcards.

### J2 — Build a basket

1. Add, remove or change basket lines.
2. Review the selected products and quantities; comparison results show each retailer's delivery rule and the dataset notice.
3. Request a comparison.

The normal evaluation basket has 20 distinct lines. The supported maximum is **50 distinct lines**, with **1–20 whole packs per line**. Changing the basket makes an earlier comparison stale; the interface must request a new calculation before presenting it as current.

### J3 — Compare retailer options

Display an option for each of the three retailers. A retailer is feasible only when it has an eligible offer for every line, its delivery rule is verified and its order meets the minimum. Show other options as unavailable with reasons such as missing products, an unmet minimum or an unverified delivery rule. Recommend the cheapest feasible option; never rank a partial basket against a complete one.

An unavailable option also shows what checking out the lines that retailer can supply would cost, as the shopper would pay it: those lines with their promotions, and the delivery fee and order charges for that spend. It is labelled as an incomplete basket with an "Estimated total for N of M items" (counting distinct lines), lists each missing product with its name, image and pack size and a link to its product page, and warns when that spend is below the retailer's minimum order ("S$X more needed"). A complete basket below the minimum gets the same estimate, labelled "Estimated total", and warning. There is no estimate when the retailer can supply none of the basket or its delivery rule is unverified. Unavailable options come after every complete option, fewest missing products first, then by retailer; they are never recommended or compared with the recommendation.

Each feasible option shows:

- Products and quantities at that retailer.
- Product subtotals, supported promotions and omitted-promotion notices.
- Delivery charges and other modelled mandatory charges, itemised separately.
- Estimated total; other feasible options may show how much more they cost than the recommendation.

Break ties between equal totals in a stable, documented retailer order (the technical specification uses retailer ID). Users choose which feasible option to follow.

### J4 — Follow the purchase plan

The shopper opens product links, rebuilds the chosen retailer's basket and completes checkout on its website. CartOptix does not transfer carts, accept payments, reserve stock or coordinate delivery slots.

Record lightweight outbound-click events for usage evaluation. A tracking failure must not block navigation. Clicks are not commercial billing or purchase-conversion events.

### J5 — Understand an unsuccessful comparison

| Situation | Required behaviour |
| --- | --- |
| Empty basket or invalid input | Explain what must change; do not run a misleading comparison. |
| Some retailers unavailable | Show each unavailable retailer, its reason and its incomplete-basket estimate (J3) after any feasible complete-basket options. |
| No retailer can fulfil the complete basket | Show **“No feasible purchasing plan available”** above each retailer's reason and incomplete-basket estimate; the shopper changes the basket themselves. |
| Calculation or service failure | Show a retryable error distinct from a valid business outcome. |

Never present a partial basket as complete, rank it against complete options or recommend it; a clearly labelled estimate of it is allowed (J3). Changing the basket is the shopper's decision.

## 4. Product rules and constraints

### PR-01 — Exact products and quantities

Each complete-basket option places every line with the same retailer; an incomplete-basket estimate (J3) prices only the lines that retailer has, at their requested quantities, and is never presented as complete. Do not divide a line's quantity across retailers, substitute brands or pack configurations, add products, or buy extra units to reach a promotion or delivery threshold. Similar names and equivalent total volume alone do not establish an exact match.

### PR-02 — Curated eligibility and availability

Use the source `in-stock = Yes` flag for the real snapshot comparison; exclude `No` offers. Do not overwrite observed unavailability to make a plan feasible. The flag is a snapshot observation, not verification of current availability or sufficient stock for the requested quantity. The MVP does not model stock counts.

Each snapshot refresh reads every published listing again and searches the retailers a product is missing from. A refresh never fills a missing or failed observation with an earlier one. The one exception to reading every listing: when a retailer keeps showing an anti-bot check, the engineer may cap the checks a run accepts; listings left unread then are skipped, not published, so their products publish only if two other retailers have them. For RedMart, where Lazada's checks make reading every page impractical, the product owner has also accepted carrying its published listings over from the previous seed: each keeps its recorded price and deal wording, with the current curation rules applied, and searching only for the RedMart listings the catalogue is missing; the report counts carried-over listings, and the fixed-dataset disclaimer covers their older prices.

Product mappings may be decided with AI assistance. As a proof of concept, publish only matches the AI confirms with high confidence and that agree with the name rules; exclude the rest rather than reviewing them by hand. Manual match review is out of scope, except that the product owner may confirm a specific match the AI was unsure of, recorded in the snapshot's match decisions with the reason (as for the Ayam Brand sardines at RedMart in #73). Treat a listing as directly fulfilled unless the evidence clearly shows otherwise, remove it only then, and record this as a known limitation. For RedMart, use the storefront criterion above instead: retain "Sold by" as provenance, but neither a third-party seller nor an unreadable seller excludes a RedMart storefront listing. Quarantine unresolved contradictions rather than letting either the title or specification automatically win. Preserve source references and correction reasons. Synthetic data is for development and tests.

Automated RedMart collection requires its storefront's `price_grocer` data for the linked SKU and searches the RedMart-restricted catalogue (`m=redmart`). Manual observations must come from the RedMart storefront (RedMart header/search and product branding), not merely a Lazada URL or the global RedMart navigation link. No per-listing fulfilment exception is needed.

### PR-03 — Supported pricing and promotions

Use ordinary prices and clearly unconditional sale prices. Show an unconditional sale's original price struck through beside the price paid, so shoppers can see the discount. It is for display only and never changes a total.

Apply same-product multibuys: deals of the form "N at $X", "N save $X", "N save X%" and "Buy N get X% off". Curation turns each into a deal of N packs for one price; a percentage comes off N packs at the unit price and is rounded half-up to the cent. Pricing then follows these rules:

1. A deal applies floor(quantity ÷ N) times. Remaining packs are charged at the unit price.
2. A deal applies only when it is cheaper than its packs at the unit price, and never stacks with another discount.
3. A deal counts packs of its own product only. When the retailer's wording is "Any N", other products may also qualify; CartOptix does not combine basket lines, and tells the shopper that mixing items may save more.
4. Never add packs to reach a deal (PR-01). The product page may tell the shopper what a deal needs, for example "Buy 2 for S$6.55".

Raw promotion descriptions are evidence, not executable rules. Do not automatically subtract a `Savings` amount from a price that may already include the discount.

Other promotions stay out of the estimate and are shown as the retailer worded them, with a note that they are not included. Cross-product promotions, spend thresholds, memberships, vouchers, payment-method discounts and gifts are outside the calculation scope. If no reliable applicable price exists, exclude the offer.

Promotions have no date handling. Curation strips validity wording and does not record or evaluate dates. Every approved deal in a snapshot applies while that snapshot is the seed, and changes only when the seed is replaced. The fixed-dataset disclaimer applies to these promotions as well as prices and availability.

Before a snapshot ships, check about ten deals per retailer against the live checkout, recording the quantities and the expected and observed amounts. A fixed-price deal must match the checkout exactly; a deal type whose checkout disagrees stays excluded. A percentage deal is an estimate, because the retailer charges a fixed deal price and the percentage is its rounded label: in the first snapshot, RedMart's "Any 2 Save 40%" charged $11.79 for $19.78, 40.4% off (`data/snapshot/checkout-evidence.md`). It must be within 0.5% of the deal's packs at the unit price, per deal. It is still applied, because leaving it out overstates the price by the whole saving and can recommend the wrong retailer. The shopper sees the retailer's percentage wording, not a computed deal price, and is told the checkout may differ by a few cents.

### PR-04 — Delivery and mandatory charges

Use one documented Singapore delivery scenario: a declared serviceable location, standard delivery assumptions and non-member pricing. There is no shopper postcode or delivery-slot selector in the MVP.

Maintain each retailer's delivery fee, free-delivery threshold, minimum-order value, threshold spending basis and relevant mandatory charges. Apply actual verified rules for the selected scenario; do not assume every retailer uses the same pre-/post-discount basis. Record verification evidence internally. A verified rule must include a non-empty explanatory note; missing verification evidence is an unavailable rule.

BCRS container deposits are not modelled in the MVP. The same 10¢ per container applies at every retailer, so it cannot change which option wins; `[BCRS]` listings stay eligible, the API removes the marker from shopper-facing product names, and the comparison notes that totals exclude the refundable deposit. If a mandatory charge is modelled later, itemise it without double-counting a charge already included in the recorded price, and exclude affected listings while its treatment remains unresolved. An unverified delivery rule makes the retailer unavailable; unknown delivery charges must never silently become zero.

### PR-05 — Recommendation integrity

All monetary calculations use integer SGD cents. Calculate the complete basket independently at each retailer, with the same pricing rules as product comparison, including product costs, supported promotions, delivery fees and thresholds, minimum orders and mandatory order charges. Recommend the cheapest feasible option, with ties resolved as in J3.

Validate every returned complete option and explain each unavailable retailer. An unavailable retailer's estimate is validated the same way, never takes part in the recommendation, and never appears above a complete option. Retailer participation, commissions and click revenue do not influence recommendations.

### PR-06 — Snapshot disclosure and seed data

Do **not** display collection dates on the website. Show a small, readable notice on the basket comparison results page only:

> Estimates use a curated dataset. Prices and availability may have changed. Confirm details on the retailer's website.

Do not display dataset disclosures elsewhere in the shopper interface. Internal documentation retains the fixed-snapshot limitations. The comparison does not check live retailer prices or availability.

Keep one cleaned seed in the repository; it evolves through Git, which is its version history. Engineers refresh it by taking a new snapshot of all three retailers within one short window (`scripts/scrape/README.md`); each refresh replaces the previous snapshot entirely and stays a fixed dataset until the next one. If any retailer's collection fails, the previous seed stays; listings skipped under a check cap (PR-02) are not a failure, and are left out rather than carried over. Neither the seed nor the site records when a snapshot was taken, and source references are not presented as collection dates. There is no scheduled or live refresh.

### PR-07 — Usage measurement

Collect outbound-click events with retailer, listing/product and timestamp, without collecting user identities for this feature. These events measure use of links, not fulfilled purchases, unique buyers or billable clicks.

## 5. Success criteria

| ID | Criterion | Required evidence |
| --- | --- | --- |
| SC-01 | Shoppers can complete J1–J5 on the deployed service. | End-to-end checks covering valid and unsuccessful journeys; usable mobile layout and keyboard controls. |
| SC-02 | Published data follows PR-01–PR-04 and the seed requirements of PR-06. | Curation records, import validation, and catalogue size and overlap report. |
| SC-03 | Returned options obey quantities, prices and order constraints. | Reference calculations, boundary tests and complete-basket validation; the recommendation is the cheapest feasible option. |
| SC-04 | Comparison results and unavailability reasons are correct for all three retailers. | Constructed and real-seed baskets checking exact totals, recommendation, ties and each retailer's reason when unavailable. |
| SC-05 | Catalogue/search p99 is below 1 second and basket comparison p99 below 2 seconds at the declared surge load, which is at least the normal load on every endpoint. | Mixed-workload results, with separate 20-line and 50-line basket results and test configuration. Product-offer latency is reported; no separate numeric target was agreed for it. |
| SC-06 | Unexpected failures are at most 0.1% at the declared surge load. | Request outcomes including timeouts, connection failures, server errors and capacity-related rejections. Correctly rejected invalid inputs are excluded. |
| SC-07 | AWS elasticity and application-instance fault tolerance are demonstrated. | Automatic scale-out and continued service after terminating one application instance; observations and recovery behaviour reported. |
| SC-08 | Shopper evaluation tests understanding and perceived usefulness. | Findings on comparison comprehension, assumptions and whether price differences justify rebuilding a retailer cart, including negative feedback. |
| SC-09 | The project documents its costs and closes resources on schedule. | Project spend, separate BAU estimate, cloud/on-premise comparison and teardown record. |

Performance is distinct from availability. The prospective BAU **request-success SLO is 99.9% per day**, not a contractual SLA or a time-based uptime guarantee. A short load test does not establish long-term availability. Report observed prototype request success separately; report deliberate overload and fault injection separately from surge acceptance runs.

For requirement traceability, SC-03/SC-04 verify PR-05 comparison correctness and recommendation integrity. SC-01/SC-02 verify PR-06 disclosures and the committed seed. SC-01 includes PR-07 click recording and navigation when tracking fails.

### Shopper study

Retain the preliminary report's target of **10–15 people who regularly shop for groceries online**. Use realistic basket-comparison tasks and interviews/questionnaires to assess ease of use, clarity, trust, usefulness and willingness to use the app. Include the effort of rebuilding retailer carts in the discussion or task. Gather open-ended feedback and record whether assumptions are understood.

The study validates the idea and informs small MVP adjustments and longer-term recommendations. It does not substantially redefine the deliverables. Reported interest is not demonstrated adoption. Select representative evaluation baskets independently of those yielding the largest price differences; report equal-cost outcomes and coverage gaps.

## 6. Deployment and planning constraints

- AWS Singapore (`ap-southeast-1`); eight-week project operating envelope of approximately **SGD 84**, averaging SGD 1.50/day before credits and including the planned load-test day.
- For most development, use one `t4g.micro` EC2 instance hosting the application and PostgreSQL.
- For the presentation configuration, use ALB, an EC2 Auto Scaling Group and Single-AZ `db.t4g.micro` RDS PostgreSQL. Run two baseline application instances, scaling out to a maximum of three, during the evaluation and presentation window, and report that configuration. While building and testing, the stack runs one baseline instance to save cost; that is accepted technical debt, because an application-instance failure then interrupts service until the Auto Scaling Group replaces the instance.
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

The curated seed is committed and system evaluation is recorded in [capacity findings](capacity-findings.md) and issue #22. Run G reached 240 RPS for four minutes; this is the highest tested load, not a measured maximum sustainable capacity. User evaluation and the cloud/on-premise cost comparison are tracked in #23, and teardown in #24. Record limitations and remaining evidence explicitly rather than treating closed tickets as proof of every claim.
