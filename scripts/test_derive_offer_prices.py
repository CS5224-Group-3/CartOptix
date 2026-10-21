"""Curation rules for prices and multibuys (PR-03). Run: python3 -m unittest discover scripts"""

import unittest

from derive_offer_prices import derive_offer, parse_multibuy


def row(price: str, savings: str = "", original: str = "") -> dict:
    return {"Product Price": price, "Original Price": original, "Savings": savings}


class ParseMultibuy(unittest.TestCase):
    def test_fixed_price_deals(self):
        self.assertEqual(
            parse_multibuy("Any 2 At $6.55", 350),
            {"packsPerDeal": 2, "dealPriceCents": 655, "mixAndMatch": True},
        )
        self.assertEqual(
            parse_multibuy("Buy 2 At $4.5", 300),
            {"packsPerDeal": 2, "dealPriceCents": 450, "mixAndMatch": False},
        )

    def test_each_retailers_wording(self):
        self.assertEqual(parse_multibuy("Any 2 @ $6.55", 350)["dealPriceCents"], 655)
        self.assertEqual(parse_multibuy("Any 2 For $6.30", 388)["dealPriceCents"], 630)
        self.assertEqual(parse_multibuy("Buy 2 Save 13%", 635)["dealPriceCents"], 1105)

    def test_percentage_rounds_half_up_once_per_deal(self):
        # 2 × 333 = 666; 15% off = 566.1 → 566.
        self.assertEqual(parse_multibuy("Any 2 Save 15%", 333)["dealPriceCents"], 566)
        # 3 × 335 = 1005; 10% off = 904.5 → 905, not 904.
        self.assertEqual(parse_multibuy("Any 3 Save 10%", 335)["dealPriceCents"], 905)
        # 2 × 1005 = 2010; 5% off = 1909.5 → 1910.
        self.assertEqual(parse_multibuy("Buy 2 Get 5% Off", 1005)["dealPriceCents"], 1910)

    def test_fixed_saving(self):
        self.assertEqual(parse_multibuy("Any 2 Save $2.06", 500)["dealPriceCents"], 794)

    def test_rejects_deals_that_are_not_cheaper_or_not_multibuys(self):
        self.assertIsNone(parse_multibuy("Any 2 At $9", 400))
        self.assertIsNone(parse_multibuy("Any 2 At $8", 400))
        self.assertIsNone(parse_multibuy("Any 2 Save 5%", 1))
        self.assertIsNone(parse_multibuy("Any 1 At $1", 400))
        self.assertIsNone(parse_multibuy("Spend $30 + Free Gift", 100))
        self.assertIsNone(parse_multibuy("Save $1.00", 400))


class DeriveOffer(unittest.TestCase):
    def test_applies_a_multibuy_with_its_dates_removed(self):
        offer = derive_offer(row("10.05", "Buy 2 Get 5% Off (1/9 - 30/9)"))
        self.assertEqual(offer["multibuy"]["dealPriceCents"], 1910)
        self.assertEqual(offer["excluded_promotions"], [])

    def test_never_stacks_a_multibuy_on_a_sale(self):
        offer = derive_offer(row("3.00", "Any 2 Save 10%", original="$4.00"))
        self.assertEqual(offer["price_kind"], "unconditional_sale")
        self.assertEqual(offer["original_price_cents"], 400)
        self.assertIsNone(offer["multibuy"])
        self.assertEqual(offer["excluded_promotions"], ["Any 2 Save 10%"])

    def test_keeps_other_promotions_as_the_retailer_worded_them(self):
        offer = derive_offer(row("5.00", "Spend $30 + Free Gift"))
        self.assertIsNone(offer["multibuy"])
        self.assertEqual(offer["excluded_promotions"], ["Spend $30 + Free Gift"])

    def test_several_promotions_keep_the_multibuy_and_exclude_the_rest(self):
        offer = derive_offer(row("3.50", "Spend $30 + Free Gift | Any 2 @ $6.55 | Buy 3 Get Free Bag"))
        self.assertEqual(offer["multibuy"]["dealPriceCents"], 655)
        self.assertEqual(offer["excluded_promotions"], ["Spend $30 + Free Gift", "Buy 3 Get Free Bag"])

    def test_a_sale_keeps_its_conditional_offers_as_excluded(self):
        offer = derive_offer(row("3.00", "Save $1.00 | Spend $15 + Free Gift", original="$4.00"))
        self.assertEqual(offer["excluded_promotions"], ["Spend $15 + Free Gift"])

    def test_a_sales_plain_saving_is_not_a_promotion(self):
        offer = derive_offer(row("3.00", "Save $1.00", original="$4.00"))
        self.assertEqual(offer["excluded_promotions"], [])


if __name__ == "__main__":
    unittest.main()
