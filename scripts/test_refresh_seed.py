"""Snapshot refresh rules (scripts/refresh_seed.py). Run: python3 -m unittest discover scripts"""

import unittest

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
