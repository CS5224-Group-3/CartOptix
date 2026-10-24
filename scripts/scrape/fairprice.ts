/**
 * FairPrice pages carry the product as Next.js data (`__NEXT_DATA__`). The
 * price paid is `mrp` less any `discount`; a discount makes it a sale with
 * `mrp` as the original price. Every other offer is kept in the retailer's
 * wording for curation to interpret: multibuys are applied, the rest shown as
 * excluded promotions.
 */
import { fetchText } from "./http.ts";
import {
  clean,
  dollars,
  type Observation,
  PROMOTION_SEPARATOR,
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

/**
 * Every offer in the retailer's wording, except a single-pack offer at the
 * price already paid: that is the sale itself, shown as its plain saving.
 */
function promotions(product: FairPriceProduct, price: string, discount: number): string[] {
  const offers = (product.offers ?? [])
    .map((offer) => clean(offer.shortDescriptionA ?? offer.description))
    .filter(Boolean)
    .filter((text) => !new RegExp(`^buy 1 at \\$?${price}$`, "i").test(text));
  return discount > 0 ? [`Save $${dollars(discount)}`, ...offers] : offers;
}

/** `url` is kept as given, because listing IDs come from it. */
export function observe(product: FairPriceProduct, url = productUrl(product.slug)): Observation {
  const store = product.storeSpecificData?.[0];
  if (!store) throw new Error(`FairPrice product ${product.slug} has no store data`);
  const mrp = Number(store.mrp);
  const discount = Number(store.discount ?? 0);
  const sale = discount > 0;
  const price = dollars(mrp - discount);
  return {
    retailer: "fairprice",
    "product url": url,
    "Product Name": clean(product.name),
    "Product Price": price,
    "Original Price": sale ? dollars(mrp) : "",
    Specification: displayUnit(product),
    Savings: promotions(product, price, discount).join(PROMOTION_SEPARATOR),
    "in-stock":
      product.status === "ENABLED" && store.status === "ENABLED" && (store.stock ?? 0) > 0
        ? "Yes"
        : "No",
    "Image URL": product.images?.[0] ?? "",
    brand: clean(product.brand?.name),
    seller: "FairPrice",
  };
}

/**
 * The product a page describes. FairPrice answers a removed product with a
 * product page whose detail layout is empty, or, for an old link it no longer
 * resolves, with a product page that has no product data. Those are the only
 * evidence of removal accepted; any other shape is a failure.
 */
export function pageProduct(data: unknown, url: string): FairPriceProduct | "not_found" {
  const page = data as {
    page?: string;
    props?: { pageProps?: { product?: { data?: { page?: { layouts?: unknown } } } } };
  };
  // A product page for a slug FairPrice no longer knows carries no product at all.
  const props = page.props?.pageProps;
  if (page.page === "/productDetails" && props && !("product" in props)) return "not_found";
  const layouts = props?.product?.data?.page?.layouts;
  const detail = Array.isArray(layouts)
    ? (layouts as { name?: string; value?: unknown }[]).find(
        (layout) => layout.name === "ProductDetail",
      )
    : undefined;
  if (!detail) throw new Error(`FairPrice page ${url} has no product detail layout`);
  if (detail.value === null) return "not_found";
  const [product] = products(detail.value);
  if (!product) throw new Error(`FairPrice page ${url} has an unexpected product detail`);
  return product;
}

/**
 * A search page's results: the products in its ProductCollection layout, which
 * a search with no results still has (empty). Any other page is a failure.
 */
export function searchResults(data: unknown, query: string): FairPriceProduct[] {
  const layouts = (
    data as { props?: { pageProps?: { data?: { data?: { page?: { layouts?: unknown } } } } } }
  ).props?.pageProps?.data?.data?.page?.layouts;
  const collection = Array.isArray(layouts)
    ? (layouts as { name?: string; value?: { collection?: { product?: unknown } } }[]).find(
        (layout) => layout.name === "ProductCollection",
      )?.value?.collection
    : undefined;
  if (!collection) throw new Error(`FairPrice search for ${query} returned an unexpected page`);
  return products(collection.product ?? []);
}

export const fairprice: RetailerScraper = {
  async product(url): Promise<ProductResult> {
    const html = await fetchText(url);
    if (html === null) return "not_found";
    const product = pageProduct(nextData(html), url);
    return product === "not_found" ? product : observe(product, url);
  },
  async search(query): Promise<SearchHit[]> {
    const html = await fetchText(`${ORIGIN}/search?query=${encodeURIComponent(query)}`);
    if (html === null) throw new Error(`FairPrice search for ${query} is missing`);
    return searchResults(nextData(html), query).map((product) => ({
      url: productUrl(product.slug),
      name: clean(product.name),
      specification: displayUnit(product),
    }));
  },
};
