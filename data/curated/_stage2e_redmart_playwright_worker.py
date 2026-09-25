
import sys
import re
import time
import html as html_lib
from pathlib import Path

import pandas as pd
from playwright.sync_api import sync_playwright


INPUT_CSV = Path(sys.argv[1])
OUTPUT_CSV = Path(sys.argv[2])
DELAY_SECONDS = float(sys.argv[3])
MIN_TITLE_SCORE = float(sys.argv[4])
MAX_BADGE_GAP = float(sys.argv[5])


IDENTITY_STOPWORDS = {
    "the", "and", "with", "for", "from", "of", "by", "a", "an",
    "pack", "packs", "packet", "bag", "box", "bottle", "bottles",
    "can", "cans", "pcs", "pc", "piece", "pieces", "per", "each",
    "g", "kg", "mg", "ml", "l", "x",
}


def normalize_text(text):
    if text is None or pd.isna(text):
        return ""
    text = html_lib.unescape(str(text)).casefold()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def meaningful_tokens(text):
    return {
        token
        for token in normalize_text(text).split()
        if (
            token not in IDENTITY_STOPWORDS
            and len(token) >= 2
            and not token.isdigit()
        )
    }


def text_token_coverage(source_text, candidate_text):
    source_tokens = meaningful_tokens(source_text)
    candidate_tokens = meaningful_tokens(candidate_text)
    if not source_tokens:
        return 0.0
    return len(source_tokens & candidate_tokens) / len(source_tokens)


def get_visible_dom_candidates(page, selector, max_items=300):
    locator = page.locator(selector)
    try:
        count = min(locator.count(), max_items)
    except Exception:
        return []

    records = []

    for idx in range(count):
        item = locator.nth(idx)
        try:
            if not item.is_visible():
                continue

            box = item.bounding_box()
            if not box:
                continue

            try:
                text_value = item.inner_text(timeout=1500)
            except Exception:
                text_value = ""

            attrs = {}
            for attr in ["alt", "title", "aria-label", "src", "class"]:
                try:
                    attrs[attr] = item.get_attribute(attr)
                except Exception:
                    attrs[attr] = None

            records.append(
                {
                    "text": (text_value or "").strip(),
                    "x": float(box["x"]),
                    "y": float(box["y"]),
                    "width": float(box["width"]),
                    "height": float(box["height"]),
                    **attrs,
                }
            )
        except Exception:
            continue

    return records


def choose_product_title_candidate(page, source_product_name):
    selector = (
        "h1, h2, h3, "
        "[class*='pdp-mod-product-badge-title'], "
        "[class*='product-badge-title'], "
        "[class*='product-title'], "
        "[class*='productTitle'], "
        "[class*='pdp-title'], "
        "[class*='pdpTitle']"
    )

    scored = []

    for item in get_visible_dom_candidates(page, selector, max_items=300):
        text_value = item["text"]
        if len(text_value) < 3 or len(text_value) > 300:
            continue

        score = text_token_coverage(
            source_product_name,
            text_value,
        )

        scored.append(
            {
                **item,
                "title_match_score": float(score),
            }
        )

    if not scored:
        return None

    scored.sort(
        key=lambda item: (
            item["title_match_score"],
            -abs(item["y"]),
        ),
        reverse=True,
    )
    return scored[0]


def get_redmart_badge_candidates(page):
    selector = (
        "[alt*='redmart' i], "
        "[title*='redmart' i], "
        "[aria-label*='redmart' i], "
        "img[src*='redmart' i], "
        "[class*='redmart' i]"
    )

    candidates = get_visible_dom_candidates(
        page,
        selector,
        max_items=500,
    )

    # Also inspect visible elements whose own text is exactly "redmart".
    try:
        text_locator = page.get_by_text(
            re.compile(r"^\s*redmart\s*$", re.IGNORECASE)
        )
        text_count = min(text_locator.count(), 100)

        for idx in range(text_count):
            item = text_locator.nth(idx)
            try:
                if not item.is_visible():
                    continue
                box = item.bounding_box()
                if not box:
                    continue
                candidates.append(
                    {
                        "text": (item.inner_text(timeout=1500) or "").strip(),
                        "x": float(box["x"]),
                        "y": float(box["y"]),
                        "width": float(box["width"]),
                        "height": float(box["height"]),
                        "alt": item.get_attribute("alt"),
                        "title": item.get_attribute("title"),
                        "aria-label": item.get_attribute("aria-label"),
                        "src": item.get_attribute("src"),
                        "class": item.get_attribute("class"),
                    }
                )
            except Exception:
                continue
    except Exception:
        pass

    filtered = []
    seen = set()

    for item in candidates:
        evidence_blob = " ".join(
            str(item.get(key) or "")
            for key in [
                "text", "alt", "title",
                "aria-label", "src", "class",
            ]
        ).casefold()

        if "redmart" not in evidence_blob:
            continue

        key = (
            round(item["x"], 1),
            round(item["y"], 1),
            round(item["width"], 1),
            round(item["height"], 1),
            normalize_text(evidence_blob)[:200],
        )

        if key in seen:
            continue

        seen.add(key)
        filtered.append(item)

    return filtered


