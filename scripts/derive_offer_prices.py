"""Derive each shortlisted listing's unit price, price kind and excluded promotion.

Reads the Stage 2D shortlist and membership, and the original workbooks in
data/raw, joined on source_record_id (<retailer>_<excel row>). Writes
data/curated/stage2g_offer_prices.csv.

Rules (product spec PR-03):
- The unit price is the workbook's Product Price, parsed to whole cents. Savings
  text is never subtracted.
- A listing with an Original Price above its Product Price is an
  unconditional sale; otherwise it is ordinary.
- Savings text that is not the plain "Save $X" of a sale (multibuys, spend
  thresholds, gifts) is a promotion that is not applied. It is kept as a
  shopper-facing note, with any validity dates removed.
- A price that cannot be parsed to whole cents, or is not positive, excludes
  the offer.

Run from the repository root: python scripts/derive_offer_prices.py
"""

import csv
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CURATED = ROOT / "data" / "curated"
RAW = ROOT / "data" / "raw"
WORKBOOKS = {
    "redmart": "redmart_all_products_final.xlsx",
    "fairprice": "fairprice_all_products_final.xlsx",
    "coldstorage": "coldstorage_all_products_final.xlsx",
}
PLAIN_SAVING = re.compile(r"save \$?\d+(\.\d+)?", re.IGNORECASE)
DATES = re.compile(r"\s*\([^)]*\d+/\d+[^)]*\)")


def to_cents(text: str) -> int | None:
    """Whole cents, tolerating float artefacts such as 19.899999999999999."""
    cleaned = text.replace("$", "").replace(",", "").replace("SGD", "").strip()
    if not cleaned:
        return None
    try:
        cents = Decimal(cleaned) * 100
    except InvalidOperation:
        return None
    rounded = cents.to_integral_value()
    return int(rounded) if abs(cents - rounded) < Decimal("0.001") else None


def derive_offer(source) -> dict:
    """Price, price kind and excluded promotion for one workbook row."""
    price = to_cents(source["Product Price"])
    original = to_cents(source["Original Price"])
    savings = source["Savings"].strip()
    is_sale = price is not None and original is not None and original > price
    promotion = ""
    if savings and not (is_sale and PLAIN_SAVING.fullmatch(savings)):
        promotion = f"Promotion not applied: {DATES.sub('', savings).strip()}"
    eligible = price is not None and price > 0
    return {
        "unit_price_cents": price if eligible else None,
        "price_kind": ("unconditional_sale" if is_sale else "ordinary") if eligible else None,
        "excluded_promotion": promotion,
        "eligible": eligible,
        "savings": savings,
    }


def load_workbooks() -> dict:
    return {
        retailer: pd.read_excel(RAW / name, dtype=str).fillna("")
        for retailer, name in WORKBOOKS.items()
    }


def source_row(raw: dict, source_record_id: str):
    """The workbook row for a source_record_id (<retailer>_<excel row>)."""
    retailer, row = source_record_id.rsplit("_", 1)
    return raw[retailer].iloc[int(row) - 2]  # Excel row 1 is the header.


def main() -> None:
    raw = load_workbooks()
    with open(CURATED / "stage2d_provisional_seed_shortlist.csv", encoding="utf-8") as f:
        shortlist = {row["canonical_product_id"] for row in csv.DictReader(f)}
    with open(CURATED / "stage2d_canonical_membership_provisional.csv", encoding="utf-8") as f:
        members = [r for r in csv.DictReader(f) if r["canonical_product_id"] in shortlist]

    out = []
    for member in members:
        source = source_row(raw, member["source_record_id"])
        if source["Product Name"].strip() != member["product_name_raw"].strip():
            raise SystemExit(f"Row mismatch for {member['source_record_id']}")

        offer = derive_offer(source)
        out.append(
            {
                "source_record_id": member["source_record_id"],
                "retailer": member["retailer"],
                "unit_price_cents": offer["unit_price_cents"] or "",
                "price_kind": offer["price_kind"] or "",
                "excluded_promotion": offer["excluded_promotion"],
                "offer_status": "ELIGIBLE" if offer["eligible"] else "EXCLUDED_NO_RELIABLE_PRICE",
                "raw_product_price": source["Product Price"],
                "raw_original_price": source["Original Price"],
                "raw_savings": offer["savings"],
            }
        )

    path = CURATED / "stage2g_offer_prices.csv"
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(out[0]))
        writer.writeheader()
        writer.writerows(out)
    print(f"Wrote {len(out)} rows to {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
