"""Build the seed from a refreshed snapshot (data/snapshot, see scripts/scrape/README.md).

Inputs, all in data/snapshot, one file per retailer for the first two:
- listings-<retailer>.csv: every published listing's page, read again by refresh.ts.
- candidates-<retailer>.csv: search hits for retailers a product is missing
  from, already through the name rules.
- match-decisions.csv: the AI review of those candidates. Only MATCH with HIGH
  confidence publishes (PR-02).
- seller-checks.csv (optional): hand checks for RedMart pages whose seller
  could not be read.

Rules:
- Nothing from the previous snapshot is reused: a listing is priced only from
  its new observation, and a missing file or listing stops the build.
- A listing is eligible when its page exists, it is in stock, it has a reliable
  price (derive_offer_prices.py) and, at RedMart, RedMart sells it.
- A product publishes when two or more retailers have an eligible listing.
  Its ID, category and listing IDs stay stable; a product that drops out keeps
  its ID in the registry for when it returns.

Writes data/seed/seed.json, data/seed/product_ids.csv and
data/snapshot/report.md. Exits with status 2, writing nothing, when RedMart
sellers need a hand check; they are listed in data/snapshot/seller-checks-needed.csv.

Run from the repository root: python3 scripts/refresh_seed.py
"""

import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

from build_seed import (
    NAME_PREFERENCE,
    RETAILERS,
    SEED,
    listing_id,
    load_registry,
    seed_listing,
    write_seed,
)
from derive_offer_prices import derive_offer

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = ROOT / "data" / "snapshot"
# Seed retailer IDs to the workbook names build_seed.py keys its tables by.
SOURCE_KEY = {seed_id: key for key, (seed_id, _, _) in RETAILERS.items()}


def read(name: str, required: bool = True) -> list[dict]:
    path = SNAPSHOT / name
    if not path.exists():
        if required:
            raise SystemExit(f"Missing {path.relative_to(ROOT)}; run scripts/scrape/refresh.ts first")
        return []
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def exclusion(row: dict, seller_checks: dict[str, str]) -> str | None:
    """Why a listing cannot publish, or None when it is eligible."""
    if row.get("status", "ok") == "not_found":
        return "page gone"
    if row["in-stock"] != "Yes":
        return "out of stock"
    if not derive_offer(row)["eligible"]:
        return "no reliable price"
    if row["retailer"] == "redmart":
        seller = row["seller"] or seller_checks.get(row["product url"], "")
        if not seller:
            return "seller unreadable"
        if seller != "RedMart":
            return "third-party seller"
    return None


