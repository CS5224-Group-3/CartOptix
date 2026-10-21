"""Derive each shortlisted listing's unit price, price kind, multibuy and excluded promotion.

Reads the Stage 2D shortlist and membership, and the original workbooks in
data/raw, joined on source_record_id (<retailer>_<excel row>). Writes
data/curated/stage2g_offer_prices.csv.

Rules (product spec PR-03):
- The unit price is the workbook's Product Price, parsed to whole cents. Savings
  text is never subtracted.
- A listing with an Original Price above its Product Price is an
  unconditional sale; otherwise it is ordinary. A sale keeps its original
  price for display only; it never changes what the shopper pays.
- A same-product multibuy becomes a deal of N packs for a fixed price, if that
  is cheaper than N packs at the unit price. "N At $X" (also "@" or "For")
  costs X; "N Save X%" and "Buy N Get X% Off" take X% off N packs, rounded
  half-up to the cent; "N Save $X" takes X off N packs. Deals worded "Any" are
  marked mix-and-match, but only same-product packs are counted. Validity
  dates are ignored. A deal on a sale price is not applied, because promotions
  never stack.
- Other savings text that is not the plain "Save $X" of a sale (spend
  thresholds, gifts, deals that would not be cheaper) is a promotion that is
  not applied. It is kept as a shopper-facing note, with any dates removed.
- A price that cannot be parsed to whole cents, or is not positive, excludes
  the offer.

Run from the repository root: python scripts/derive_offer_prices.py
"""

import csv
import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path

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
MULTIBUY = re.compile(
    r"(?P<scope>any|buy) (?P<packs>\d+) (?:(?:at|@|for) (?P<price>\$?[\d.]+)"
    r"|save (?P<saving>\$[\d.]+)|(?:save|get) (?P<percent>\d+(?:\.\d+)?)%(?: off)?)",
    re.IGNORECASE,
)
MAX_PACKS = 20


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


def parse_multibuy(text: str, unit_price: int) -> dict | None:
    """A same-product deal from savings text, or None if it is not a cheaper multibuy."""
    match = MULTIBUY.fullmatch(text)
    if not match:
        return None
    packs = int(match["packs"])
    full_price = packs * unit_price
    if match["price"]:
        deal_price = to_cents(match["price"])
    elif match["saving"]:
        saving = to_cents(match["saving"])
        deal_price = None if saving is None else full_price - saving
    else:
        percent = Decimal(match["percent"])
        deal_price = int(
            (Decimal(full_price) * (100 - percent) / 100).quantize(Decimal(1), ROUND_HALF_UP)
        )
    if not 2 <= packs <= MAX_PACKS or deal_price is None or not 0 < deal_price < full_price:
        return None
    return {
        "packsPerDeal": packs,
        "dealPriceCents": deal_price,
        "mixAndMatch": match["scope"].lower() == "any",
    }


PROMOTION_SEPARATOR = " | "


def derive_offer(source) -> dict:
    """Price, price kind, multibuy and excluded promotions for one source row.

    `Savings` holds one promotion, or several separated by " | " (the scrapers).
    """
    price = to_cents(source["Product Price"])
    original = to_cents(source["Original Price"])
    savings = source["Savings"].strip()
    is_sale = price is not None and original is not None and original > price
    eligible = price is not None and price > 0
    multibuy = None
    excluded = []
    for term in (DATES.sub("", t).strip() for t in savings.split(PROMOTION_SEPARATOR)):
        if not term or (is_sale and PLAIN_SAVING.fullmatch(term)):
            continue
        # A sale price is already a discount; a multibuy never stacks on it (PR-03).
        deal = parse_multibuy(term, price) if eligible and not is_sale and multibuy is None else None
        if deal:
            multibuy = deal
        else:
            excluded.append(term)
    return {
        "unit_price_cents": price if eligible else None,
        "original_price_cents": original if eligible and is_sale else None,
        "price_kind": ("unconditional_sale" if is_sale else "ordinary") if eligible else None,
        "multibuy": multibuy,
        "excluded_promotions": excluded,
        "eligible": eligible,
        "savings": savings,
    }


def load_workbooks() -> dict:
    import pandas as pd  # Only reading the workbooks needs it; the rules do not.

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
                "multibuy_packs": (offer["multibuy"] or {}).get("packsPerDeal", ""),
                "multibuy_price_cents": (offer["multibuy"] or {}).get("dealPriceCents", ""),
                "multibuy_mix_and_match": (offer["multibuy"] or {}).get("mixAndMatch", ""),
                "excluded_promotion": PROMOTION_SEPARATOR.join(offer["excluded_promotions"]),
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
