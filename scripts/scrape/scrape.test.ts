import { describe, expect, it } from "vitest";
import { observe as coldStorage } from "./coldstorage.ts";
import { observe as fairprice, pageProduct } from "./fairprice.ts";
import { packKey, passesNameRules } from "./match.ts";
import { fromCsv, toCsv } from "./observation.ts";
import { isChallenge, observe as redmart, sellerFrom } from "./redmart.ts";

describe("FairPrice pages", () => {
  const store = { mrp: "3.88", discount: "0", stock: 76, status: "ENABLED" };
  const product = {
    name: "Barilla Italian Pasta - Penne Rigate",
    slug: "barilla-italian-pasta-penne-rigate-500g-13165406",
    status: "ENABLED",
    images: ["https://media.nedigital.sg/a.jpg"],
    brand: { name: "Barilla" },
    metaData: { DisplayUnit: "500g" },
    offers: [],
    storeSpecificData: [store],
  };

  it("reads a regular price", () => {
    expect(fairprice(product)).toMatchObject({
      "Product Price": "3.88",
      "Original Price": "",
      Specification: "500g",
      Savings: "",
      "in-stock": "Yes",
      brand: "Barilla",
    });
  });

  it("reads a discount as a sale with a plain saving", () => {
    const sale = {
      ...product,
      storeSpecificData: [{ ...store, discount: "0.93" }],
    };
    expect(fairprice(sale)).toMatchObject({
      "Product Price": "2.95",
      "Original Price": "3.88",
      Savings: "Save $0.93",
    });
  });

  it("keeps every offer's wording except the sale itself", () => {
    const deals = {
      ...product,
      storeSpecificData: [{ ...store, discount: "0.93" }],
      offers: [
        { shortDescriptionA: "*Buy 1* At $2.95" },
        { shortDescriptionA: "*Any 2* At $4.95" },
        { shortDescriptionA: "Spend $30 + Free Gift" },
      ],
    };
    expect(fairprice(deals).Savings).toBe("Save $0.93 | Any 2 At $4.95 | Spend $30 + Free Gift");
  });

  it("accepts only an empty product detail as evidence of removal", () => {
    const page = (value: unknown) => ({
      props: {
        pageProps: { product: { data: { page: { layouts: [{ name: "ProductDetail", value }] } } } },
      },
    });
    expect(pageProduct(page(null), "u")).toBe("not_found");
    expect(pageProduct(page(product), "u")).toMatchObject({ slug: product.slug });
    expect(() => pageProduct(page({ unexpected: true }), "u")).toThrow(/unexpected/);
    expect(() => pageProduct({ props: {} }, "u")).toThrow(/no product detail/);
  });

  it("reads no stock or a disabled product as out of stock", () => {
    expect(fairprice({ ...product, status: "DISABLED" })["in-stock"]).toBe("No");
    const empty = {
      ...product,
      storeSpecificData: [{ ...store, stock: 0 }],
    };
    expect(fairprice(empty)["in-stock"]).toBe("No");
  });

  it("keeps the listing's own link, which listing IDs come from", () => {
    const url = "https://www.fairprice.com.sg/product/13165406";
    expect(fairprice(product, url)["product url"]).toBe(url);
  });
});

describe("Cold Storage pages", () => {
  const product = {
    name: "Ayam Brand Pulled Chicken Buffalo 150g",
    slug: "ayam-pulled-chicken-buffalo-150g",
    price: 3.5,
    promoPrice: 3.5,
    image: "https://mcos.coldstorage.com.sg/a.jpg",
    inventoryStatus: "In Stock",
    discountLabel: "Any 2 @ $6.55",
    size: "150g",
  };

  it("keeps a multibuy label", () => {
    expect(coldStorage(product)).toMatchObject({
      "Product Price": "3.50",
      "Original Price": "",
      Savings: "Any 2 @ $6.55",
      "in-stock": "Yes",
    });
  });

  it("reads a promo price as a sale whose label is the plain saving", () => {
    expect(
      coldStorage({ ...product, price: 23.75, promoPrice: 21.9, discountLabel: "7% off" }),
    ).toMatchObject({ "Product Price": "21.90", "Original Price": "23.75", Savings: "Save $1.85" });
  });

  it("keeps a label that is not the sale's own discount", () => {
    expect(coldStorage({ ...product, discountLabel: "Free Tote Bag with $50 Spend" }).Savings).toBe(
      "Free Tote Bag with $50 Spend",
    );
    expect(
      coldStorage({ ...product, price: 4, promoPrice: 3, discountLabel: "Any 2 @ $5.50" }).Savings,
    ).toBe("Save $1.00 | Any 2 @ $5.50");
  });

  it("reads anything but In Stock as out of stock", () => {
    expect(coldStorage({ ...product, inventoryStatus: "Out of Stock" })["in-stock"]).toBe("No");
  });
});

