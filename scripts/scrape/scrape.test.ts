import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOptions } from "./args.ts";
import { loadCheckpoint, saveCheckpoint } from "./checkpoint.ts";
import { observe as coldStorage, searchResults as coldStorageSearch } from "./coldstorage.ts";
import {
  observe as fairprice,
  searchResults as fairpriceSearch,
  pageProduct,
} from "./fairprice.ts";
import { packKey, passesNameRules, searchQuery } from "./match.ts";
import {
  CANDIDATE_COLUMNS,
  candidateRow,
  fromCsv,
  needsSeller,
  type Observation,
  toCsv,
} from "./observation.ts";
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
    const unresolved = { page: "/productDetails", props: { pageProps: { query: {} } } };
    expect(pageProduct(unresolved, "u")).toBe("not_found");
    expect(() => pageProduct({ page: "/_error", props: { pageProps: {} } }, "u")).toThrow();
  });

  it("reads search results only from a results page, empty or not", () => {
    const page = (layouts: unknown) => ({
      props: { pageProps: { data: { data: { page: { layouts } } } } },
    });
    const results = page([
      { name: "ProductCollection", value: { collection: { product: [product] } } },
    ]);
    const none = page([{ name: "ProductCollection", value: { collection: { count: 0 } } }]);
    expect(fairpriceSearch(results, "q")).toHaveLength(1);
    expect(fairpriceSearch(none, "q")).toEqual([]);
    expect(() => fairpriceSearch(page([{ name: "Error" }]), "q")).toThrow(/unexpected/);
    expect(() => fairpriceSearch({}, "q")).toThrow(/unexpected/);
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

  it("reads search results only from a results page, empty or not", () => {
    const page = (text: string) =>
      `<script>self.__next_f.push([1,${JSON.stringify(text)}])</script>`;
    expect(
      coldStorageSearch(page(`x{"initialProducts":[${JSON.stringify(product)}]}`), "q"),
    ).toHaveLength(1);
    expect(
      coldStorageSearch(page('{"className":"page_search-results__empty__dyvDv"}'), "q"),
    ).toEqual([]);
    expect(() => coldStorageSearch(page('{"error":"Internal Server Error"}'), "q")).toThrow(
      /unexpected/,
    );
  });

  it("reads anything but In Stock as out of stock", () => {
    expect(coldStorage({ ...product, inventoryStatus: "Out of Stock" })["in-stock"]).toBe("No");
  });
});

