import unittest

from checkout_evidence import classify


def row(price, savings, qty, cart, note=""):
    return {"live_price": price, "live_savings": savings, "qty": str(qty), "cart_subtotal": cart, "note": note}


class Classify(unittest.TestCase):
    def test_fixed_price_deal_in_a_cart(self):
        c = classify(row("2.92", "Any 2 for $4.35", 3, "7.27"))
        self.assertEqual((c["kind"], c["expected"], c["agree"]), ("deal", 727, True))

    def test_item_without_a_deal_is_counted_apart(self):
        c = classify(row("2.55", "", 3, "7.65"))
        self.assertEqual((c["kind"], c["agree"]), ("plain", True))

    def test_percentage_deal_is_compared_with_the_former_rule(self):
        # 2 × 989 = 1978; 40% off = 1186.8 → 1187, + 989 = 2176; the cart charged 2168.
        c = classify(row("9.89", "Any 2 Save 40%", 3, "21.68"))
        self.assertEqual((c["kind"], c["expected"], c["agree"]), ("percentage", 2176, False))

    def test_terms_only_has_no_cart(self):
        c = classify(row("3.50", "Any 2 @ $6.55", 3, "", note="terms only"))
        self.assertEqual((c["kind"], c["cart"]), ("terms", None))


if __name__ == "__main__":
    unittest.main()
