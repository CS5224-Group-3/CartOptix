"""Compare live cart subtotals with our pricing rules (PR-03 checkout evidence).

Reads data/snapshot/checkout-<retailer>.csv (written by scripts/scrape/checkout.ts)
and writes data/snapshot/checkout-evidence.md. For each sampled deal, our rule
is applied to the *live* unit price and deal wording, so a price change since
the snapshot does not count as a disagreement; the cart subtotal must equal it.

Run from the repository root: python3 scripts/checkout_evidence.py
"""

import csv
from collections import Counter
from pathlib import Path

import re
from decimal import ROUND_HALF_UP, Decimal

from derive_offer_prices import derive_offer, to_cents

PERCENT = re.compile(r"(?:any|buy) (\d+) (?:save|get) (\d+(?:\.\d+)?)%", re.IGNORECASE)


def percentage_rule_cents(price: str, savings: str, qty: int) -> int | None:
    """What the former percentage rule charged: X% off N packs, rounded half-up per deal."""
    match = PERCENT.search(savings)
    unit = to_cents(price)
    if not match or unit is None:
        return None
    packs, percent = int(match[1]), Decimal(match[2])
    deal = int((Decimal(packs * unit) * (100 - percent) / 100).quantize(Decimal(1), ROUND_HALF_UP))
    deals = qty // packs
    return deals * deal + (qty - deals * packs) * unit

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = ROOT / "data" / "snapshot"
RETAILERS = ["fairprice", "cold-storage", "redmart"]


def expected_cents(price: str, savings: str, qty: int) -> tuple[int | None, str]:
    """Our line total for `qty` packs, and the deal it used, from live price and wording."""
    offer = derive_offer({"Product Price": price, "Original Price": "", "Savings": savings})
    if not offer["eligible"]:
        return None, ""
    unit, deal = offer["unit_price_cents"], offer["multibuy"]
    if deal is None:
        return unit * qty, "no deal applied"
    deals = qty // deal["packsPerDeal"]
    rest = qty - deals * deal["packsPerDeal"]
    return deals * deal["dealPriceCents"] + rest * unit, f"{deal['packsPerDeal']} for {deal['dealPriceCents'] / 100:.2f}"


def classify(row: dict) -> dict:
    """What one checked item shows: its kind, our expected amount and whether the cart agreed.

    kind is "deal" (a fixed-price deal we apply, checked in a cart), "plain" (no
    deal on the page, checked in a cart), "percentage" (a percentage deal we no
    longer apply; `agree` says whether the former percentage rule matched the
    cart), "terms" (live product-page terms only, no cart) or "unchecked".
    """
    qty = int(row["qty"])
    expected, deal = expected_cents(row["live_price"], row["live_savings"], qty)
    if row["note"] == "terms only":
        return {"kind": "terms", "expected": expected, "deal": deal, "cart": None, "agree": None}
    cart = to_cents(row["cart_subtotal"]) if row["cart_subtotal"] else None
    if cart is None:
        return {"kind": "unchecked", "expected": None, "deal": "", "cart": None, "agree": None}
    former = percentage_rule_cents(row["live_price"], row["live_savings"], qty)
    if former is not None:
        return {"kind": "percentage", "expected": former, "deal": "not applied (percentage)", "cart": cart, "agree": former == cart}
    kind = "plain" if deal == "no deal applied" else "deal"
    return {"kind": kind, "expected": expected, "deal": deal, "cart": cart, "agree": expected == cart}


def money(cents: int | None) -> str:
    return "" if cents is None else f"{cents / 100:.2f}"


