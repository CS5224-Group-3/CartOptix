/**
 * FairPrice pages carry the product as Next.js data (`__NEXT_DATA__`). The
 * price paid is `mrp` less any `discount`; a discount makes it a sale with
 * `mrp` as the original price. Offers for two or more packs are multibuys,
 * kept in the retailer's wording for curation to interpret.
 */
import { fetchText } from "./http.ts";
import {
  clean,
  dollars,
  type Observation,
  type ProductResult,
  type RetailerScraper,
  type SearchHit,
} from "./observation.ts";

const ORIGIN = "https://www.fairprice.com.sg";

interface FairPriceProduct {
  name: string;
  slug: string;
  status?: string;
  images?: string[];
  brand?: { name?: string } | null;
  metaData?: Record<string, unknown> | null;
  offers?: { shortDescriptionA?: string; description?: string }[] | null;
  storeSpecificData?: { mrp: string; discount?: string; stock?: number; status?: string }[];
}

function nextData(html: string): unknown {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match?.[1]) throw new Error("FairPrice page has no __NEXT_DATA__");
  return JSON.parse(match[1]);
}

/** Every product object in the page data, wherever the layout puts it. */
function products(data: unknown): FairPriceProduct[] {
  const found: FairPriceProduct[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      if ("slug" in value && "storeSpecificData" in value) found.push(value as FairPriceProduct);
      else Object.values(value).forEach(walk);
    }
  };
  walk(data);
  return found;
}

const productUrl = (slug: string) => `${ORIGIN}/product/${slug}`;
const displayUnit = (product: FairPriceProduct) =>
  clean(String(product.metaData?.DisplayUnit ?? ""));

/** A multibuy is an offer for two or more packs, e.g. "*Any 2* At $4.95". */
function multibuy(product: FairPriceProduct): string {
  for (const offer of product.offers ?? []) {
    const text = clean(offer.shortDescriptionA ?? offer.description);
    const packs = text.match(/^(?:any|buy)\s+(\d+)/i)?.[1];
    if (packs && Number(packs) >= 2) return text;
  }
  return "";
}

/** `url` is kept as given, because listing IDs come from it. */
export function observe(product: FairPriceProduct, url = productUrl(product.slug)): Observation {
  const store = product.storeSpecificData?.[0];
  if (!store) throw new Error(`FairPrice product ${product.slug} has no store data`);
  const mrp = Number(store.mrp);
  const discount = Number(store.discount ?? 0);
  const sale = discount > 0;
  return {
    retailer: "fairprice",
    "product url": url,
    "Product Name": clean(product.name),
    "Product Price": dollars(mrp - discount),
    "Original Price": sale ? dollars(mrp) : "",
    Specification: displayUnit(product),
    Savings: multibuy(product) || (sale ? `Save $${dollars(discount)}` : ""),
    "in-stock":
      product.status === "ENABLED" && store.status === "ENABLED" && (store.stock ?? 0) > 0
        ? "Yes"
        : "No",
    "Image URL": product.images?.[0] ?? "",
    brand: clean(product.brand?.name),
    seller: "FairPrice",
  };
}

export const fairprice: RetailerScraper = {
  async product(url): Promise<ProductResult> {
    const html = await fetchText(url);
    if (html === null) return "not_found";
    // Some listings link by item number alone, e.g. /product/11980278.
    const segment = new URL(url).pathname.split("/").pop() ?? "";
    const product = products(nextData(html)).find(
      (candidate) => candidate.slug === segment || candidate.slug.endsWith(`-${segment}`),
    );
    return product ? observe(product, url) : "not_found";
  },
  async search(query): Promise<SearchHit[]> {
    const html = await fetchText(`${ORIGIN}/search?query=${encodeURIComponent(query)}`);
    if (html === null) return [];
    return products(nextData(html)).map((product) => ({
      url: productUrl(product.slug),
      name: clean(product.name),
      specification: displayUnit(product),
    }));
  },
};
