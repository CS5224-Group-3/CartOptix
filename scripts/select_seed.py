"""Select the seed catalogue from the curated matching outputs.

Writes the selection CSV that build_seed.py consumes (group_id, category,
source_record_id). The scraped data has no seller field, so RedMart listings
must be checked by hand for a third-party "Sold by" line (see stage2f_summary.md)
and recorded in data/curated/stage2h_redmart_seller_checks.csv. Only the RedMart
listings the selection needs are checked, so selection runs in rounds:

    python scripts/select_seed.py <selection.csv> <to-check.csv>

If any selected group depends on an unchecked RedMart listing, the script writes
those listings to <to-check.csv> and exits with status 2 without writing the
selection. Check them, append the results to the checks file, and rerun until it
writes the selection.

Rules:
- Groups must be HIGH-confidence AI matches that need no human review
  (stage2f_ai_identity_decisions.csv).
- Listings out of stock at the snapshot, and RedMart listings whose check found a
  third-party seller or no page, are dropped. A group needs eligible listings at
  two or more retailers after that.
- Each category takes QUOTA groups, in this order: groups in the Stage 2F
  independent sample (so its review covers published groups), then groups at all
  three retailers, then Cold Storage + FairPrice, then pairs with RedMart. Ties
  break on the Stage 2D shortlist rank, a stable hash-based order.
- At least MIN_REDMART groups per category carry a RedMart listing, where the
  candidates allow it.
"""

import csv
import sys
from collections import defaultdict
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CURATED = ROOT / "data" / "curated"
CHECKS = CURATED / "stage2h_redmart_seller_checks.csv"

QUOTA = 37
MIN_REDMART = 12


def load_candidates() -> tuple[pd.DataFrame, set[str]]:
    shortlist = pd.read_csv(CURATED / "stage2d_provisional_seed_shortlist.csv")
    ai = pd.read_csv(CURATED / "stage2f_ai_identity_decisions.csv")
    members = pd.read_csv(CURATED / "stage2d_canonical_membership_provisional.csv")
    sample = pd.read_csv(CURATED / "stage2f_independent_sample.csv")

    accepted = ai[
        (ai.ai_decision == "MATCH") & (ai.ai_confidence == "HIGH") & (ai.needs_human_review == "no")
    ].canonical_product_id
    members = members[members.canonical_product_id.isin(accepted) & (members.stock_status == "IN_STOCK")]
    members = members.merge(
        shortlist[["canonical_product_id", "shortlist_rank_within_category"]], on="canonical_product_id"
    )
    return members, set(sample.canonical_product_id)


def load_checks() -> dict[str, str]:
    with open(CHECKS, encoding="utf-8") as f:
        return {row["source_record_id"]: row["decision"] for row in csv.DictReader(f)}


def main(selection_path: str, to_check_path: str) -> None:
    members, sample = load_candidates()
    checks = load_checks()

    groups = []
    for (group_id, category, rank), rows in members.groupby(
        ["canonical_product_id", "target_category", "shortlist_rank_within_category"]
    ):
        listings, pending = [], None
        for row in rows.itertuples():
            if row.retailer == "redmart":
                decision = checks.get(row.source_record_id)
                if decision is None:
                    pending = row
                elif decision != "KEEP_REDMART_OWN":
                    continue
            listings.append(row)
        retailers = {l.retailer for l in listings}
        if len(retailers) < 2:
            continue
        tier = 0 if len(retailers) == 3 else 1 if "redmart" not in retailers else 2
        groups.append(
            {
                "group_id": group_id,
                "category": category,
                "order": (group_id not in sample, tier, rank),
                "listings": listings,
                "pending": pending,
                "redmart": "redmart" in retailers,
            }
        )

    by_category = defaultdict(list)
    for g in groups:
        by_category[g["category"]].append(g)

    selected, to_check, report = [], [], []
    for category in sorted(by_category):
        candidates = sorted(by_category[category], key=lambda g: g["order"])
        redmart_available = sum(g["redmart"] for g in candidates)
        filled = redmart_filled = 0
        chosen = []
        for g in candidates:
            if filled >= QUOTA:
                break
            redmart_needed = max(0, min(MIN_REDMART, redmart_available) - redmart_filled)
            if not g["redmart"] and QUOTA - filled <= redmart_needed:
                continue
            chosen.append(g)
            filled += 1
            redmart_filled += g["redmart"]
        pending = [g["pending"] for g in chosen if g["pending"] is not None]
        to_check.extend((category, p) for p in pending)
        selected.extend(chosen)
        report.append((category, len(chosen), sum(g["redmart"] for g in chosen), len(pending), len(candidates)))

    print(f"{'category':30} chosen  with-RM  unchecked  candidates")
    for category, n, rm, p, c in report:
        print(f"{category:30} {n:6} {rm:8} {p:10} {c:11}")

    if to_check:
        with open(to_check_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["source_record_id", "category", "product_name_raw", "url"])
            for category, p in to_check:
                writer.writerow([p.source_record_id, category, p.product_name_raw, p.product_url_raw.split("?")[0]])
        print(f"{len(to_check)} RedMart listings to check; wrote {to_check_path}")
        sys.exit(2)

    with open(selection_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["group_id", "category", "source_record_id"])
        for g in sorted(selected, key=lambda g: (g["category"], g["group_id"])):
            for l in sorted(g["listings"], key=lambda l: l.source_record_id):
                writer.writerow([g["group_id"], g["category"], l.source_record_id])
    listings = sum(len(g["listings"]) for g in selected)
    print(f"Wrote {len(selected)} groups and {listings} listings to {selection_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python scripts/select_seed.py <selection.csv> <to-check.csv>")
    main(sys.argv[1], sys.argv[2])
