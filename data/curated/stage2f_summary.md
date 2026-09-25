# Stage 2F — AI identity review and RedMart seller spot-check

Data-quality checks for #4, run on 25 Sep 2026 against the Stage 2D shortlist (`stage2d_provisional_seed_shortlist.csv`: 1,300 canonical products, 2,650 listings). They follow the curation rules in the product spec (PR-02) and technical spec (curation pipeline steps 4–5, B2), updated in #30.

## 1. AI identity review

**Method.** Every shortlisted group, already accepted by the Stage 2C/2D name rules, was judged again by an AI reviewer (Claude, via OpenCode subagents; 10 batches of 130 groups). Each batch received the listings' retailer, name, specification and price, and this rubric:

> A group is a MATCH only if every listing is the same brand, same product line, same variant/flavour/scent/type, same per-pack size and same pack count (6 × 330 ml is not 330 ml; 2 × 90 g is not 180 g). Ignore formatting differences that don't change identity. Price is a weak signal only: a large gap can justify UNSURE when the text is ambiguous, but never decides on its own. Decide MATCH, NOT_MATCH or UNSURE, with HIGH, MEDIUM or LOW confidence and a short reason.

A deterministic cross-check then scanned the HIGH-confidence matches for multipack wording on one side only, price ratios of 2× or more, and title sizes that contradict the specification. It flagged 5 groups; all 5 are genuine matches that state inner-pack detail consistent with the total (for example 12 × 16 g = 192 g).

**Results** (`stage2f_ai_identity_decisions.csv`, one row per group):

| AI decision | Groups |
| --- | --- |
| MATCH, HIGH confidence | 1,250 |
| MATCH, MEDIUM or LOW | 33 |
| UNSURE | 16 |
| NOT_MATCH | 1 |

The 50 groups that are not HIGH-confidence matches disagree with, or do not fully confirm, the name rules. Recurring causes:

- **Title size contradicts the specification** on RedMart, e.g. four Top detergent refills titled 1.6 kg or 1.5 kg with a 1.8 kg or 1.7 kg specification, and Cadbury Bubbly titled 120 g with a 112 g specification.
- **Brand missing from the FairPrice name** (Anand, Bourbon, Kaiso, Pigeon, Han Shuo, Sanada Seiko and others).
- **Implausible prices, probably data errors:** CocoCoast coconut water at S$43.90 on RedMart against S$3.85 at FairPrice (two flavours), and Franzzi cookies at S$8.90 against S$2.35.
- **Possible multipack or case:** Sun Q dates "170G (6 PCS)" at S$56.99 against S$10 (the one NOT_MATCH), and Kangaroo Harvest cashews named "5x100g".
- **Variant stated on one side only:** Dilmah tea (English Breakfast on FairPrice only), Milo 900 g regular against refill pack.

**Human steps still required** (PR-02):

1. **Review every disagreement:** `stage2f_ai_disagreements_for_review.csv` lists the 50 groups, one row per listing. Fill in `reviewer`, `review_decision` (MATCH, NOT_MATCH or QUARANTINE) and `review_notes`. Unresolved groups are quarantined, not published.
2. **Independent sample:** `stage2f_independent_sample.csv` holds 64 AI-accepted groups, 8 per category, drawn with a fixed seed (20260925). Someone who did not produce the matches fills in `sample_decision` (CORRECT or WRONG); report the sample size and error rate. Either file can be reused if the catalogue is trimmed, as long as the checked groups are published.

## 2. RedMart seller spot-check

**Method.** 30 RedMart listings drawn at random (seed 20260925) from the 1,132 shortlisted, opened on lazada.sg in an ordinary desktop browser without logging in. For each page the seller line ("Sold by …"), delivery options, displayed price and stock note were recorded (`stage2f_redmart_seller_spotcheck.csv`). Stage 2E's automated Playwright run was blocked by Lazada's anti-bot challenge; the ordinary browser was not challenged on any of the 30 pages.

**Results.**

- All 30 pages loaded, and every product title matched the dataset's listing.
- All 30 sit inside the RedMart storefront and offer RedMart's scheduled delivery (free from S$60, otherwise S$5.99).
- **15 of 30 (50%; 95% interval 33–67%) are sold by a named third-party seller**, such as Shin Mart, Foodsterr, Posh Baby or Sea Boss. The other 15 show no "Sold by" line, which is how RedMart's own stock appears.
- One listing (EcoStore Multi-Purpose Cleaner) is now out of stock. The dataset keeps the snapshot's stock flag (PR-02), so this does not change eligibility.

**Are these sellers delivered by RedMart?** Yes, on the available evidence:

- Lazada's [RSS Terms and Conditions](https://pages.lazada.sg/wow/i/sg/redmart/seller-terms-update) (updated 3 October 2022) define the RedMart Speciality Store (RSS) as "a marketplace channel on the Lazada Platform". §9.1 requires RSS sellers to "use only the first and last mile delivery options offered by Lazada under the RSS Programme ('RSS Fulfilment')"; §9.2–9.3 have Lazada collect each order from the seller's pick-up address. The seller remains the legal seller (Appendix 2, C.1).
- All 15 third-party listings in the spot-check show exactly the same delivery options as RedMart's own stock: RedMart's scheduled slots, a S$5.99 fee, and free delivery from S$60.

**Decision.** RSS sellers count as supermarket-fulfilled, and RedMart listings stay eligible. The product spec's catalogue boundary (section 2) and PR-02 record the exception; sellers that deliver themselves, such as FairPrice Marketplace sellers, remain excluded.

**Assumption to confirm.** The MVP assumes an RSS item joins the same RedMart order, fee and S$60 threshold as RedMart's own stock. The product pages suggest this but do not prove it. A quick manual check: in a normal RedMart session, add one RedMart-stocked item and one RSS item, go to checkout without paying, and confirm there is one delivery fee and one threshold. If they are charged separately, RSS listings must be excluded or modelled as a separate order.

The BCRS deposit question from the earlier review was not checked; deposits are not modelled in the MVP.
