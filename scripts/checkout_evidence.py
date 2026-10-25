"""Compare live cart subtotals with our pricing rules (PR-03 checkout evidence).

Reads data/snapshot/checkout-<retailer>.csv (written by scripts/scrape/checkout.ts)
and writes data/snapshot/checkout-evidence.md. For each sampled deal, our rule
is applied to the *live* unit price and deal wording, so a price change since
the snapshot does not count as a disagreement. The cart subtotal must equal it,
except that a percentage deal may differ by its tolerance (see `expected_cents`).

Run from the repository root: python3 scripts/checkout_evidence.py
"""

import csv
from collections import Counter
from pathlib import Path

from derive_offer_prices import derive_offer, to_cents

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = ROOT / "data" / "snapshot"
RETAILERS = ["fairprice", "cold-storage", "redmart"]


def expected_cents(price: str, savings: str, qty: int) -> tuple[int | None, str, int | None]:
    """Our line total for `qty` packs, the deal it used, and, for a percentage deal, the tolerance.

    A percentage is the retailer's rounded label for a fixed deal price, so the
    true saving can be up to half a percentage point either side: per deal, up
    to 0.5% of N packs at the unit price, rounded to the cent (PR-03).
    """
    offer = derive_offer({"Product Price": price, "Original Price": "", "Savings": savings})
    if not offer["eligible"]:
        return None, "", None
    unit, deal = offer["unit_price_cents"], offer["multibuy"]
    if deal is None:
        return unit * qty, "no deal applied", None
    packs = deal["packsPerDeal"]
    deals = qty // packs
    total = deals * deal["dealPriceCents"] + (qty - deals * packs) * unit
    terms = f"{packs} for {deal['dealPriceCents'] / 100:.2f}"
    if deal["percentOff"] is None:
        return total, terms, None
    tolerance = deals * int(packs * unit * 0.005 + 0.5)
    return total, f"{terms} ({deal['percentOff']}% off)", tolerance


def classify(row: dict) -> dict:
    """What one checked item shows: its kind, our expected amount and whether the cart agreed.

    kind is "deal" (a fixed-price deal, which must match exactly), "percentage"
    (a percentage deal, which must be within `tolerance`), "plain" (no deal on
    the page), "terms" (live product-page terms only, no cart) or "unchecked".
    `exact` says whether the cart equals our amount.
    """
    qty = int(row["qty"])
    expected, deal, tolerance = expected_cents(row["live_price"], row["live_savings"], qty)
    if row["note"] == "terms only":
        return {"kind": "terms", "expected": expected, "deal": deal, "cart": None, "agree": None}
    cart = to_cents(row["cart_subtotal"]) if row["cart_subtotal"] else None
    if cart is None:
        return {"kind": "unchecked", "expected": None, "deal": "", "cart": None, "agree": None}
    kind = "plain" if deal == "no deal applied" else "deal" if tolerance is None else "percentage"
    agree = expected == cart if tolerance is None else abs(cart - expected) <= tolerance
    return {
        "kind": kind,
        "expected": expected,
        "deal": deal,
        "cart": cart,
        "agree": agree,
        "exact": expected == cart,
        "tolerance": tolerance,
    }


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
            live_savings = row["live_savings"].replace("|", "\\|")
            if c["kind"] == "terms":
                result = "terms checked, no cart"
            elif c["kind"] == "unchecked":
                result = "not checked"
            elif c["kind"] == "percentage":
                diff = c["cart"] - c["expected"]
                result = (
                    "match"
                    if c["exact"]
                    else f"{'within' if c['agree'] else '**outside**'} ±{c['tolerance']}¢ ({diff:+}¢)"
                )
                tally["percentage exact"] += c["exact"]
            else:
                result = "match" if c["agree"] else f"**differs by {c['cart'] - c['expected']}¢**"
            sections.append(
                f"| {name} | {row['qty']} | {row['live_price']} | {live_savings} | "
                f"{c['deal']} | {money(c['expected'])} | {money(c['cart'])} | {result}{note} |"
            )
        parts = []
        if tally["deal"]:
            parts.append(f"Fixed-price deals in a cart: {tally['deal agree']} of {tally['deal']} match.")
        if tally["plain"]:
            parts.append(f"Items whose deal had ended, in a cart: {tally['plain agree']} of {tally['plain']} match.")
        if tally["percentage"]:
            parts.append(
                f"Percentage deals in a cart: {tally['percentage exact']} of {tally['percentage']} match exactly, "
                f"{tally['percentage agree']} of {tally['percentage']} within their tolerance."
            )
        if tally["terms"]:
            parts.append(f"{tally['terms']} deals checked against live product-page terms only; the cart needs a login.")
        sections += ["", " ".join(parts), ""]
        counts[retailer] = tally

    carted = {r: t for r, t in counts.items() if t["deal"]}
    deal_line = ", ".join(f"{r} {t['deal agree']} of {t['deal']}" for r, t in carted.items())
    terms_only = [r for r, t in counts.items() if t["terms"] and not t["deal"]]
    pct_line = ", ".join(
        f"{r} {t['percentage exact']} of {t['percentage']} exact and {t['percentage agree']} within tolerance"
        for r, t in counts.items()
        if t["percentage"]
    )
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
        "",
        f"Percentage deals (\"N save X%\") checked in a cart: {pct_line}. The cart charges a fixed",
        "deal price and the percentage is the retailer's rounded label for it (\"Any 2 Save 40%\" charged",
        "$11.79 for $19.78, 40.4% off), so the true saving can be up to half a percentage point either side.",
        "We apply the labelled percentage, and the tolerance is 0.5% of a deal's packs at the unit price, per",
        "deal; the shopper is told a percentage deal's price may differ by a few cents (PR-03).",
        "",
        *sections,
    ]
    (SNAPSHOT / "checkout-evidence.md").write_text("\n".join(lines), encoding="utf-8")
    for retailer, tally in counts.items():
        print(retailer, dict(tally))


if __name__ == "__main__":
    main()
