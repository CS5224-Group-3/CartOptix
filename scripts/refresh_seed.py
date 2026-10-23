"""Build the seed from a refreshed snapshot (data/snapshot, see scripts/scrape/README.md).

Inputs, all in data/snapshot, one file per retailer for the first two:
- listings-<retailer>.csv: every published listing's page, read again by refresh.ts.
- base/: the seed this snapshot replaces, which the build starts from.
- candidates-<retailer>.csv (and an optional -targeted.csv): search hits for retailers a product is missing
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
- A listing read again must still show the product it was matched to: the same
  name and pack size, ignoring case, spacing, punctuation and the BCRS tag.
  Otherwise it is quarantined ("identity changed") until a new MATCH/HIGH
  decision in match-decisions.csv approves the page as it reads now.
- Where a targeted search read a page the full search also read, the targeted
  reading is the one used.
- A product publishes when two or more retailers have an eligible listing.
  Its ID, category and listing IDs stay stable. Every listing that does not
  publish, and every product that drops out, is kept without prices in
  data/seed/retired.json, so a later refresh reads it again and it returns
  under the same ID.

Writes data/seed/seed.json, data/seed/product_ids.csv and
data/snapshot/report.md. Exits with status 2, writing nothing, when RedMart
sellers need a hand check; they are listed in data/snapshot/seller-checks-needed.csv.

Run from the repository root: python3 scripts/refresh_seed.py
"""

import csv
import json
import re
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
# Listings that are not published, kept so later refreshes read them again (no prices).
IDENTITY = ("listingId", "productId", "retailerId", "productUrl", "name", "specification")
RETIRED = SEED.parent / "retired.json"
RECORDED: dict[str, dict] = {}
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
    if row.get("status") == "identity_changed":
        return "identity changed"
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


def identity_text(text: str) -> str:
    """Name or pack size as it identifies a product: case, spacing, punctuation and the BCRS tag ignored."""
    text = text.lower().replace("[bcrs]", " ").replace("×", " x ")
    # Numbers apart from units and words, so "1kg" equals "1 kg" but "2 x 500g" never equals "2500g".
    text = re.sub(r"(?<=\d)(?=[a-z])|(?<=[a-z])(?=\d)", " ", text)
    return " ".join(re.findall(r"[a-z0-9.]+", text))


def same_identity(listing: dict, row: dict) -> bool:
    """Whether a page read again still shows the product its listing was matched to (PR-02).

    A listing recorded without a name (an older retired.json) cannot be checked.
    """
    name, observed_name = listing.get("name"), row["Product Name"].strip()
    observed_spec = row["Specification"].strip() or observed_name
    return (
        name is not None
        and identity_text(name) == identity_text(observed_name)
        and identity_text(listing["specification"]) == identity_text(observed_spec)
    )


def approved(decisions: dict, product_id: str, url: str) -> bool:
    decision = decisions.get((product_id, url), {})
    return decision.get("decision") == "MATCH" and decision.get("confidence") == "HIGH"


def latest_candidates(full: list[dict], targeted: list[dict]) -> list[dict]:
    """A retailer's search hits; a page's targeted reading replaces its earlier one."""
    def key(row: dict) -> tuple[str, str]:
        return row["product_id"], row["product url"].split("?")[0]

    newer = {key(r) for r in targeted}
    return [r for r in full if key(r) not in newer] + targeted


# The source observations behind every listing built from the original exports,
# and, for listings a snapshot found, the observations it recorded beside the
# seed (data/seed/observations.csv, copied into the snapshot's base).
OFFER_PRICES = ROOT / "data" / "curated" / "stage2g_offer_prices.csv"
OBSERVATIONS = SEED.parent / "observations.csv"
OBSERVATION_COLUMNS = ["source_record_id", "raw_product_price", "raw_original_price", "raw_savings"]


def recorded_offers(base: Path) -> dict[str, dict]:
    recorded = {}
    for path in [OFFER_PRICES, base / "observations.csv"]:
        if path.exists():
            with open(path, encoding="utf-8") as f:
                recorded.update({r["source_record_id"]: r for r in csv.DictReader(f)})
    return recorded