def badge_is_near_product_title(badge, title):
    if badge is None or title is None:
        return False

    badge_left = badge["x"]
    badge_right = badge["x"] + badge["width"]
    badge_top = badge["y"]
    badge_bottom = badge["y"] + badge["height"]

    title_left = title["x"]
    title_right = title["x"] + title["width"]
    title_top = title["y"]
    title_bottom = title["y"] + title["height"]

    vertical_gap = title_top - badge_bottom

    vertically_near = (
        -80 <= vertical_gap <= MAX_BADGE_GAP
    )

    horizontally_near = (
        badge_right >= title_left - 250
        and badge_left <= title_right + 250
    )

    same_product_region = (
        badge_top >= title_top - 350
        and badge_top <= title_bottom + 100
    )

    return (
        vertically_near
        and horizontally_near
        and same_product_region
    )


def clean_seller(value):
    if value is None:
        return ""
    return re.sub(
        r"\s+",
        " ",
        html_lib.unescape(str(value)),
    ).strip(" \t\r\n\"'{}[],:;")


def extract_seller_candidates(rendered_html, body_text):
    candidates = []

    patterns = [
        r'"sellerName"\s*:\s*"([^"]{1,120})"',
        r'"seller_name"\s*:\s*"([^"]{1,120})"',
        r'"sellerDisplayName"\s*:\s*"([^"]{1,120})"',
        r'"shopName"\s*:\s*"([^"]{1,120})"',
    ]

    for pattern in patterns:
        for match in re.finditer(
            pattern,
            rendered_html or "",
            flags=re.IGNORECASE,
        ):
            seller = clean_seller(match.group(1))
            if seller:
                candidates.append(seller)

    # Keep visible seller fallback intentionally narrow.
    visible_patterns = [
        r"\bsold\s+by\s+([A-Za-z0-9&.'() _\-]{2,80})",
        r"\bseller\s*:\s*([A-Za-z0-9&.'() _\-]{2,80})",
    ]

    for pattern in visible_patterns:
        for match in re.finditer(
            pattern,
            (body_text or "")[:50000],
            flags=re.IGNORECASE,
        ):
            seller = clean_seller(match.group(1))
            seller = re.split(
                r"\s{2,}|\b(?:rating|ship|delivery|voucher|chat|visit store|add to cart)\b",
                seller,
                maxsplit=1,
                flags=re.IGNORECASE,
            )[0].strip()
            if seller:
                candidates.append(seller)

    # Deduplicate.
    result = []
    seen = set()

    for seller in candidates:
        normalized = normalize_text(seller)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(seller)

    return result


def interpret_seller(candidates):
    if not candidates:
        return None, "NO_EXPLICIT_SELLER_EVIDENCE", None

    normalized = {
        normalize_text(value): value
        for value in candidates
    }

    redmart = {
        key: value
        for key, value in normalized.items()
        if key in {"redmart", "red mart"}
    }

    other = {
        key: value
        for key, value in normalized.items()
        if key not in {"redmart", "red mart"}
    }

    if redmart and not other:
        return "RedMart", "EXPLICIT_SELLER_REDMART", True

    if other and not redmart:
        return (
            " | ".join(sorted(set(other.values()))[:5]),
            "EXPLICIT_NON_REDMART_SELLER",
            False,
        )

    return (
        "MULTIPLE_CONFLICTING_SELLERS",
        "CONFLICTING_SELLER_SIGNALS",
        None,
    )