describe("RedMart product pages", () => {
  const url = "https://www.lazada.sg/products/pdp-i301080986-s527102860.html";
  const page = (
    price: { priceNumber?: number; originalPriceNumber?: number } = { priceNumber: 3.88 },
    stock = 194,
    tags = [{ name: "Any 2 For $6.30" }],
  ) => ({
    data: {
      root: {
        fields: {
          product: {
            title: "Barilla Italian Pasta Penne Rigate - 500G",
            brand: { name: "Barilla" },
          },
          price_grocer: { "527102860": { data: { price } } },
          skuInfos: { "527102860": { stock, image: "//laz-img-sg.alicdn.com/p/a.jpg" } },
          product_attributes_grocer: {
            "527102860": { data: { attributes: [{ name: "Pack Size", value: "500 g" }] } },
          },
          promotionTags: { data: { "527102860": tags } },
          seller: { name: "RedMart" },
        },
      },
    },
  });

  it("reads price, pack size, promotion tags, stock and the seller", () => {
    expect(redmart(page(), url, "RedMart")).toMatchObject({
      "product url": url,
      "Product Name": "Barilla Italian Pasta Penne Rigate - 500G",
      "Product Price": "3.88",
      "Original Price": "",
      Specification: "500 g",
      Savings: "Any 2 For $6.30",
      "in-stock": "Yes",
      "Image URL": "https://laz-img-sg.alicdn.com/p/a.jpg",
      brand: "Barilla",
      seller: "RedMart",
    });
  });

  it("reads a crossed-out price as a sale, every promotion tag, and no stock", () => {
    const sale = page({ priceNumber: 5.35, originalPriceNumber: 5.95 }, 0, [
      { name: "Any 2 For $10" },
      { name: "Free Gift with $30 spend" },
    ]);
    expect(redmart(sale, url, "RedMart")).toMatchObject({
      "Product Price": "5.35",
      "Original Price": "5.95",
      Savings: "Any 2 For $10 | Free Gift with $30 spend",
      "in-stock": "No",
    });
  });

  it("reads only the SKU the listing links to", () => {
    const other = page();
    const fields = other.data.root.fields as Record<string, unknown>;
    fields.price_grocer = {
      "999": { data: { price: { priceNumber: 9.99 } } },
      "527102860": { data: { price: { priceNumber: 3.88 } } },
    };
    expect(redmart(other, url, "RedMart")["Product Price"]).toBe("3.88");
    fields.price_grocer = { "999": { data: { price: { priceNumber: 9.99 } } } };
    expect(() => redmart(other, url, "RedMart")).toThrow(/SKU 527102860/);
  });

  it("fails rather than inventing a price", () => {
    expect(() => redmart(page({}), url, "RedMart")).toThrow(/no price data/);
    expect(() => redmart(null, url, "RedMart")).toThrow(/no price data/);
  });

  it("reads the seller structurally, and leaves an unclear page for a hand check", () => {
    const withSeller = (extra: object, seller = { name: "RedMart" }) => ({
      data: { root: { fields: { price_grocer: {}, seller, ...extra } } },
    });
    const soldBy = { module: { subtitlePrefix: "Sold by:", subtitle: "Sea Boss" } };
    const reordered = { module: { subtitle: "Delyco", usp: [], subtitlePrefix: "Sold by:" } };
    expect(sellerFrom(withSeller({}))).toBe("RedMart");
    expect(sellerFrom(withSeller(soldBy))).toBe("Sea Boss");
    expect(sellerFrom(withSeller(reordered))).toBe("Delyco");
    expect(sellerFrom(withSeller({}, { name: "Other" }))).toBeNull();
    expect(sellerFrom({ data: { root: { fields: { seller: { name: "RedMart" } } } } })).toBeNull();
    expect(sellerFrom(null)).toBeNull();
    const two = { a: soldBy.module, b: { subtitlePrefix: "Sold by:", subtitle: "X" } };
    expect(sellerFrom(withSeller(two))).toBeNull();
  });

  it("recognises Lazada's slider check", () => {
    expect(isChallenge("https://www.lazada.sg//catalog//_____tmd_____/punish?x5secdata=a")).toBe(
      true,
    );
    expect(isChallenge("https://www.lazada.sg/products/pdp-i1-s1.html")).toBe(false);
  });
});

