"""Build a seed file from a catalogue selection.

The selection is the only input that depends on how products were matched, so
any matching pipeline can feed the same seed. It is a CSV with one row per
listing:

    group_id,category,source_record_id

- group_id: listings with the same value are the same exact product.
- category: one of the eight catalogue categories, by name.
- source_record_id: <retailer>_<excel row> in data/raw (see Stage 1B).

Everything else comes from shared sources: names, specifications, URLs and
images from the raw workbooks; prices and excluded promotions from
derive_offer_prices.py; delivery rules from data/curated/delivery_rules.json.

Product IDs are kept stable across builds in data/seed/product_ids.csv: a group
reuses the ID already recorded for any of its listings, and a new group gets a
new ID from its name. Listing IDs come from the retailer's product URL.

Run from the repository root:
    python scripts/build_seed.py data/seed/selection.csv
It writes data/seed/seed.json; format it with
    pnpm exec biome format --write data/seed
then import it with:
    pnpm --filter @cartoptix/api seed:import data/seed/seed.json
"""

import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from derive_offer_prices import derive_offer, load_workbooks, source_row

ROOT = Path(__file__).resolve().parent.parent
SEED_DIR = ROOT / "data" / "seed"
SEED = SEED_DIR / "seed.json"
REGISTRY = SEED_DIR / "product_ids.csv"
DELIVERY_RULES = ROOT / "data" / "curated" / "delivery_rules.json"

RETAILERS = {
    # workbook retailer: (seed retailer ID, display name, allowed product-link hosts)
    "redmart": ("redmart", "RedMart", ["www.lazada.sg"]),
    "fairprice": ("fairprice", "FairPrice", ["www.fairprice.com.sg"]),
    "coldstorage": ("cold-storage", "Cold Storage", ["coldstorage.com.sg"]),
}
CATEGORIES = [
    "Rice & Noodles",
    "Drinks",
    "Dairy",
    "Breakfast Foods",
    "Canned & Packaged Food",
    "Snacks",
    "Household Cleaning",
    "Toiletries & Personal Care",
]
# Whose listing name represents the product: Cold Storage and RedMart names
# usually carry the pack size; FairPrice names often do not.
NAME_PREFERENCE = ["coldstorage", "redmart", "fairprice"]


def slug(text: str) -> str:
    text = text.lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def listing_id(retailer: str, url: str) -> str:
    segment = url.split("?")[0].rstrip("/").rsplit("/", 1)[1].lower()
    segment = re.sub(r"\.html$", "", segment)
    return f"{RETAILERS[retailer][0]}-{segment}"


def load_registry() -> dict[str, str]:
    if not REGISTRY.exists():
        return {}
    with open(REGISTRY, encoding="utf-8") as f:
        return {row["listing_id"]: row["product_id"] for row in csv.DictReader(f)}


def main(selection_path: str) -> None:
    raw = load_workbooks()
    registry = load_registry()
    with open(DELIVERY_RULES, encoding="utf-8") as f:
        delivery = json.load(f)

    groups: dict[str, list[dict]] = defaultdict(list)
    with open(selection_path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["category"] not in CATEGORIES:
                raise SystemExit(f"Unknown category {row['category']!r}")
            groups[row["group_id"]].append(row)

    products, listings, used_ids = [], [], set(registry.values())
    for group_id in sorted(groups):
        rows = groups[group_id]
        members = []
        for row in rows:
            retailer = row["source_record_id"].rsplit("_", 1)[0]
            source = source_row(raw, row["source_record_id"])
            offer = derive_offer(source)
            if not offer["eligible"]:
                raise SystemExit(f"{row['source_record_id']} has no reliable price")
            if source["in-stock"].strip() != "Yes":
                raise SystemExit(f"{row['source_record_id']} is not in stock at the snapshot")
            url = source["product url"].split("?")[0].strip()
            members.append((retailer, row, source, offer, listing_id(retailer, url), url))

        members.sort(key=lambda m: NAME_PREFERENCE.index(m[0]))
        known = {registry[m[4]] for m in members if m[4] in registry}
        if len(known) > 1:
            raise SystemExit(f"Group {group_id} spans products {sorted(known)} in the registry")
        if known:
            product_id = known.pop()
        else:
            base = slug(members[0][2]["Product Name"])[:100] or "product"
            product_id, n = base, 2
            while product_id in used_ids:
                product_id, n = f"{base}-{n}", n + 1
        used_ids.add(product_id)

        images = [m[2]["Image URL"].strip() for m in members]
        image = next((u for u in images if u.startswith("https://")), None)
        products.append(
            {
                "productId": product_id,
                "categoryId": slug(rows[0]["category"]),
                "representativeName": members[0][2]["Product Name"].strip(),
                "imageUrl": image,
            }
        )
        for retailer, row, source, offer, lid, url in members:
            registry[lid] = product_id
            listings.append(
                {
                    "listingId": lid,
                    "productId": product_id,
                    "retailerId": RETAILERS[retailer][0],
                    "sourceRecordId": row["source_record_id"],
                    "name": source["Product Name"].strip(),
                    "specification": source["Specification"].strip() or source["Product Name"].strip(),
                    "productUrl": url,
                    "priceKind": offer["price_kind"],
                    "unitPriceCents": offer["unit_price_cents"],
                    "originalPriceCents": offer["original_price_cents"],
                    "excludedPromotions": [offer["excluded_promotion"]]
                    if offer["excluded_promotion"]
                    else [],
                }
            )

    seed = {
        "retailers": [
            {"retailerId": rid, "name": name, "productUrlHosts": hosts}
            for rid, name, hosts in RETAILERS.values()
        ],
        "categories": [{"categoryId": slug(c), "name": c} for c in CATEGORIES],
        "delivery": {
            "rules": [
                {k: v for k, v in rule.items() if k not in ("evidence", "caveats")}
                for rule in delivery["rules"]
            ],
        },
        "products": sorted(products, key=lambda p: p["productId"]),
        "listings": sorted(listings, key=lambda l: l["listingId"]),
    }

    SEED_DIR.mkdir(parents=True, exist_ok=True)
    SEED.write_text(json.dumps(seed, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    with open(REGISTRY, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["listing_id", "product_id"])
        writer.writerows(sorted(registry.items()))
    print(f"Wrote {len(products)} products and {len(listings)} listings to {SEED.relative_to(ROOT)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/build_seed.py <selection.csv>")
    main(sys.argv[1])
