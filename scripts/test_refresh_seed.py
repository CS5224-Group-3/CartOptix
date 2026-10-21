"""Snapshot refresh rules (scripts/refresh_seed.py). Run: python3 -m unittest discover scripts"""

import unittest

import refresh_seed

from refresh_seed import build, exclusion


def row(**overrides) -> dict:
    base = {
        "status": "ok",
        "retailer": "redmart",
        "product url": "https://www.lazada.sg/products/pdp-i1-s1.html",
        "Product Price": "3.88",
        "Original Price": "",
        "Savings": "",
        "in-stock": "Yes",
        "seller": "RedMart",
    }
    return {**base, **overrides}


class Exclusion(unittest.TestCase):
    def test_an_in_stock_redmart_listing_is_eligible(self):
        self.assertIsNone(exclusion(row(), {}))

    def test_gone_out_of_stock_and_unpriced_listings_are_not(self):
        self.assertEqual(exclusion(row(status="not_found"), {}), "page gone")
        self.assertEqual(exclusion(row(status="skipped"), {}), "not collected (Lazada check)")
        self.assertEqual(exclusion(row(**{"in-stock": "No"}), {}), "out of stock")
        self.assertEqual(exclusion(row(**{"Product Price": "0"}), {}), "no reliable price")

    def test_third_party_redmart_sellers_are_dropped(self):
        self.assertEqual(exclusion(row(seller="Sea Boss"), {}), "third-party seller")

    def test_an_unreadable_seller_needs_a_hand_check(self):
        url = row()["product url"]
        self.assertEqual(exclusion(row(seller=""), {}), "seller unreadable")
        self.assertIsNone(exclusion(row(seller=""), {url: "RedMart"}))
        self.assertEqual(exclusion(row(seller=""), {url: "Delyco"}), "third-party seller")

    def test_other_retailers_sell_their_own_listings(self):
        self.assertIsNone(exclusion(row(retailer="fairprice", seller=""), {}))


if __name__ == "__main__":
    unittest.main()


FP = "https://www.fairprice.com.sg/product/rice-1kg-1"
CS = "https://coldstorage.com.sg/product/rice-1kg"


def observation(retailer: str, url: str, **overrides) -> dict:
    return {
        "status": "ok",
        "retailer": retailer,
        "product url": url,
        "Product Name": "Rice 1kg",
        "Product Price": "3.00",
        "Original Price": "",
        "Specification": "1kg",
        "Savings": "",
        "in-stock": "Yes",
        "Image URL": "",
        "seller": "",
        **overrides,
    }


PRODUCT = {"productId": "rice-1kg", "categoryId": "rice-and-noodles", "representativeName": "Rice 1kg", "imageUrl": None}
LISTINGS = [
    {"listingId": "fairprice-rice-1kg-1", "productId": "rice-1kg", "retailerId": "fairprice", "productUrl": FP, "specification": "1kg"},
    {"listingId": "cold-storage-rice-1kg", "productId": "rice-1kg", "retailerId": "cold-storage", "productUrl": CS, "specification": "1kg"},
]
EMPTY = {"products": [], "listings": []}


def run(seed, retired, observed):
    return build(seed, retired, {o["product url"]: o for o in observed}, [], {}, {}, {})


