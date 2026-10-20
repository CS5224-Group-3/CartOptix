/**
 * Cold Storage pages stream their data as React Server Component chunks. Each
 * product is a JSON object with `price`, a `promoPrice` below it during a sale,
 * an `inventoryStatus` and a `discountLabel` such as "Any 2 @ $6.55".
 */
import { fetchText, objectAt } from "./http.ts";
import {
  clean,
  dollars,
  type Observation,
  type ProductResult,
  type RetailerScraper,
  type SearchHit,
} from "./observation.ts";

const ORIGIN = "https://coldstorage.com.sg";

interface ColdStorageProduct {
  name: string;
  slug: string;
  price: number;
  promoPrice: number | null;
  image?: string;
  inventoryStatus?: string;
  discountLabel?: string | null;
  size?: string | null;
}

/** The RSC payload: every `self.__next_f.push([1, "…"])` string, decoded and joined. */
function payload(html: string): string {
  const chunks = html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g);
  return [...chunks].map((match) => JSON.parse(match[1] ?? '""') as string).join("");
}

/** Every product object in the payload, including related products. */
function products(html: string): ColdStorageProduct[] {
  const text = payload(html);
  const found = new Map<string, ColdStorageProduct>();
  for (const match of text.matchAll(/\{"productId":/g)) {
    const product = JSON.parse(objectAt(text, match.index)) as ColdStorageProduct;
    if (product.slug && !found.has(product.slug)) found.set(product.slug, product);
  }
  return [...found.values()];
}

const productUrl = (slug: string) => `${ORIGIN}/product/${slug}`;

export function observe(product: ColdStorageProduct, url = productUrl(product.slug)): Observation {
  const sale = product.promoPrice !== null && product.promoPrice < product.price;
  const label = clean(product.discountLabel);
  // A deal for several packs keeps its wording; a single-pack sale label such as
  // "7% off" becomes the plain saving the sale price already contains.
  const multibuy = /^(?:any|buy)\s+([2-9]|\d{2,})\b/i.test(label) ? label : "";
  return {
    retailer: "cold-storage",
    "product url": url,
    "Product Name": clean(product.name),
    "Product Price": dollars(sale ? (product.promoPrice ?? product.price) : product.price),
    "Original Price": sale ? dollars(product.price) : "",
    Specification: clean(product.size),
    Savings:
      multibuy || (sale ? `Save $${dollars(product.price - (product.promoPrice ?? 0))}` : ""),
    "in-stock": product.inventoryStatus === "In Stock" ? "Yes" : "No",
    "Image URL": product.image ?? "",
    brand: "",
    seller: "Cold Storage",
  };
}

export const coldStorage: RetailerScraper = {
  async product(url): Promise<ProductResult> {
    const html = await fetchText(url);
    if (html === null) return "not_found";
    const slug = new URL(url).pathname.split("/").pop();
    const product = products(html).find((candidate) => candidate.slug === slug);
    return product ? observe(product, url) : "not_found";
  },
  async search(query): Promise<SearchHit[]> {
    const html = await fetchText(`${ORIGIN}/search?q=${encodeURIComponent(query)}`);
    if (html === null) return [];
    return products(html).map((product) => ({
      url: productUrl(product.slug),
      name: clean(product.name),
      specification: clean(product.size),
    }));
  },
};