describe("name rules", () => {
  const product = { name: "Ayam Brand Sardines in Tomato Sauce 155g", specification: "155g" };

  it("searches without the pack size, which titles often omit", () => {
    expect(searchQuery("Ayam Brand Sardines in Tomato Sauce 155g")).toBe(
      "Ayam Brand Sardines in Tomato Sauce",
    );
    expect(searchQuery("[BCRS] Evian Natural Mineral Water 6 x 1.5L")).toBe(
      "Evian Natural Mineral Water",
    );
  });

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

describe("refresh options", () => {
  it("accepts a whole number of checks, including zero, and retailer names", () => {
    expect(parseOptions(["listings", "redmart", "--headed", "--max-checks", "0"])).toEqual({
      command: "listings",
      retailers: ["redmart"],
      headed: true,
      maxChecks: 0,
      hits: 3,
    });
    expect(parseOptions(["search"]).maxChecks).toBeUndefined();
    expect(parseOptions(["search", "redmart", "--hits", "1"]).hits).toBe(1);
    expect(parseOptions(["carry", "redmart"]).command).toBe("carry");
    expect(parseOptions(["search", "redmart", "--products", "a, b"]).products).toEqual(["a", "b"]);
  });

  it("rejects a malformed budget, an unknown retailer or arguments a command does not take", () => {
    for (const argv of [
      ["listings", "--max-checks", "x"],
      ["listings", "--max-checks", "-1"],
      ["listings", "--max-checks", "1.5"],
      ["listings", "--max-checks"],
      ["listings", "giant"],
      ["search", "--hits", "0"],
      ["carry"],
      ["listings", "--products", "a"],
      ["search", "--products", ","],
      ["carry", "fairprice"],
      ["carry", "redmart", "fairprice"],
      ["search", "--hits", "two"],
      ["sellers", "redmart"],
      ["publish"],
    ])
      expect(() => parseOptions(argv), argv.join(" ")).toThrow();
  });
});

describe("checkpoints", () => {
  it("survives a save stopped mid-write, and never revisits skipped sellers", () => {
    const dir = mkdtempSync(join(tmpdir(), "checkpoint-"));
    const path = join(dir, "listings-redmart.csv.checkpoint.json");
    saveCheckpoint(path, { done: ["a"], rows: [{ "product url": "a" }] });
    writeFileSync(`${path}.tmp`, '{"done": ["a", "b"], "ro');
    expect(loadCheckpoint(path)).toEqual({ done: ["a"], rows: [{ "product url": "a" }] });
    expect(loadCheckpoint(join(dir, "none.json"))).toEqual({ done: [], rows: [] });
    const row = { retailer: "redmart", seller: "" };
    expect(needsSeller({ ...row, status: "ok" })).toBe(true);
    expect(needsSeller({ ...row, status: "skipped" })).toBe(false);
    expect(needsSeller({ ...row, status: "not_found" })).toBe(false);
    expect(needsSeller(row)).toBe(true);
    expect(needsSeller({ ...row, status: "" })).toBe(true);
  });
});

/** Builds a seed with FairPrice and Cold Storage already listed, from the given RedMart candidate files. */
const BUILD = `
import json, sys
from pathlib import Path
sys.path.insert(0, "scripts")
import refresh_seed as r
r.SNAPSHOT = Path(sys.argv[1])
full, targeted = r.read(sys.argv[2]), r.read(sys.argv[3], required=False)
def listing(retailer, url):
    return {"listingId": retailer + "-rice", "productId": "rice-1kg", "retailerId": retailer,
            "productUrl": url, "name": "Rice 1kg", "specification": "1kg"}
def page(retailer, url):
    return {"status": "ok", "retailer": retailer, "product url": url, "Product Name": "Rice 1kg",
            "Product Price": "3.00", "Original Price": "", "Specification": "1kg", "Savings": "",
            "in-stock": "Yes", "Image URL": "", "seller": ""}
fp, cs = "https://www.fairprice.com.sg/product/rice", "https://coldstorage.com.sg/product/rice"
product = {"productId": "rice-1kg", "categoryId": "rice-and-noodles", "representativeName": "Rice 1kg", "imageUrl": None}
seed = {"products": [product], "listings": [listing("fairprice", fp), listing("cold-storage", cs)]}
match = {("rice-1kg", full[0]["product url"]): {"decision": "MATCH", "confidence": "HIGH",
                                                "name": "Rice 1kg", "specification": "1kg"}}
result = r.build(seed, {"products": [], "listings": []}, {fp: page("fairprice", fp), cs: page("cold-storage", cs)},
                 r.latest_candidates(full, targeted), match, {}, {})
print(json.dumps(sorted(l["retailerId"] for l in result["listings"])))
`;

describe("snapshot refresh, collector to seed", () => {
  it("lets a targeted search's gone page stop an earlier reading of it from publishing", () => {
    const dir = mkdtempSync(join(tmpdir(), "snapshot-"));
    const url = "https://www.lazada.sg/products/pdp-i5-s5.html";
    const target = {
      productId: "rice-1kg",
      name: "Rice 1kg",
      specification: "1kg",
      similarity: "1.000",
    };
    const page: Observation = {
      retailer: "redmart",
      "product url": url,
      "Product Name": "Rice 1kg",
      "Product Price": "3.00",
      "Original Price": "",
      Specification: "1kg",
      Savings: "",
      "in-stock": "Yes",
      "Image URL": "",
      brand: "",
      seller: "RedMart",
    };
    const write = (file: string, result: Observation | "not_found") =>
      writeFileSync(
        join(dir, file),
        toCsv(CANDIDATE_COLUMNS, [candidateRow(target, "redmart", url, result)]),
      );
    write("candidates-redmart.csv", page);
    const published = () =>
      JSON.parse(
        execFileSync(
          "python3",
          ["-c", BUILD, dir, "candidates-redmart.csv", "candidates-redmart-targeted.csv"],
          { cwd: join(import.meta.dirname, "../.."), encoding: "utf8" },
        ),
      );

    expect(published()).toEqual(["cold-storage", "fairprice", "redmart"]);
    write("candidates-redmart-targeted.csv", "not_found");
    expect(published()).toEqual(["cold-storage", "fairprice"]);
  });
});