def reapply(listing: dict, recorded: dict[str, dict] | None = None) -> dict:
    """A carried-over listing with today's curation rules applied to its recorded observation.

    Carrying over keeps what was observed (price, original price, deal wording),
    not how an earlier rule read it, so a rule change such as excluding
    percentage deals reaches carried listings too.
    """
    source = (recorded if recorded is not None else RECORDED).get(listing["sourceRecordId"])
    if source is None:
        raise SystemExit(f"No recorded observation for carried listing {listing['listingId']}")
    offer = derive_offer(
        {
            "Product Price": source["raw_product_price"],
            "Original Price": source["raw_original_price"],
            "Savings": source["raw_savings"],
        }
    )
    if not offer["eligible"]:
        raise SystemExit(f"Carried listing {listing['listingId']} has no reliable recorded price")
    return {
        **listing,
        "priceKind": offer["price_kind"],
        "unitPriceCents": offer["unit_price_cents"],
        "originalPriceCents": offer["original_price_cents"],
        "multibuy": offer["multibuy"],
        "excludedPromotions": offer["excluded_promotions"],
    }


def recorded_observation(source_record_id: str) -> dict:
    """A carried listing's recorded observation, to record again beside the new seed."""
    source = RECORDED.get(source_record_id)
    if source is None:
        raise SystemExit(f"No recorded observation for {source_record_id}")
    return {"source_record_id": source_record_id, **{k: source[k] for k in OBSERVATION_COLUMNS[1:]}}


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
            row = {**row, "carried": reapply(current[listing["productUrl"]])}
        identity = {k: listing[k] for k in IDENTITY if k in listing}
        if row.get("status", "ok") == "ok" and not same_identity(listing, row):
            # A changed page publishes again only on a new MATCH/HIGH review.
            if approved(decisions, listing["productId"], listing["productUrl"]):
                identity["name"] = row["Product Name"].strip()
                identity["specification"] = row["Specification"].strip() or identity["name"]
            else:
                row = {**row, "status": "identity_changed"}
        rows[listing["productId"]].append(row)
        identities[listing["productId"]].append(identity)
    accepted = 0
    for candidate in sorted(candidates, key=lambda c: -float(c["similarity"])):
        if approved(decisions, candidate["product_id"], candidate["product url"]):
            rows[candidate["product_id"]].append({**candidate, "status": "ok"})
            url = candidate["product url"].split("?")[0]
            identities[candidate["product_id"]].append(
                {
                    "listingId": listing_id(SOURCE_KEY[candidate["retailer"]], url),
                    "productId": candidate["product_id"],
                    "retailerId": candidate["retailer"],
                    "productUrl": url,
                    "name": candidate["Product Name"].strip(),
                    "specification": candidate["Specification"].strip() or candidate["Product Name"].strip(),
                }
            )
            accepted += 1

    reasons: Counter = Counter()
    carried = 0
    # What each published listing was observed as, so a later snapshot can carry it over.
    observations: list[dict] = []
    unreadable: list[dict] = []
    products, listings, added = [], [], []
    retired_products = []
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
            # Kept without prices, so a later refresh reads its listings again
            # and can bring it back under the same ID.
            retired_products.append(product)
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
                listing = dict(member["carried"])
                listings.append(listing)
                observations.append(recorded_observation(listing["sourceRecordId"]))
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
            observations.append(
                {
                    "source_record_id": f"snapshot:{url}",
                    "raw_product_price": member["Product Price"],
                    "raw_original_price": member["Original Price"],
                    "raw_savings": member["Savings"],
                }
            )
    # Every listing not published this time, so a later refresh reads it again
    # and it can return under the same ID, whether or not its product published.
    published = {l["listingId"] for l in listings}
    retired_listings = list(
        {i["listingId"]: i for ids in identities.values() for i in ids if i["listingId"] not in published}.values()
    )
    return {
        "observations": observations,
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
    # The seed this snapshot replaces (copied by `refresh.ts new`), so the
    # build repeats exactly however often it runs.
    base = SNAPSHOT / "base" if (SNAPSHOT / "base" / "seed.json").exists() else SEED.parent
    RECORDED.update(recorded_offers(base))
    seed = json.loads((base / "seed.json").read_text(encoding="utf-8"))
    retired_path = base / "retired.json"
    retired = json.loads(retired_path.read_text(encoding="utf-8")) if retired_path.exists() else {"products": [], "listings": []}
    registry = load_registry(base / "product_ids.csv")
    retailers = [seed_id for seed_id, _, _ in RETAILERS.values()]
    result = build(
        seed,
        retired,
        observed={row["product url"]: row for r in retailers for row in read(f"listings-{r}.csv")},
        candidates=[
            row
            for r in retailers
            for row in latest_candidates(read(f"candidates-{r}.csv"), read(f"candidates-{r}-targeted.csv", required=False))
        ],
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
    with open(OBSERVATIONS, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OBSERVATION_COLUMNS)
        writer.writeheader()
        writer.writerows(sorted(result["observations"], key=lambda o: o["source_record_id"]))
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
        f"Listings carried over from the previous seed, not read again (today's rules applied to their recorded observation): {result['carried']}.",
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
