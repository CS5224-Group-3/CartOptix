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
# Products that dropped out, kept so later refreshes read them again (no prices).
IDENTITY = ("listingId", "productId", "retailerId", "productUrl", "specification")
RETIRED = SEED.parent / "retired.json"
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
    if row.get("status") == "skipped":
        return "not collected (Lazada check)"
    if row.get("status") == "carried":
        return None
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


def catalogue(seed: dict, retired: dict) -> tuple[dict, list[dict]]:
    """Every product ever published, by ID, and their listings: the seed's and the retired ones."""
    products = {p["productId"]: p for p in [*retired["products"], *seed["products"]]}
    listings = {l["listingId"]: l for l in [*retired["listings"], *seed["listings"]]}
    return products, list(listings.values())


def build(seed, retired, observed, candidates, decisions, seller_checks, registry) -> dict:
    """The refreshed products and listings, the retired ones, and what the report needs.

    Pure apart from updating `registry`, so it can be tested without files.
    """
    known, known_listings = catalogue(seed, retired)
    unobserved = [l["productUrl"] for l in known_listings if l["productUrl"] not in observed]
    if unobserved:
        raise SystemExit(f"{len(unobserved)} listings have no new observation, e.g. {unobserved[0]}")

    # Each product's rows: its known listings first, then accepted candidates, best first.
    # `identities` keeps every listing's identity, without prices, for retiring it.
    rows: dict[str, list[dict]] = defaultdict(list)
    identities: dict[str, list[dict]] = defaultdict(list)
    current = {l["productUrl"]: l for l in seed["listings"]}
    for listing in known_listings:
        row = observed[listing["productUrl"]]
        if row.get("status") == "carried":
            # Kept exactly as the current seed has it; only the seed's RedMart listings can be (PR-02).
            if listing["retailerId"] != "redmart":
                raise SystemExit(f"Only RedMart listings can be carried over, not {listing['productUrl']}")
            if listing["productUrl"] not in current:
                raise SystemExit(f"Cannot carry over {listing['productUrl']}: it is not in the seed")
            row = {**row, "carried": current[listing["productUrl"]]}
        rows[listing["productId"]].append(row)
        identities[listing["productId"]].append({k: listing[k] for k in IDENTITY})
    accepted = 0
    for candidate in sorted(candidates, key=lambda c: -float(c["similarity"])):
        decision = decisions.get((candidate["product_id"], candidate["product url"]), {})
        if decision.get("decision") == "MATCH" and decision.get("confidence") == "HIGH":
            rows[candidate["product_id"]].append({**candidate, "status": "ok"})
            url = candidate["product url"].split("?")[0]
            identities[candidate["product_id"]].append(
                {
                    "listingId": listing_id(SOURCE_KEY[candidate["retailer"]], url),
                    "productId": candidate["product_id"],
                    "retailerId": candidate["retailer"],
                    "productUrl": url,
                    "specification": candidate["Specification"] or candidate["Product Name"],
                }
            )
            accepted += 1

    reasons: Counter = Counter()
    carried = 0
    unreadable: list[dict] = []
    products, listings, added = [], [], []
    retired_products, retired_listings = [], []
    for product_id, product in sorted(known.items()):
        eligible: dict[str, dict] = {}
        for row in rows[product_id]:
            reason = exclusion(row, seller_checks)
            if reason == "seller unreadable":
                unreadable.append(row)
            if reason:
                reasons[(row["retailer"], reason)] += 1
            elif row["retailer"] not in eligible:
                eligible[row["retailer"]] = row
        members = sorted(eligible.values(), key=lambda r: NAME_PREFERENCE.index(SOURCE_KEY[r["retailer"]]))
        if len(members) < 2:
            # Kept, with every listing it had but no prices, so a later refresh
            # reads them again and can bring it back under the same ID.
            retired_products.append(product)
            retired_listings.extend(identities[product_id])
            continue
        image = next((m["Image URL"] for m in members if m["Image URL"].startswith("https://")), None)
        products.append(
            {
                "productId": product_id,
                "categoryId": product["categoryId"],
                "representativeName": members[0]["Product Name"] or members[0]["carried"]["name"],
                "imageUrl": image or product["imageUrl"],
            }
        )
        for member in members:
            if "carried" in member:
                listings.append(dict(member["carried"]))
                carried += 1
                continue
            url = member["product url"].split("?")[0]
            lid = listing_id(SOURCE_KEY[member["retailer"]], url)
            if lid not in registry:
                added.append(lid)
            registry[lid] = product_id
            listings.append(
                seed_listing(lid, product_id, member["retailer"], f"snapshot:{url}", member, derive_offer(member), url)
            )
    return {
        "products": products,
        "listings": listings,
        "retired": {"products": retired_products, "listings": retired_listings},
        "added": added,
        "accepted": accepted,
        "carried": carried,
        "reasons": reasons,
        "unreadable": unreadable,
    }


def main() -> None:
    seed = json.loads(SEED.read_text(encoding="utf-8"))
    retired = json.loads(RETIRED.read_text(encoding="utf-8")) if RETIRED.exists() else {"products": [], "listings": []}
    registry = load_registry()
    retailers = [seed_id for seed_id, _, _ in RETAILERS.values()]
    result = build(
        seed,
        retired,
        observed={row["product url"]: row for r in retailers for row in read(f"listings-{r}.csv")},
        candidates=[row for r in retailers for row in read(f"candidates-{r}.csv")],
        decisions={(r["product_id"], r["product url"]): r for r in read("match-decisions.csv", required=False)},
        seller_checks={r["product url"]: r["seller"] for r in read("seller-checks.csv", required=False)},
        registry=registry,
    )

    if result["unreadable"]:
        path = SNAPSHOT / "seller-checks-needed.csv"
        with open(path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["product url", "Product Name", "seller"])
            writer.writerows([[r["product url"], r["Product Name"], ""] for r in result["unreadable"]])
        print(f"{len(result['unreadable'])} RedMart sellers need a hand check: fill in {path.relative_to(ROOT)},")
        print("add the rows to data/snapshot/seller-checks.csv, then run this again.")
        raise SystemExit(2)

    write_seed(result["products"], result["listings"], registry)
    RETIRED.write_text(json.dumps(result["retired"], indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    write_report(seed, result)


def write_report(seed, result) -> None:
    products, listings = result["products"], result["listings"]
    added, accepted, reasons = result["added"], result["accepted"], result["reasons"]
    dropped = [p["productId"] for p in result["retired"]["products"]]
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
        f"Listings carried over unchanged from the previous seed, not read again: {result['carried']}.",
        "",
        "## Listings not published",
        "",
        "| Retailer | Reason | Listings |",
        "| --- | --- | --- |",
        *[f"| {r} | {reason} | {n} |" for (r, reason), n in sorted(reasons.items())],
        "",
        f"## Products not published: fewer than two eligible retailers ({len(dropped)})",
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
