export const RETAILERS = ["RedMart", "FairPrice", "Cold Storage"] as const;
export type Retailer = (typeof RETAILERS)[number];

export const CATEGORIES = [
  "Rice & Noodles",
  "Drinks",
  "Dairy",
  "Breakfast Foods",
  "Canned & Packaged Food",
  "Snacks",
  "Household Cleaning",
  "Toiletries & Personal Care",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type Promotion = {
  kind: "multibuy";
  minQuantity: number;
  promoPriceCents: number;
  label: string;
};

export type Product = {
  id: string;
  name: string;
  brand: string;
  variant: string;
  packSize: string;
  packCount: string;
  category: Category;
  emoji: string;
  accent: string;
  image: string;
  basePriceCents: number;
  availableAt?: Retailer[];
  unavailableReason?: string;
  demoNote?: string;
};

export type Offer = {
  productId: string;
  retailer: Retailer;
  unitPriceCents: number;
  stockState: "in_stock" | "unavailable";
  productUrl: string;
  promotion?: Promotion;
  promotionExcluded?: string;
};

export type BasketLine = { productId: string; quantity: number };

export type RetailerOrder = {
  retailer: Retailer;
  lines: Array<BasketLine & { product: Product; offer: Offer; lineTotalCents: number }>;
  subtotalCents: number;
  deliveryCents: number;
  mandatoryCents: number;
  totalCents: number;
  deliveryNote: string;
  mandatoryNote: string;
};

export type ComparisonStatus = "complete" | "no_valid_plan" | "failed";

export type ComparisonResult = {
  status: ComparisonStatus;
  calculationStatus: string;
  datasetVersion: string;
  retailerLimit: 1 | 2 | 3;
  baseline: RetailerOrder | null;
  bestSplit: {
    orders: RetailerOrder[];
    totalCents: number;
    retailerCount: number;
    searchLimitReached: boolean;
  } | null;
  recommended: "baseline" | "split" | "none";
  savingsCents: number | null;
  savingsLabel: string;
  explanation: string;
  excludedPromotions: string[];
  invalidReason?: string;
};

const img = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=720&q=80`;

export const PRODUCTS: Product[] = [
  { id: "r1", name: "Jasmine Fragrant Rice", brand: "Golden Harvest", variant: "Thai Hom Mali", packSize: "5 kg", packCount: "1 pack", category: "Rice & Noodles", emoji: "🍚", accent: "#f6d58a", image: img("photo-1586201375761-83865001e31c"), basePriceCents: 899 },
  { id: "r2", name: "Egg Noodles", brand: "Noodle House", variant: "Thin & springy", packSize: "400 g", packCount: "1 pack", category: "Rice & Noodles", emoji: "🍜", accent: "#f8bd7a", image: img("photo-1569718212165-3a8278d5f624"), basePriceCents: 349 },
  { id: "d1", name: "Mineral Water", brand: "H2Go", variant: "Still natural", packSize: "1.5 L", packCount: "6 bottles", category: "Drinks", emoji: "💧", accent: "#b8e3ef", image: img("photo-1548839140-29a749e1cf4d"), basePriceCents: 529 },
  { id: "d2", name: "Kopi-O Sachets", brand: "KopiKita", variant: "Less sugar", packSize: "18 g", packCount: "20 sachets", category: "Drinks", emoji: "☕", accent: "#d9b28b", image: img("photo-1514432324607-a09d9b4aefdd"), basePriceCents: 645 },
  { id: "da1", name: "Full Cream Milk", brand: "MeadowFresh", variant: "Fresh pasteurised", packSize: "1 L", packCount: "1 bottle", category: "Dairy", emoji: "🥛", accent: "#f3ead0", image: img("photo-1550583724-b2692b85b150"), basePriceCents: 399 },
  { id: "da2", name: "Greek Yogurt", brand: "GreenPastures", variant: "Plain, high protein", packSize: "500 g", packCount: "1 tub", category: "Dairy", emoji: "🥣", accent: "#d9f0e4", image: img("photo-1488477181946-6428a0291777"), basePriceCents: 699 },
  { id: "b1", name: "Corn Flakes", brand: "Sunrise", variant: "Original", packSize: "500 g", packCount: "1 box", category: "Breakfast Foods", emoji: "🥣", accent: "#f8db72", image: img("photo-1517093157656-b9eccef91cb1"), basePriceCents: 599 },
  { id: "b2", name: "Rolled Oats", brand: "Orchard", variant: "Wholegrain", packSize: "1 kg", packCount: "1 bag", category: "Breakfast Foods", emoji: "🌾", accent: "#e8cf9c", image: img("photo-1517673400267-0251440c45dc"), basePriceCents: 739 },
  { id: "c1", name: "Baked Beans", brand: "PantryPro", variant: "In tomato sauce", packSize: "420 g", packCount: "1 can", category: "Canned & Packaged Food", emoji: "🥫", accent: "#f3a49b", image: img("photo-1612392062631-94dd858cba88"), basePriceCents: 289 },
  { id: "c2", name: "Tuna Chunks", brand: "Island Harvest", variant: "In spring water", packSize: "185 g", packCount: "1 can", category: "Canned & Packaged Food", emoji: "🐟", accent: "#a7d5dc", image: img("photo-1544943910-4c1dc44aab44"), basePriceCents: 425 },
  { id: "c3", name: "Tomato Pasta Sauce", brand: "Saucy", variant: "Basil & garlic", packSize: "500 g", packCount: "1 jar", category: "Canned & Packaged Food", emoji: "🍅", accent: "#f3a391", image: img("photo-1472476442910-44a20e994a7c"), basePriceCents: 489 },
  { id: "s1", name: "Potato Crisps", brand: "CrunchTime", variant: "Sea salt", packSize: "150 g", packCount: "1 bag", category: "Snacks", emoji: "🥔", accent: "#f5c77b", image: img("photo-1621939514649-280e2aa85f2d"), basePriceCents: 399 },
  { id: "s2", name: "Mixed Nuts", brand: "NuttyTrail", variant: "Roasted & lightly salted", packSize: "250 g", packCount: "1 pouch", category: "Snacks", emoji: "🥜", accent: "#d9b28b", image: img("photo-1599599810769-bcde5a160d32"), basePriceCents: 899, availableAt: ["FairPrice", "Cold Storage"], demoNote: "Unavailable at RedMart in this prototype dataset." },
  { id: "s3", name: "Chocolate Biscuits", brand: "ChocoPop", variant: "Cocoa cream", packSize: "300 g", packCount: "1 pack", category: "Snacks", emoji: "🍪", accent: "#c9a78b", image: img("photo-1558961363-fa8fdf82db70"), basePriceCents: 489 },
  { id: "h1", name: "Dishwashing Liquid", brand: "Sparkle", variant: "Lemon fresh", packSize: "750 ml", packCount: "1 bottle", category: "Household Cleaning", emoji: "🧽", accent: "#b8e6c8", image: img("photo-1585832770485-e68a5dbfad52"), basePriceCents: 529 },
  { id: "h2", name: "Laundry Detergent", brand: "FreshFold", variant: "Indoor dry", packSize: "2 kg", packCount: "1 bag", category: "Household Cleaning", emoji: "🫧", accent: "#c9d8f3", image: img("photo-1604335399105-a0c585fd81a1"), basePriceCents: 1099, demoNote: "A member-only discount is excluded from the comparison." },
  { id: "h3", name: "Drawstring Trash Bags", brand: "HomeBright", variant: "Extra strong", packSize: "30 bags", packCount: "1 roll", category: "Household Cleaning", emoji: "🗑️", accent: "#d6d9df", image: img("photo-1611284446314-60a58ac0deb9"), basePriceCents: 699, availableAt: ["RedMart", "FairPrice"], demoNote: "Unavailable at Cold Storage in this prototype dataset." },
  { id: "t1", name: "Bathroom Tissue", brand: "PureCare", variant: "Soft 3-ply", packSize: "10 rolls", packCount: "1 pack", category: "Toiletries & Personal Care", emoji: "🧻", accent: "#e4e9f1", image: img("photo-1584556812952-905ffd0c611a"), basePriceCents: 899 },
  { id: "t2", name: "Mint Toothpaste", brand: "DailyGlow", variant: "Fresh mint", packSize: "120 g", packCount: "1 tube", category: "Toiletries & Personal Care", emoji: "🪥", accent: "#c9eee7", image: img("photo-1620916566398-39f1143ab7be"), basePriceCents: 459 },
  { id: "t3", name: "Daily Shampoo", brand: "SoftNest", variant: "Botanical smooth", packSize: "650 ml", packCount: "1 bottle", category: "Toiletries & Personal Care", emoji: "🧴", accent: "#ead5f4", image: img("photo-1556228578-8c89e6adf883"), basePriceCents: 999, availableAt: ["RedMart", "Cold Storage"], demoNote: "Unavailable at FairPrice in this prototype dataset." },
  { id: "ex1", name: "Small-batch Kaya", brand: "Island Pantry", variant: "Pandan coconut", packSize: "250 g", packCount: "1 jar", category: "Canned & Packaged Food", emoji: "🍯", accent: "#f2c77e", image: img("photo-1547592180-85f173990554"), basePriceCents: 999, availableAt: ["RedMart"], demoNote: "Demo constraint: RedMart-only." },
  { id: "ex2", name: "Sourdough Crackers", brand: "Harbour Bakehouse", variant: "Sea salt", packSize: "180 g", packCount: "1 box", category: "Snacks", emoji: "🥨", accent: "#e6bc87", image: img("photo-1509440159596-0249088772ff"), basePriceCents: 749, availableAt: ["FairPrice"], demoNote: "Demo constraint: FairPrice-only." },
  { id: "dead1", name: "Limited-edition Pantry Box", brand: "CartOptix Demo", variant: "Prototype listing", packSize: "1 box", packCount: "1 pack", category: "Canned & Packaged Food", emoji: "📦", accent: "#d8dde5", image: img("photo-1601563491222-3e86cfe7e7b4"), basePriceCents: 1299, availableAt: [], unavailableReason: "No direct supermarket offer is available in the fixed dataset.", demoNote: "Use this item to demonstrate the no-valid-plan state." },
];

const PRODUCT_BY_ID = new Map(PRODUCTS.map((product) => [product.id, product]));
const RETAILER_DOMAIN: Record<Retailer, string> = {
  RedMart: "https://www.lazada.sg/products/",
  FairPrice: "https://www.fairprice.com.sg/product/",
  "Cold Storage": "https://coldstorage.dexecure.net/product/",
};
const RETAILER_SLUG: Record<Retailer, string> = { RedMart: "redmart-demo", FairPrice: "fairprice-demo", "Cold Storage": "cold-storage-demo" };

export const RETAILER_RULES: Record<Retailer, { minimumCents: number; freeDeliveryCents: number; deliveryCents: number; mandatoryCents: number; deliveryLabel: string; mandatoryLabel: string }> = {
  RedMart: { minimumCents: 2000, freeDeliveryCents: 8000, deliveryCents: 599, mandatoryCents: 0, deliveryLabel: "S$5.99 standard delivery below S$80", mandatoryLabel: "No mandatory charge in this scenario" },
  FairPrice: { minimumCents: 1500, freeDeliveryCents: 6000, deliveryCents: 499, mandatoryCents: 199, deliveryLabel: "S$4.99 standard delivery below S$60", mandatoryLabel: "S$1.99 service charge" },
  "Cold Storage": { minimumCents: 3000, freeDeliveryCents: 10000, deliveryCents: 799, mandatoryCents: 0, deliveryLabel: "S$7.99 standard delivery below S$100", mandatoryLabel: "No mandatory charge in this scenario" },
};

const priceAdjustment: Record<Retailer, number> = { RedMart: 0, FairPrice: -18, "Cold Storage": 72 };

export function getProduct(productId: string) {
  return PRODUCT_BY_ID.get(productId);
}

export function getOffers(productId: string): Offer[] {
  const product = PRODUCT_BY_ID.get(productId);
  if (!product) return [];
  return RETAILERS.map((retailer) => {
    const available = product.availableAt ? product.availableAt.includes(retailer) : true;
    const scenarioPriceOverrides: Record<string, Partial<Record<Retailer, number>>> = {
      r1: { RedMart: 520 },
      h2: { RedMart: 650 },
      s3: { RedMart: 450 },
      da1: { FairPrice: 290 },
      b1: { FairPrice: 329 },
      t1: { FairPrice: 500 },
    };
    const offer: Offer = {
      productId,
      retailer,
      unitPriceCents: Math.max(99, scenarioPriceOverrides[productId]?.[retailer] ?? product.basePriceCents + priceAdjustment[retailer]),
      stockState: available ? "in_stock" : "unavailable",
      productUrl: `${RETAILER_DOMAIN[retailer]}${RETAILER_SLUG[retailer]}-${product.id}`,
    };
    if (product.id === "da1" && retailer === "FairPrice") offer.promotion = { kind: "multibuy", minQuantity: 2, promoPriceCents: 760, label: "Verified same-product multibuy: 2 bottles for S$7.60" };
    if (product.id === "b1" && retailer === "RedMart") offer.promotion = { kind: "multibuy", minQuantity: 2, promoPriceCents: 1080, label: "Verified same-product multibuy: 2 boxes for S$10.80" };
    if (product.id === "c1" && retailer === "Cold Storage") offer.promotionExcluded = "Shelf promotion shown in source notes, but terms could not be verified; excluded.";
    if (product.id === "h2" && retailer === "FairPrice") offer.promotionExcluded = "Member-only discount excluded; non-member pricing is used.";
    return offer;
  });
}

export function getOffersForQuantity(productId: string, quantity: number) {
  return getOffers(productId).map((offer) => ({ ...offer, requestedQuantity: quantity, productCostCents: calculateProductCost(offer, quantity) }));
}

export function calculateProductCost(offer: Offer, quantity: number) {
  if (offer.stockState === "unavailable") return null;
  if (!offer.promotion || quantity < offer.promotion.minQuantity) return offer.unitPriceCents * quantity;
  const bundles = Math.floor(quantity / offer.promotion.minQuantity);
  const remainder = quantity % offer.promotion.minQuantity;
  return bundles * offer.promotion.promoPriceCents + remainder * offer.unitPriceCents;
}

function combinations<T>(values: T[], size: number): T[][] {
  if (size === 1) return values.map((value) => [value]);
  const result: T[][] = [];
  values.forEach((value, index) => {
    combinations(values.slice(index + 1), size - 1).forEach((tail) => result.push([value, ...tail]));
  });
  return result;
}

function orderForAssignments(lines: BasketLine[], assignment: Record<string, Retailer>, excludedPromotions: Set<string>): RetailerOrder[] | null {
  const grouped = new Map<Retailer, RetailerOrder["lines"]>();
  for (const line of lines) {
    const product = PRODUCT_BY_ID.get(line.productId);
    const retailer = assignment[line.productId];
    if (!product || !retailer) return null;
    const offer = getOffers(line.productId).find((candidate) => candidate.retailer === retailer);
    if (!offer || offer.stockState === "unavailable") return null;
    const lineTotalCents = calculateProductCost(offer, line.quantity);
    if (lineTotalCents === null) return null;
    if (offer.promotionExcluded) excludedPromotions.add(`${retailer}: ${product.name} — ${offer.promotionExcluded}`);
    const existing = grouped.get(retailer) ?? [];
    existing.push({ ...line, product, offer, lineTotalCents });
    grouped.set(retailer, existing);
  }
  const orders: RetailerOrder[] = [];
  const groupEntries = Array.from(grouped.entries());
  for (let index = 0; index < groupEntries.length; index += 1) {
    const retailer = groupEntries[index][0];
    const orderLines = groupEntries[index][1];
    const rules = RETAILER_RULES[retailer];
    const subtotalCents = orderLines.reduce((sum: number, line: RetailerOrder["lines"][number]) => sum + line.lineTotalCents, 0);
    if (subtotalCents < rules.minimumCents) return null;
    const deliveryCents = subtotalCents >= rules.freeDeliveryCents ? 0 : rules.deliveryCents;
    orders.push({
      retailer,
      lines: orderLines,
      subtotalCents,
      deliveryCents,
      mandatoryCents: rules.mandatoryCents,
      totalCents: subtotalCents + deliveryCents + rules.mandatoryCents,
      deliveryNote: deliveryCents === 0 ? `Free standard delivery at S$${(rules.freeDeliveryCents / 100).toFixed(0)} threshold` : rules.deliveryLabel,
      mandatoryNote: rules.mandatoryLabel,
    });
  }
  return orders.sort((a, b) => RETAILERS.indexOf(a.retailer) - RETAILERS.indexOf(b.retailer));
}

function chooseAssignment(lines: BasketLine[], subset: Retailer[]): Record<string, Retailer> | null {
  const assignment: Record<string, Retailer> = {};
  for (const line of lines) {
    const offers = getOffers(line.productId).filter((offer) => subset.includes(offer.retailer) && offer.stockState === "in_stock");
    if (!offers.length) return null;
    offers.sort((a, b) => (calculateProductCost(a, line.quantity) ?? Infinity) - (calculateProductCost(b, line.quantity) ?? Infinity));
    assignment[line.productId] = offers[0].retailer;
  }
  return assignment;
}

function findBestSplitAssignment(lines: BasketLine[], subset: Retailer[], candidateLimit = 5000): { orders: RetailerOrder[]; totalCents: number } | null {
  let candidatesChecked = 0;
  let best: { orders: RetailerOrder[]; totalCents: number } | null = null;
  const assignment: Record<string, Retailer> = {};
  const visit = (index: number) => {
    if (candidatesChecked >= candidateLimit) return;
    if (index === lines.length) {
      candidatesChecked += 1;
      const excluded = new Set<string>();
      const orders = orderForAssignments(lines, assignment, excluded);
      if (!orders || orders.length < 2 || orders.length > subset.length) return;
      const totalCents = orders.reduce((sum, order) => sum + order.totalCents, 0);
      if (!best || totalCents < best.totalCents) best = { orders, totalCents };
      return;
    }
    const line = lines[index];
    const availableRetailers = subset.filter((retailer) => getOffers(line.productId).some((offer) => offer.retailer === retailer && offer.stockState === "in_stock"));
    availableRetailers.sort((a, b) => {
      const offerA = getOffers(line.productId).find((offer) => offer.retailer === a);
      const offerB = getOffers(line.productId).find((offer) => offer.retailer === b);
      return (offerA ? calculateProductCost(offerA, line.quantity) ?? Infinity : Infinity) - (offerB ? calculateProductCost(offerB, line.quantity) ?? Infinity : Infinity);
    });
    availableRetailers.forEach((retailer) => {
      if (candidatesChecked >= candidateLimit) return;
      assignment[line.productId] = retailer;
      visit(index + 1);
    });
  };
  visit(0);
  return best;
}

function rebalanceForMinimum(lines: BasketLine[], subset: Retailer[], initial: Record<string, Retailer>): Record<string, Retailer> | null {
  const candidates = [initial];
  const movable = lines.flatMap((line) => subset.filter((retailer) => retailer !== initial[line.productId]).map((retailer) => ({ productId: line.productId, retailer })));
  movable.forEach(({ productId, retailer }) => candidates.push({ ...initial, [productId]: retailer }));
  for (const assignment of candidates) {
    const excluded = new Set<string>();
    if (orderForAssignments(lines, assignment, excluded)) return assignment;
  }
  return null;
}

export function compareBasket(lines: BasketLine[], retailerLimit: 1 | 2 | 3): ComparisonResult {
  const validLines: BasketLine[] = lines.filter((line: BasketLine) => PRODUCT_BY_ID.has(line.productId) && Number.isInteger(line.quantity) && line.quantity >= 1 && line.quantity <= 20);
  if (!validLines.length || validLines.length > 50) return { status: "failed", calculationStatus: "Calculation failed — invalid basket input.", datasetVersion: "prototype-2026-09", retailerLimit, baseline: null, bestSplit: null, recommended: "none", savingsCents: null, savingsLabel: "Unavailable", explanation: "Please use whole-pack quantities from 1 to 20 and no more than 50 distinct lines.", excludedPromotions: [] };

  const baselineCandidates: RetailerOrder[] = [];
  const excludedPromotions = new Set<string>();
  for (const retailer of RETAILERS) {
    const assignment = Object.fromEntries(validLines.map((line) => [line.productId, retailer])) as Record<string, Retailer>;
    const order = orderForAssignments(validLines, assignment, new Set<string>())?.[0];
    if (order) baselineCandidates.push(order);
  }
  baselineCandidates.sort((a, b) => a.totalCents - b.totalCents);
  const baseline = baselineCandidates[0] ?? null;
  baseline?.lines.forEach((line) => { if (line.offer.promotionExcluded) excludedPromotions.add(`${baseline.retailer}: ${line.product.name} — ${line.offer.promotionExcluded}`); });
  let bestSplit: ComparisonResult["bestSplit"] = null;

  for (let size = 2; size <= retailerLimit; size += 1) {
    for (const subset of combinations([...RETAILERS], size)) {
      const candidate = findBestSplitAssignment(validLines, subset);
      if (!candidate) continue;
      candidate.orders.forEach((order) => order.lines.forEach((line) => { if (line.offer.promotionExcluded) excludedPromotions.add(`${order.retailer}: ${line.product.name} — ${line.offer.promotionExcluded}`); }));
      if (!bestSplit || candidate.totalCents < bestSplit.totalCents) bestSplit = { orders: candidate.orders, totalCents: candidate.totalCents, retailerCount: candidate.orders.length, searchLimitReached: true };
    }
  }

  if (!baseline && !bestSplit) {
    return { status: "no_valid_plan", calculationStatus: "No valid plan found.", datasetVersion: "prototype-2026-09", retailerLimit, baseline: null, bestSplit: null, recommended: "none", savingsCents: null, savingsLabel: "Unavailable", explanation: "No complete retailer assignment met stock availability and minimum-order constraints within the permitted retailer limit. This is not labelled impossible because the search is deliberately limited.", excludedPromotions: Array.from(excludedPromotions) };
  }
  if (!baseline && bestSplit) {
    return { status: "complete", calculationStatus: "Best plan found — the search limit was reached, so optimality is not guaranteed.", datasetVersion: "prototype-2026-09", retailerLimit, baseline: null, bestSplit, recommended: "split", savingsCents: null, savingsLabel: "Unavailable", explanation: "A valid split plan was found, but no complete single-retailer baseline was available for comparison.", excludedPromotions: Array.from(excludedPromotions) };
  }
  const splitSaves = Boolean(bestSplit && baseline && bestSplit.totalCents < baseline.totalCents);
  const savingsCents = splitSaves && bestSplit && baseline ? baseline.totalCents - bestSplit.totalCents : 0;
  return { status: "complete", calculationStatus: "Complete estimate based on the fixed prototype dataset.", datasetVersion: "prototype-2026-09", retailerLimit, baseline, bestSplit, recommended: splitSaves ? "split" : "baseline", savingsCents, savingsLabel: savingsCents > 0 ? `Save S$${(savingsCents / 100).toFixed(2)}` : "No lower split total", explanation: splitSaves ? "Splitting the basket produced a lower estimated total under the current dataset and delivery assumptions." : "Splitting your basket did not produce a lower estimated total under the current dataset and delivery assumptions.", excludedPromotions: Array.from(excludedPromotions) };
}

export const DEMO_BASKET: BasketLine[] = PRODUCTS.filter((product) => !["dead1", "ex1", "ex2"].includes(product.id)).slice(0, 20).map((product, index) => ({ productId: product.id, quantity: index % 3 === 0 ? 2 : 1 }));

export const DEMO_SCENARIOS: Record<string, { label: string; description: string; lines: BasketLine[]; retailerLimit: 1 | 2 | 3 }> = {
  "split-saves": { label: "Split saves money", description: "A mixed pantry basket where FairPrice and RedMart each have strong prices.", lines: [{ productId: "r1", quantity: 1 }, { productId: "da1", quantity: 2 }, { productId: "b1", quantity: 1 }, { productId: "h2", quantity: 1 }, { productId: "s3", quantity: 2 }, { productId: "t1", quantity: 1 }], retailerLimit: 2 },
  "single-cheapest": { label: "One retailer wins", description: "A complete basket where delivery fees make a single order clearer.", lines: [{ productId: "r2", quantity: 2 }, { productId: "c1", quantity: 2 }, { productId: "s1", quantity: 2 }, { productId: "t2", quantity: 1 }], retailerLimit: 2 },
  "no-split-help": { label: "Splitting does not help", description: "A basket that stays cheaper as one complete order.", lines: [{ productId: "d1", quantity: 1 }, { productId: "d2", quantity: 1 }, { productId: "c2", quantity: 1 }, { productId: "h1", quantity: 1 }, { productId: "t3", quantity: 1 }], retailerLimit: 3 },
  "no-baseline": { label: "No single-retailer baseline", description: "Two retailer-exclusive products; only a split plan can complete the basket.", lines: [{ productId: "ex1", quantity: 1 }, { productId: "ex2", quantity: 1 }, { productId: "r1", quantity: 2 }, { productId: "r2", quantity: 3 }], retailerLimit: 2 },
  "no-valid": { label: "No valid plan found", description: "An unavailable prototype item with no direct offers.", lines: [{ productId: "dead1", quantity: 1 }, { productId: "r1", quantity: 1 }], retailerLimit: 3 },
  "unavailable": { label: "Unavailable product", description: "Shows an item with retailer-level stock gaps.", lines: [{ productId: "s2", quantity: 1 }, { productId: "h3", quantity: 1 }], retailerLimit: 3 },
  "excluded-promo": { label: "Excluded promotion", description: "Member or unverified promotions remain visible but do not affect totals.", lines: [{ productId: "c1", quantity: 2 }, { productId: "h2", quantity: 1 }], retailerLimit: 3 },
  "delivery-minimum": { label: "Delivery + minimums", description: "Order-size constraints shape whether a split is feasible.", lines: [{ productId: "r1", quantity: 2 }, { productId: "r2", quantity: 2 }], retailerLimit: 3 },
};

export function formatSgd(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "Unavailable";
  return `S$${(cents / 100).toFixed(2)}`;
}