class Build(unittest.TestCase):
    def test_refuses_a_snapshot_missing_an_observation(self):
        seed = {"products": [PRODUCT], "listings": LISTINGS}
        with self.assertRaises(SystemExit):
            run(seed, EMPTY, [observation("fairprice", FP)])

    def test_a_dropped_product_returns_under_its_id(self):
        seed = {"products": [PRODUCT], "listings": LISTINGS}
        dropped = run(seed, EMPTY, [observation("fairprice", FP), observation("cold-storage", CS, **{"in-stock": "No"})])
        self.assertEqual(dropped["products"], [])
        self.assertEqual([p["productId"] for p in dropped["retired"]["products"]], ["rice-1kg"])
        self.assertEqual({l["productUrl"] for l in dropped["retired"]["listings"]}, {FP, CS})
        self.assertNotIn("unitPriceCents", dropped["retired"]["listings"][0])

        back = run(EMPTY, dropped["retired"], [observation("fairprice", FP), observation("cold-storage", CS)])
        self.assertEqual([p["productId"] for p in back["products"]], ["rice-1kg"])
        self.assertEqual(back["products"][0]["categoryId"], "rice-and-noodles")
        self.assertEqual(back["retired"], EMPTY)

    def test_a_product_whose_pages_all_vanished_keeps_them_and_can_return(self):
        seed = {"products": [PRODUCT], "listings": LISTINGS}
        gone = [{**observation("fairprice", FP), "status": "not_found"}, {**observation("cold-storage", CS), "status": "not_found"}]
        dropped = run(seed, EMPTY, gone)
        self.assertEqual(dropped["retired"]["listings"], LISTINGS)
        back = run(EMPTY, dropped["retired"], [observation("fairprice", FP), observation("cold-storage", CS)])
        self.assertEqual([p["productId"] for p in back["products"]], ["rice-1kg"])

    def test_a_carried_over_listing_is_kept_exactly_as_the_seed_has_it(self):
        redmart_url = "https://www.lazada.sg/products/pdp-i1-s2.html"
        old = {
            "listingId": "redmart-pdp-i1-s2",
            "productId": "rice-1kg",
            "retailerId": "redmart",
            "sourceRecordId": "redmart_00000002",
            "name": "Rice 1KG",
            "specification": "1 kg",
            "productUrl": redmart_url,
            "priceKind": "ordinary",
            "unitPriceCents": 310,
            "originalPriceCents": None,
            "multibuy": {"packsPerDeal": 2, "dealPriceCents": 600, "mixAndMatch": True},
            "excludedPromotions": [],
        }
        seed = {"products": [PRODUCT], "listings": [*LISTINGS[:1], old]}
        carried = {**observation("redmart", redmart_url), "status": "carried", "Product Price": ""}
        recorded = {"raw_product_price": "3.10", "raw_original_price": "", "raw_savings": "Any 2 At $6.00"}
        refresh_seed.RECORDED.update({"redmart_00000002": recorded})
        try:
            result = run(seed, EMPTY, [observation("fairprice", FP), carried])
            self.assertIn(old, result["listings"])
            self.assertEqual(result["carried"], 1)
            # Today's rules reach the recorded wording: a percentage deal is no longer applied.
            refresh_seed.RECORDED["redmart_00000002"] = {**recorded, "raw_savings": "Any 2 Save 40%"}
            result = run(seed, EMPTY, [observation("fairprice", FP), carried])
            again = next(l for l in result["listings"] if l["listingId"] == "redmart-pdp-i1-s2")
            self.assertIsNone(again["multibuy"])
            self.assertEqual(again["excludedPromotions"], ["Any 2 Save 40%"])
        finally:
            refresh_seed.RECORDED.clear()

    def test_only_seed_redmart_listings_can_be_carried_over(self):
        seed = {"products": [PRODUCT], "listings": LISTINGS}
        carried = {**observation("cold-storage", CS), "status": "carried"}
        with self.assertRaises(SystemExit):
            run(seed, EMPTY, [observation("fairprice", FP), carried])
        with self.assertRaises(SystemExit):
            run(EMPTY, RETIRED_WITH_REDMART, [*FRESH, {**observation("redmart", RM), "status": "carried"}])

    def test_a_retired_redmart_listing_is_skipped_under_carry_over_and_the_build_runs(self):
        result = run(EMPTY, RETIRED_WITH_REDMART, [*FRESH, {**observation("redmart", RM), "status": "skipped"}])
        self.assertEqual([p["productId"] for p in result["products"]], ["rice-1kg"])
        self.assertEqual({l["retailerId"] for l in result["listings"]}, {"fairprice", "cold-storage"})


RM = "https://www.lazada.sg/products/pdp-i9-s9.html"
RETIRED_WITH_REDMART = {
    "products": [PRODUCT],
    "listings": [*LISTINGS, {**LISTINGS[0], "listingId": "redmart-pdp-i9-s9", "retailerId": "redmart", "productUrl": RM}],
}
FRESH = [observation("fairprice", FP), observation("cold-storage", CS)]


class SuccessiveSnapshots(unittest.TestCase):
    def test_a_listing_a_snapshot_found_can_be_carried_over_by_the_next(self):
        # First snapshot: a fresh RedMart observation publishes a listing and records it.
        rm = "https://www.lazada.sg/products/pdp-i7-s7.html"
        seed = {"products": [PRODUCT], "listings": LISTINGS}
        candidate = {**observation("redmart", rm, seller="RedMart", Savings="Any 2 For $5.00"), "product_id": "rice-1kg", "similarity": "1.0"}
        decisions = {("rice-1kg", rm): {"decision": "MATCH", "confidence": "HIGH"}}
        observed = {o["product url"]: o for o in FRESH}
        first = build(seed, EMPTY, observed, [candidate], decisions, {}, {})
        found = next(l for l in first["listings"] if l["retailerId"] == "redmart")
        recorded = {o["source_record_id"]: o for o in first["observations"]}
        self.assertEqual(recorded[found["sourceRecordId"]]["raw_savings"], "Any 2 For $5.00")

        # Next snapshot carries RedMart over, using that recorded observation.
        next_seed = {"products": first["products"], "listings": first["listings"]}
        refresh_seed.RECORDED.update(recorded)
        try:
            second = run(next_seed, EMPTY, [*FRESH, {**observation("redmart", rm), "status": "carried"}])
        finally:
            refresh_seed.RECORDED.clear()
        self.assertIn(found, second["listings"])
        self.assertEqual(second["carried"], 1)