describe("RedMart catalogue items", () => {
  const item = {
    itemId: "301080986",
    name: "Barilla Italian Pasta Penne Rigate - 500G",
    productUrl: "//www.lazada.sg/products/pdp-i301080986-s527102860.html?search=1",
    price: "3.88",
    originalPrice: null,
    inStock: true,
    packageInfo: "500 g",
    image: "https://sg-test-11.slatic.net/p/a.jpg",
    brandName: "Barilla",
    icons: [{ alias: "p_multibuy", text: "Any 2 For $6.30" }],
  };
  const url = "https://www.lazada.sg/products/pdp-i301080986-s527102860.html";

  it("reads price, pack size, multibuy badge, stock and the page's seller", () => {
    expect(redmart(item, url, "RedMart")).toMatchObject({
      "product url": url,
      "Product Price": "3.88",
      "Original Price": "",
      Specification: "500 g",
      Savings: "Any 2 For $6.30",
      "in-stock": "Yes",
      brand: "Barilla",
      seller: "RedMart",
    });
  });

  it("reads a crossed-out price as a sale and ignores other badges", () => {
    const sale = { ...item, price: "5.35", originalPrice: "5.95", icons: [{ alias: "soldOut" }] };
    expect(redmart(sale, url, "RedMart")).toMatchObject({
      "Product Price": "5.35",
      "Original Price": "5.95",
      Savings: "",
    });
  });

  it("keeps every promotion badge, not other badges", () => {
    const badges = {
      ...item,
      icons: [
        { alias: "p_multibuy", text: "Any 2 For $6.30" },
        { alias: "p_freegift", text: "Free Gift with $30 spend" },
        { alias: "soldOut", text: "SOLD OUT" },
      ],
    };
    expect(redmart(badges, url, "RedMart").Savings).toBe(
      "Any 2 For $6.30 | Free Gift with $30 spend",
    );
  });

  it("reads the seller structurally, and leaves an unclear page for a hand check", () => {
    const page = (extra: object, seller = { name: "RedMart" }) => ({
      data: { root: { fields: { price_grocer: {}, seller, ...extra } } },
    });
    const soldBy = { module: { subtitlePrefix: "Sold by:", subtitle: "Sea Boss" } };
    const reordered = { module: { subtitle: "Delyco", usp: [], subtitlePrefix: "Sold by:" } };
    expect(sellerFrom(page({}))).toBe("RedMart");
    expect(sellerFrom(page(soldBy))).toBe("Sea Boss");
    expect(sellerFrom(page(reordered))).toBe("Delyco");
    expect(sellerFrom(page({}, { name: "Other" }))).toBeNull();
    expect(sellerFrom({ data: { root: { fields: { seller: { name: "RedMart" } } } } })).toBeNull();
    expect(sellerFrom(null)).toBeNull();
    const two = { a: soldBy.module, b: { subtitlePrefix: "Sold by:", subtitle: "X" } };
    expect(sellerFrom(page(two))).toBeNull();
  });

  it("recognises Lazada's slider check", () => {
    expect(isChallenge("https://www.lazada.sg//catalog//_____tmd_____/punish?x5secdata=a")).toBe(
      true,
    );
    expect(isChallenge("https://www.lazada.sg/products/pdp-i1-s1.html")).toBe(false);
  });

  it("records a third-party seller, an unreadable one as empty, and no stock", () => {
    expect(redmart(item, url, "Sea Boss").seller).toBe("Sea Boss");
    expect(redmart(item, url, "").seller).toBe("");
    expect(redmart({ ...item, inStock: false }, url, "RedMart")["in-stock"]).toBe("No");
  });
});

describe("name rules", () => {
  const product = { name: "Ayam Brand Sardines in Tomato Sauce 155g", specification: "155g" };

  it("keeps pack count and per-pack size apart", () => {
    expect(packKey("155 g")).toBe("1x155g");
    expect(packKey("1kg")).toBe("1x1000g");
    expect(packKey("6 x 1.5L")).toBe("6x1500ml");
    expect(packKey("6 × 155 g")).toBe("6x155g");
    expect(packKey("Family pack")).toBeNull();
  });

  it("rejects the same total in another configuration, and a self-contradicting listing", () => {
    const kilo = { name: "Barilla Penne 1kg", specification: "1kg" };
    const pack = (name: string, specification: string) =>
      passesNameRules(kilo, { name, specification });
    expect(pack("Barilla Penne 2 x 500g", "2 x 500g")).toBe(false);
    expect(pack("Barilla Penne 500g", "1kg")).toBe(false);
    expect(pack("Barilla Penne", "1000 g")).toBe(true);
  });

  it("passes the same product under another retailer's name", () => {
    const hit = { name: "Ayam Brand Sardines In Tomato Sauce (Jitney)", specification: "155 g" };
    expect(passesNameRules(product, hit)).toBe(true);
  });

  it("rejects another pack size, a multipack, another brand or a different product", () => {
    for (const hit of [
      { name: "Ayam Brand Sardines in Tomato Sauce", specification: "425 g" },
      { name: "Ayam Brand Sardines In Tomato Sauce (6 X 155G)", specification: "6 × 155 g" },
      { name: "Del Monte Sardines in Tomato Sauce", specification: "155 g" },
      { name: "Ayam Brand Fried Mackerel in Chili Sauce", specification: "155 g" },
    ])
      expect(passesNameRules(product, hit), hit.name).toBe(false);
  });
});

describe("snapshot CSV", () => {
  it("round-trips commas, quotes, newlines and empty fields", () => {
    const rows = [
      { a: 'Say "hi", twice', b: "" },
      { a: "plain", b: "x\ny" },
    ];
    expect(fromCsv(toCsv(["a", "b"], rows))).toEqual(rows);
  });
});
