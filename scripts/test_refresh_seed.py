"""Snapshot refresh rules (scripts/refresh_seed.py). Run: python3 -m unittest discover scripts"""

import unittest

from refresh_seed import exclusion


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