def inspect_one(page, row):
    source_url = str(row["product_url_raw"])

    try:
        response = page.goto(
            source_url,
            wait_until="domcontentloaded",
            timeout=35000,
        )
        page.wait_for_timeout(3500)

        rendered_html = page.content()

        try:
            body_text = page.locator("body").inner_text(timeout=5000)
        except Exception:
            body_text = ""

        try:
            browser_title = page.title()
        except Exception:
            browser_title = ""

        final_url = page.url
        status_code = response.status if response is not None else 200

    except Exception as exc:
        return {
            "source_record_id": str(row["source_record_id"]),
            "canonical_product_id": str(row["canonical_product_id"]),
            "retailer": row["retailer"],
            "product_name_raw": row["product_name_raw"],
            "product_url_raw": row["product_url_raw"],
            "final_url": pd.NA,
            "http_status": pd.NA,
            "rendered_page_title": pd.NA,
            "rendered_product_title": pd.NA,
            "rendered_product_title_score": 0.0,
            "redmart_channel_detected": False,
            "redmart_badge_near_product_title": False,
            "redmart_badge_evidence": pd.NA,
            "seller_name": pd.NA,
            "seller_evidence": "BROWSER_FETCH_FAILED",
            "browser_fulfilment_status": "UNKNOWN",
            "browser_confidence": "LOW",
            "browser_verification_method": "PLAYWRIGHT_FETCH_FAILED",
            "browser_evidence": f"{type(exc).__name__}: {exc}",
            "verification_run_timestamp_utc": pd.Timestamp.now(
                tz="UTC"
            ).isoformat(),
        }

    normalized_body = normalize_text(body_text)

    redmart_channel_detected = (
        "search in redmart" in normalized_body
        or "redmart groceries" in normalized_body
        or "redmart grocery" in normalized_body
    )

    title_candidate = choose_product_title_candidate(
        page,
        row["product_name_raw"],
    )

    if title_candidate is None:
        title_text = ""
        title_score = 0.0
    else:
        title_text = title_candidate["text"]
        title_score = float(
            title_candidate["title_match_score"]
        )

    badge_candidates = get_redmart_badge_candidates(page)

    near_badges = [
        badge
        for badge in badge_candidates
        if badge_is_near_product_title(
            badge,
            title_candidate,
        )
    ]

    badge_near_title = len(near_badges) > 0

    if near_badges:
        badge = sorted(
            near_badges,
            key=lambda item: abs(
                title_candidate["y"]
                - (item["y"] + item["height"])
            ),
        )[0]

        badge_evidence = " | ".join(
            value
            for value in [
                str(badge.get("text") or "").strip(),
                str(badge.get("alt") or "").strip(),
                str(badge.get("title") or "").strip(),
                str(badge.get("aria-label") or "").strip(),
                str(badge.get("src") or "").strip(),
                str(badge.get("class") or "").strip(),
            ]
            if value
        )[:500]
    else:
        badge_evidence = pd.NA

    seller_candidates = extract_seller_candidates(
        rendered_html,
        body_text,
    )
    seller_name, seller_evidence, seller_is_redmart = interpret_seller(
        seller_candidates
    )

    status = "UNKNOWN"
    confidence = "LOW"
    method = "PLAYWRIGHT_REDMART_INCONCLUSIVE"
    evidence_note = (
        "Rendered page did not provide enough evidence."
    )

    if (
        seller_is_redmart is True
        and title_score >= MIN_TITLE_SCORE
    ):
        status = "VERIFIED_DIRECT"
        confidence = "HIGH"
        method = "PLAYWRIGHT_EXPLICIT_REDMART_SELLER"
        evidence_note = (
            "Rendered page explicitly identified seller as RedMart "
            "and the product-title region matched the source product."
        )

    elif seller_is_redmart is False:
        status = "NOT_DIRECT"
        confidence = "HIGH"
        method = "PLAYWRIGHT_EXPLICIT_NON_REDMART_SELLER"
        evidence_note = (
            "Rendered page exposed an explicit seller that was not RedMart."
        )

    elif (
        redmart_channel_detected
        and badge_near_title
        and title_score >= MIN_TITLE_SCORE
    ):
        status = "VERIFIED_REDMART_CHANNEL"
        confidence = "HIGH"
        method = "PLAYWRIGHT_REDMART_BADGE_NEAR_PRODUCT_TITLE"
        evidence_note = (
            "Rendered page was in the RedMart grocery channel, "
            "the intended product title matched, and a RedMart badge/logo "
            "was detected near the product title. No explicit seller field "
            "was available, so this is channel verification."
        )

    return {
        "source_record_id": str(row["source_record_id"]),
        "canonical_product_id": str(row["canonical_product_id"]),
        "retailer": row["retailer"],
        "product_name_raw": row["product_name_raw"],
        "product_url_raw": row["product_url_raw"],
        "final_url": final_url,
        "http_status": int(status_code),
        "rendered_page_title": browser_title,
        "rendered_product_title": title_text or pd.NA,
        "rendered_product_title_score": round(title_score, 4),
        "redmart_channel_detected": bool(redmart_channel_detected),
        "redmart_badge_near_product_title": bool(badge_near_title),
        "redmart_badge_evidence": badge_evidence,
        "seller_name": seller_name if seller_name else pd.NA,
        "seller_evidence": seller_evidence,
        "browser_fulfilment_status": status,
        "browser_confidence": confidence,
        "browser_verification_method": method,
        "browser_evidence": evidence_note,
        "verification_run_timestamp_utc": pd.Timestamp.now(
            tz="UTC"
        ).isoformat(),
    }


def main():
    pending = pd.read_csv(
        INPUT_CSV,
        dtype={
            "source_record_id": "string",
            "canonical_product_id": "string",
        },
        low_memory=False,
    )

    records = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True
        )

        context = browser.new_context(
            locale="en-SG",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/153.0 Safari/537.36"
            ),
            viewport={
                "width": 1600,
                "height": 1000,
            },
        )

        page = context.new_page()

        rows = pending.to_dict(orient="records")

        for counter, row in enumerate(rows, start=1):
            records.append(
                inspect_one(page, row)
            )

            if counter % 10 == 0 or counter == len(rows):
                print(
                    f"Browser checked {counter:,}/{len(rows):,}",
                    flush=True,
                )

            time.sleep(DELAY_SECONDS)

        browser.close()

    pd.DataFrame(records).to_csv(
        OUTPUT_CSV,
        index=False,
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
