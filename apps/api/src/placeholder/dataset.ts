/**
 * Placeholder dataset so the web UI can run end to end before the curated seed
 * and catalogue endpoints exist (#4, #9). Every value is synthetic, adapted from
 * the prototype frontend in #29; none is a verified retailer price or rule.
 * Replace this module when the real data source lands.
 */
import type {
  BasketCompareRequest,
  CatalogueResponse,
  PlanLine,
  Product,
  RetailerId,
} from "@cartoptix/contracts";

export interface PlaceholderListing {
  retailerId: RetailerId;
  unitPriceCents: number;
  excludedPromotions: string[];
}

/** A product and its eligible listings: direct fulfilment, in stock, ordinary price. */
export interface PlaceholderProduct {
  product: Product;
  listings: PlaceholderListing[];
}

export interface PlaceholderRetailerRule {
  deliveryFeeCents: number;
  freeDeliveryFromCents: number;
  minimumOrderCents: number;
  note: string;
}

const image = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=720&q=80`;

const product = (
  productId: string,
  categoryId: string,
  name: string,
  packSize: string,
  imageId: string,
): Product => ({ productId, categoryId, name, packSize, imageUrl: image(imageId) });

const listing = (
  retailerId: RetailerId,
  unitPriceCents: number,
  excludedPromotions: string[] = [],
): PlaceholderListing => ({ retailerId, unitPriceCents, excludedPromotions });

export const placeholderProducts: PlaceholderProduct[] = [
  {
    product: product(
      "r1",
      "rice-and-noodles",
      "Golden Harvest Jasmine Fragrant Rice, Thai Hom Mali",
      "5 kg",
      "photo-1586201375761-83865001e31c",
    ),
    listings: [listing("redmart", 520), listing("fairprice", 881), listing("cold-storage", 971)],
  },
  {
    product: product(
      "r2",
      "rice-and-noodles",
      "Noodle House Egg Noodles, Thin & springy",
      "400 g",
      "photo-1569718212165-3a8278d5f624",
    ),
    listings: [listing("redmart", 349), listing("fairprice", 331), listing("cold-storage", 421)],
  },
  {
    product: product(
      "d1",
      "drinks",
      "H2Go Mineral Water, Still natural",
      "6 × 1.5 L",
      "photo-1548839140-29a749e1cf4d",
    ),
    listings: [listing("redmart", 529), listing("fairprice", 511), listing("cold-storage", 601)],
  },
  {
    product: product(
      "d2",
      "drinks",
      "KopiKita Kopi-O Sachets, Less sugar",
      "20 × 18 g",
      "photo-1514432324607-a09d9b4aefdd",
    ),
    listings: [listing("redmart", 645), listing("fairprice", 627), listing("cold-storage", 717)],
  },
  {
    product: product(
      "da1",
      "dairy",
      "MeadowFresh Full Cream Milk, Fresh pasteurised",
      "1 L",
      "photo-1550583724-b2692b85b150",
    ),
    listings: [listing("redmart", 399), listing("fairprice", 290), listing("cold-storage", 471)],
  },
  {
    product: product(
      "da2",
      "dairy",
      "GreenPastures Greek Yogurt, Plain, high protein",
      "500 g",
      "photo-1488477181946-6428a0291777",
    ),
    listings: [listing("redmart", 699), listing("fairprice", 681), listing("cold-storage", 771)],
  },
  {
    product: product(
      "b1",
      "breakfast-foods",
      "Sunrise Corn Flakes, Original",
      "500 g",
      "photo-1517093157656-b9eccef91cb1",
    ),
    listings: [listing("redmart", 599), listing("fairprice", 329), listing("cold-storage", 671)],
  },
  {
    product: product(
      "b2",
      "breakfast-foods",
      "Orchard Rolled Oats, Wholegrain",
      "1 kg",
      "photo-1517673400267-0251440c45dc",
    ),
    listings: [listing("redmart", 739), listing("fairprice", 721), listing("cold-storage", 811)],
  },
  {
    product: product(
      "c1",
      "canned-and-packaged-food",
      "PantryPro Baked Beans, In tomato sauce",
      "420 g",
      "photo-1612392062631-94dd858cba88",
    ),
    listings: [
      listing("redmart", 289),
      listing("fairprice", 271),
      listing("cold-storage", 361, [
        "Shelf promotion shown in source notes, but terms could not be verified; excluded.",
      ]),
    ],
  },
  {
    product: product(
      "c2",
      "canned-and-packaged-food",
      "Island Harvest Tuna Chunks, In spring water",
      "185 g",
      "photo-1544943910-4c1dc44aab44",
    ),
    listings: [listing("redmart", 425), listing("fairprice", 407), listing("cold-storage", 497)],
  },
  {
    product: product(
      "c3",
      "canned-and-packaged-food",
      "Saucy Tomato Pasta Sauce, Basil & garlic",
      "500 g",
      "photo-1472476442910-44a20e994a7c",
    ),
    listings: [listing("redmart", 489), listing("fairprice", 471), listing("cold-storage", 561)],
  },
  {
    product: product(
      "s1",
      "snacks",
      "CrunchTime Potato Crisps, Sea salt",
      "150 g",
      "photo-1621939514649-280e2aa85f2d",
    ),
    listings: [listing("redmart", 399), listing("fairprice", 381), listing("cold-storage", 471)],
  },
  {
    product: product(
      "s2",
      "snacks",
      "NuttyTrail Mixed Nuts, Roasted & lightly salted",
      "250 g",
      "photo-1599599810769-bcde5a160d32",
    ),
    listings: [listing("fairprice", 881), listing("cold-storage", 971)],
  },
  {
    product: product(
      "s3",
      "snacks",
      "ChocoPop Chocolate Biscuits, Cocoa cream",
      "300 g",
      "photo-1558961363-fa8fdf82db70",
    ),
    listings: [listing("redmart", 450), listing("fairprice", 471), listing("cold-storage", 561)],
  },
  {
    product: product(
      "h1",
      "household-cleaning",
      "Sparkle Dishwashing Liquid, Lemon fresh",
      "750 ml",
      "photo-1585832770485-e68a5dbfad52",
    ),
    listings: [listing("redmart", 529), listing("fairprice", 511), listing("cold-storage", 601)],
  },
  {
    product: product(
      "h2",
      "household-cleaning",
      "FreshFold Laundry Detergent, Indoor dry",
      "2 kg",
      "photo-1604335399105-a0c585fd81a1",
    ),
    listings: [
      listing("redmart", 650),
      listing("fairprice", 1081, ["Member-only discount excluded; non-member pricing is used."]),
      listing("cold-storage", 1171),
    ],
  },
  {
    product: product(
      "h3",
      "household-cleaning",
      "HomeBright Drawstring Trash Bags, Extra strong",
      "30 bags",
      "photo-1611284446314-60a58ac0deb9",
    ),
    listings: [listing("redmart", 699), listing("fairprice", 681)],
  },
  {
    product: product(
      "t1",
      "toiletries-and-personal-care",
      "PureCare Bathroom Tissue, Soft 3-ply",
      "10 rolls",
      "photo-1584556812952-905ffd0c611a",
    ),
    listings: [listing("redmart", 899), listing("fairprice", 500), listing("cold-storage", 971)],
  },
  {
    product: product(
      "t2",
      "toiletries-and-personal-care",
      "DailyGlow Mint Toothpaste, Fresh mint",
      "120 g",
      "photo-1620916566398-39f1143ab7be",
    ),
    listings: [listing("redmart", 459), listing("fairprice", 441), listing("cold-storage", 531)],
  },
  {
    product: product(
      "t3",
      "toiletries-and-personal-care",
      "SoftNest Daily Shampoo, Botanical smooth",
      "650 ml",
      "photo-1556228578-8c89e6adf883",
    ),
    listings: [listing("redmart", 999), listing("cold-storage", 1071)],
  },
  {
    product: product(
      "ex1",
      "canned-and-packaged-food",
      "Island Pantry Small-batch Kaya, Pandan coconut",
      "250 g",
      "photo-1547592180-85f173990554",
    ),
    listings: [listing("redmart", 999)],
  },
  {
    product: product(
      "ex2",
      "snacks",
      "Harbour Bakehouse Sourdough Crackers, Sea salt",
      "180 g",
      "photo-1509440159596-0249088772ff",
    ),
    listings: [listing("fairprice", 731)],
  },
  {
    product: product(
      "dead1",
      "canned-and-packaged-food",
      "CartOptix Demo Limited-edition Pantry Box, Prototype listing",
      "1 box",
      "photo-1601563491222-3e86cfe7e7b4",
    ),
    listings: [],
  },
];

export const placeholderRules: Record<RetailerId, PlaceholderRetailerRule> = {
  redmart: {
    deliveryFeeCents: 599,
    freeDeliveryFromCents: 8000,
    minimumOrderCents: 2000,
    note: "Synthetic: S$5.99 standard delivery below S$80; S$20 minimum order.",
  },
  fairprice: {
    deliveryFeeCents: 499,
    freeDeliveryFromCents: 6000,
    minimumOrderCents: 1500,
    note: "Synthetic: S$4.99 standard delivery below S$60; S$15 minimum order; S$1.99 service charge.",
  },
  "cold-storage": {
    deliveryFeeCents: 799,
    freeDeliveryFromCents: 10000,
    minimumOrderCents: 3000,
    note: "Synthetic: S$7.99 standard delivery below S$100; S$30 minimum order.",
  },
};

export const placeholderCatalogue: CatalogueResponse = {
  retailers: [
    { retailerId: "redmart", name: "RedMart" },
    { retailerId: "fairprice", name: "FairPrice" },
    { retailerId: "cold-storage", name: "Cold Storage" },
  ],
  categories: [
    { categoryId: "rice-and-noodles", name: "Rice & Noodles" },
    { categoryId: "drinks", name: "Drinks" },
    { categoryId: "dairy", name: "Dairy" },
    { categoryId: "breakfast-foods", name: "Breakfast Foods" },
    { categoryId: "canned-and-packaged-food", name: "Canned & Packaged Food" },
    { categoryId: "snacks", name: "Snacks" },
    { categoryId: "household-cleaning", name: "Household Cleaning" },
    { categoryId: "toiletries-and-personal-care", name: "Toiletries & Personal Care" },
  ],
  delivery: {
    rules: (["redmart", "fairprice", "cold-storage"] as const).map((retailerId) => {
      const rule = placeholderRules[retailerId];
      return {
        retailerId,
        status: "verified",
        deliveryFeeCents: rule.deliveryFeeCents,
        freeDeliveryFromCents: rule.freeDeliveryFromCents,
        minimumOrderCents: rule.minimumOrderCents,
        note: rule.note,
      };
    }),
  },
};

/** Prices a placeholder listing for the offers route. */
export function planLine(
  line: BasketCompareRequest["lines"][number],
  listing: PlaceholderListing,
): PlanLine {
  return {
    productId: line.productId,
    quantity: line.quantity,
    listingId: `${line.productId}-${listing.retailerId}`,
    productUrl: `https://example.com/cartoptix-placeholder/${listing.retailerId}/${line.productId}`,
    priceKind: "ordinary",
    unitPriceCents: listing.unitPriceCents,
    itemCharges: [],
    lineTotalCents: listing.unitPriceCents * line.quantity,
    excludedPromotions: listing.excludedPromotions,
  };
}