def main() -> None:
    sections, counts = [], {}
    for retailer in RETAILERS:
        path = SNAPSHOT / f"checkout-{retailer}.csv"
        if not path.exists():
            sections += [f"## {retailer}", "", "Not checked yet.", ""]
            continue
        rows = list(csv.DictReader(open(path, encoding="utf-8")))
        sections += [
            f"## {retailer}",
            "",
            "| Product | Qty | Unit | Deal wording | Our deal | Expected | Cart | Result |",
            "| --- | ---: | ---: | --- | --- | ---: | ---: | --- |",
        ]
        tally = Counter()
        for row in rows:
            c = classify(row)
            tally[c["kind"]] += 1
            tally[c["kind"] + " agree"] += bool(c["agree"])
            name = row["url"].rstrip("/").rsplit("/", 1)[-1].removesuffix(".html")
            note = f" ({row['note']})" if row["note"] and row["note"] != "terms only" else ""
            if c["kind"] == "terms":
                result = "terms checked, no cart"
            elif c["kind"] == "unchecked":
                result = "not checked"
            elif c["kind"] == "percentage":
                diff = c["cart"] - c["expected"]
                result = "former percentage rule matched" if c["agree"] else f"**former percentage rule off by {diff}¢**"
            else:
                result = "match" if c["agree"] else f"**differs by {c['cart'] - c['expected']}¢**"
            sections.append(
                f"| {name} | {row['qty']} | {row['live_price']} | {row['live_savings'].replace('|', '\\|')} | "
                f"{c['deal']} | {money(c['expected'])} | {money(c['cart'])} | {result}{note} |"
            )
        parts = []
        if tally["deal"]:
            parts.append(f"Fixed-price deals in a cart: {tally['deal agree']} of {tally['deal']} match.")
        if tally["plain"]:
            parts.append(f"Items whose deal had ended, in a cart: {tally['plain agree']} of {tally['plain']} match.")
        if tally["percentage"]:
            parts.append(
                f"Percentage deals in a cart: the former percentage rule matched {tally['percentage agree']} of "
                f"{tally['percentage']}, so percentage deals are no longer applied."
            )
        if tally["terms"]:
            parts.append(f"{tally['terms']} deals checked against live product-page terms only; the cart needs a login.")
        sections += ["", " ".join(parts), ""]
        counts[retailer] = tally

    carted = {r: t for r, t in counts.items() if t["deal"]}
    deal_line = ", ".join(f"{r} {t['deal agree']} of {t['deal']}" for r, t in carted.items())
    terms_only = [r for r, t in counts.items() if t["terms"] and not t["deal"]]
    lines = [
        "# Checkout evidence for multibuys (PR-03)",
        "",
        "Generated by `scripts/checkout_evidence.py`. Each sampled deal was put in a cart at one pack more",
        "than the deal needs, so the remaining pack is tested too. *Expected* applies our curation and",
        "pricing rules to the live unit price and deal wording; *Cart* is the retailer's own subtotal.",
        "Nothing was ordered. FairPrice carts were filled as a guest by `scripts/scrape/checkout.ts`;",
        "RedMart's were filled by hand in a logged-in session (Lazada blocks scripted logins) and recorded",
        "in `checkout-redmart.csv`; Cold Storage's cart needs a login, so its deals were checked against",
        "their live product pages only.",
        "",
        f"**Finding.** Fixed-price deals (\"N for $X\") checked in a cart "
        + ("all matched" if all(t["deal agree"] == t["deal"] for t in carted.values()) else "did not all match")
        + f": {deal_line}."
        + (f" {', '.join(terms_only)} was checked against product-page terms only, not a cart." if terms_only else ""),
        "Percentage deals did not reliably match: the cart charges a fixed deal price and the percentage is a",
        "rounded label for it (\"Any 2 Save 40%\" charged $11.79 for $19.78, 40.4% off). Under PR-03 a deal",
        "type the checkout disagrees with stays excluded, so percentage deals are no longer applied; they",
        "show as not included in the estimate.",
        "",
        *sections,
    ]
    (SNAPSHOT / "checkout-evidence.md").write_text("\n".join(lines), encoding="utf-8")
    for retailer, tally in counts.items():
        print(retailer, dict(tally))


if __name__ == "__main__":
    main()