def main() -> None:
    seed = json.loads(SEED.read_text(encoding="utf-8"))
    registry = load_registry()
    retailers = [seed_id for seed_id, _, _ in RETAILERS.values()]
    observed = {row["product url"]: row for r in retailers for row in read(f"listings-{r}.csv")}
    candidates = [row for r in retailers for row in read(f"candidates-{r}.csv")]
    unobserved = [l["productUrl"] for l in seed["listings"] if l["productUrl"] not in observed]
    if unobserved:
        raise SystemExit(f"{len(unobserved)} seed listings have no new observation, e.g. {unobserved[0]}")
    decisions = {(r["product_id"], r["product url"]): r for r in read("match-decisions.csv", required=False)}
    seller_checks = {r["product url"]: r["seller"] for r in read("seller-checks.csv", required=False)}

    # Each product's rows: its published listings first, then accepted candidates, best first.
    rows: dict[str, list[dict]] = defaultdict(list)
    for listing in seed["listings"]:
        rows[listing["productId"]].append(observed[listing["productUrl"]])
    accepted = 0
    for candidate in sorted(candidates, key=lambda c: -float(c["similarity"])):
        decision = decisions.get((candidate["product_id"], candidate["product url"]), {})
        if decision.get("decision") == "MATCH" and decision.get("confidence") == "HIGH":
            rows[candidate["product_id"]].append({**candidate, "status": "ok"})
            accepted += 1

    reasons: Counter = Counter()
    unreadable: list[dict] = []
    products, listings, dropped, added = [], [], [], []
    current = {p["productId"]: p for p in seed["products"]}
    for product_id, product in sorted(current.items()):
        eligible: dict[str, dict] = {}
        for row in rows[product_id]:
            reason = exclusion(row, seller_checks)
            if reason == "seller unreadable":
                unreadable.append(row)
            if reason:
                reasons[(row["retailer"], reason)] += 1
            elif row["retailer"] not in eligible:
                eligible[row["retailer"]] = row
        if len(eligible) < 2:
            dropped.append(product_id)
            continue
        members = sorted(eligible.values(), key=lambda r: NAME_PREFERENCE.index(SOURCE_KEY[r["retailer"]]))
        image = next((m["Image URL"] for m in members if m["Image URL"].startswith("https://")), None)
        products.append(
            {
                "productId": product_id,
                "categoryId": product["categoryId"],
                "representativeName": members[0]["Product Name"],
                "imageUrl": image or product["imageUrl"],
            }
        )
        for member in members:
            url = member["product url"].split("?")[0]
            lid = listing_id(SOURCE_KEY[member["retailer"]], url)
            if lid not in registry:
                added.append(lid)
            registry[lid] = product_id
            listings.append(
                seed_listing(lid, product_id, member["retailer"], f"snapshot:{url}", member, derive_offer(member), url)
            )

    if unreadable:
        path = SNAPSHOT / "seller-checks-needed.csv"
        with open(path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["product url", "Product Name", "seller"])
            writer.writerows([[r["product url"], r["Product Name"], ""] for r in unreadable])
        print(f"{len(unreadable)} RedMart sellers need a hand check: fill in {path.relative_to(ROOT)},")
        print("save it as data/snapshot/seller-checks.csv, then run this again.")
        raise SystemExit(2)

    write_seed(products, listings, registry)
    write_report(seed, products, listings, dropped, added, accepted, reasons)


def write_report(seed, products, listings, dropped, added, accepted, reasons) -> None:
    by_product = Counter(l["productId"] for l in listings)
    per_retailer = Counter(l["retailerId"] for l in listings)
    before = Counter(l["retailerId"] for l in seed["listings"])
    lines = [
        "# Snapshot refresh report",
        "",
        "Generated by `scripts/refresh_seed.py`. Counts compare the refreshed seed with the one it replaced.",
        "",
        "| Measure | Before | After |",
        "| --- | --- | --- |",
        f"| Products | {len(seed['products'])} | {len(products)} |",
        *[f"| Listings at {r} | {before[r]} | {per_retailer[r]} |" for r, _, _ in RETAILERS.values()],
        f"| Products at all three retailers | {sum(1 for n in Counter(l['productId'] for l in seed['listings']).values() if n == 3)} | {sum(1 for n in by_product.values() if n == 3)} |",
        f"| Listings with a multibuy | {sum(1 for l in seed['listings'] if l.get('multibuy'))} | {sum(1 for l in listings if l['multibuy'])} |",
        f"| Listings on sale | {sum(1 for l in seed['listings'] if l['priceKind'] == 'unconditional_sale')} | {sum(1 for l in listings if l['priceKind'] == 'unconditional_sale')} |",
        "",
        f"Search candidates accepted by the AI review: {accepted}. New listings published: {len(added)}.",
        "",
        "## Listings not published",
        "",
        "| Retailer | Reason | Listings |",
        "| --- | --- | --- |",
        *[f"| {r} | {reason} | {n} |" for (r, reason), n in sorted(reasons.items())],
        "",
        f"## Products dropped below two retailers ({len(dropped)})",
        "",
        *[f"- `{p}`" for p in dropped],
        "",
        f"## New listings ({len(added)})",
        "",
        *[f"- `{l}`" for l in sorted(added)],
        "",
    ]
    (SNAPSHOT / "report.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
