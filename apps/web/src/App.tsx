// Defines the top-level web application shell, routing, and shared providers.

import {
  type BasketLine,
  CATEGORIES,
  type ComparisonResult,
  compareBasket,
  DEMO_SCENARIOS,
  formatSgd,
  getOffers,
  getProduct,
  type Offer,
  PRODUCTS,
  type Product,
  RETAILERS,
  type Retailer,
} from "@cartoptix/contracts/domain/cartoptix";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Leaf,
  Menu,
  ShoppingBasket,
  Sparkles,
  X,
} from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link, Route, Switch, useLocation, useRoute } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/ThemeContext";
import ErrorBoundary from "./components/ErrorBoundary";
import { trpc } from "./lib/trpc";
import Home from "./pages/Home";

const DATASET_VERSION = "prototype-2026-09" as const;

type BasketContextValue = {
  basket: BasketLine[];
  retailerLimit: 1 | 2 | 3;
  comparison: ComparisonResult | null;
  isStale: boolean;
  basketCount: number;
  addToBasket: (productId: string, quantity: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  removeFromBasket: (productId: string) => void;
  setRetailerLimit: (limit: 1 | 2 | 3) => void;
  setComparison: (result: ComparisonResult) => void;
  loadScenario: (lines: BasketLine[], retailerLimit: 1 | 2 | 3) => void;
};

const BasketContext = createContext<BasketContextValue | null>(null);

function BasketProvider({ children }: { children: ReactNode }) {
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [retailerLimit, setRetailerLimitState] = useState<1 | 2 | 3>(2);
  const [comparison, setComparisonState] = useState<ComparisonResult | null>(null);
  const [basketRevision, setBasketRevision] = useState(0);
  const [comparedRevision, setComparedRevision] = useState(-1);

  const changed = (next: BasketLine[]) => {
    setBasket(next);
    setBasketRevision((revision) => revision + 1);
  };

  const value = useMemo<BasketContextValue>(
    () => ({
      basket,
      retailerLimit,
      comparison,
      isStale: Boolean(comparison && comparedRevision !== basketRevision),
      basketCount: basket.reduce((total, line) => total + line.quantity, 0),
      addToBasket: (productId, quantity) => {
        const current = basket.find((line) => line.productId === productId);
        if (current) {
          changed(
            basket.map((line) =>
              line.productId === productId
                ? { ...line, quantity: Math.min(20, line.quantity + quantity) }
                : line,
            ),
          );
        } else if (basket.length < 50) {
          changed([...basket, { productId, quantity: Math.min(20, Math.max(1, quantity)) }]);
        } else {
          toast.error("Basket limit reached", {
            description: "CartOptix supports up to 50 distinct basket lines.",
          });
        }
      },
      setQuantity: (productId, quantity) => {
        const nextQuantity = Math.min(20, Math.max(1, Math.round(quantity)));
        changed(
          basket.map((line) =>
            line.productId === productId ? { ...line, quantity: nextQuantity } : line,
          ),
        );
      },
      removeFromBasket: (productId) =>
        changed(basket.filter((line) => line.productId !== productId)),
      setRetailerLimit: (limit) => {
        setRetailerLimitState(limit);
        setBasketRevision((revision) => revision + 1);
      },
      setComparison: (result) => {
        setComparisonState(result);
        setComparedRevision(basketRevision);
      },
      loadScenario: (lines, limit) => {
        setBasket(lines);
        setRetailerLimitState(limit);
        setComparisonState(null);
        setBasketRevision((revision) => revision + 1);
        setComparedRevision(-1);
      },
    }),
    [basket, retailerLimit, comparison, basketRevision, comparedRevision],
  );

  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>;
}

export function useBasket() {
  const context = useContext(BasketContext);
  if (!context) throw new Error("useBasket must be used within BasketProvider");
  return context;
}

function AppShell({ children }: { children: ReactNode }) {
  const { basketCount } = useBasket();
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const isLanding = location === "/";
  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-header__inner">
          <Link
            href="/"
            className="wordmark"
            aria-label="CartOptix home"
            onClick={() => setMenuOpen(false)}
          >
            <span className="wordmark__mark">
              <Leaf size={17} strokeWidth={2.8} />
            </span>
            <span>
              Cart<span>Optix</span>
            </span>
          </Link>
          <button
            className="mobile-menu-button"
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Menu size={21} />
          </button>
          <nav
            className={`site-nav ${menuOpen ? "site-nav--open" : ""}`}
            aria-label="Main navigation"
          >
            <Link
              href="/catalogue"
              className={location === "/catalogue" ? "is-active" : ""}
              onClick={() => setMenuOpen(false)}
            >
              Browse products
            </Link>
            <a
              href={isLanding ? "#how-it-works" : "/#how-it-works"}
              onClick={() => setMenuOpen(false)}
            >
              How it works
            </a>
            <Link
              href="/basket"
              className={`nav-basket ${location === "/basket" ? "is-active" : ""}`}
              onClick={() => setMenuOpen(false)}
            >
              <ShoppingBasket size={17} /> Basket <span>{basketCount}</span>
            </Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="site-footer">
        <div className="container footer-grid">
          <div>
            <div className="wordmark wordmark--footer">
              <span className="wordmark__mark">
                <Leaf size={15} />
              </span>
              <span>
                Cart<span>Optix</span>
              </span>
            </div>
            <p>Transparent basket comparison for Singapore grocery shoppers.</p>
          </div>
          <div>
            <p className="footer-label">Prototype boundaries</p>
            <p>Fixed demo dataset · estimates only · no checkout integration</p>
          </div>
          <div className="footer-trust">
            <Check size={16} /> Retailer payments never influence recommendations.
          </div>
        </div>
      </footer>
    </div>
  );
}

function PageIntro({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="page-intro">
      <div className="container">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-intro__description">{description}</p>
        {children}
      </div>
    </section>
  );
}

function ProductImage({ product, className = "" }: { product: Product; className?: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <div
      className={`product-image product-image--fallback ${className}`}
      style={{ background: product.accent }}
      aria-label={`${product.name} placeholder`}
    >
      <span>{product.emoji}</span>
    </div>
  ) : (
    <div className={`product-image ${className}`} style={{ background: product.accent }}>
      <img
        src={product.image}
        alt={`${product.brand} ${product.name}`}
        onError={() => setFailed(true)}
      />
      <span className="product-image__emoji" aria-hidden="true">
        {product.emoji}
      </span>
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  const { addToBasket } = useBasket();
  return (
    <article className="product-card">
      <Link
        href={`/product/${product.id}`}
        className="product-card__link"
        aria-label={`View ${product.name}`}
      >
        <ProductImage product={product} />
        <div className="product-card__body">
          <p className="product-card__category">{product.category}</p>
          <h3>{product.name}</h3>
          <p className="product-card__meta">
            {product.brand} · {product.packSize}
          </p>
          <div className="product-card__price">
            <span>From</span> {formatSgd(product.basePriceCents)}
          </div>
        </div>
      </Link>
      <div className="product-card__actions">
        <button
          className="button button--small button--outline"
          onClick={() => {
            addToBasket(product.id, 1);
            toast.success("Added to basket", { description: product.name });
          }}
        >
          <ShoppingBasket size={15} /> Add
        </button>
        <Link className="text-link text-link--small" href={`/product/${product.id}`}>
          Compare offers <ArrowRight size={13} />
        </Link>
      </div>
    </article>
  );
}

export function CataloguePage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const queryInput = useMemo(() => ({ search, category }), [search, category]);
  const { data: products = [], isLoading } = trpc.catalogue.useQuery(queryInput);
  return (
    <main>
      <PageIntro
        eyebrow="Prototype catalogue"
        title="Build a basket from exact products."
        description="Search the curated demo catalogue, inspect retailer offers, then add whole packs to your basket. Product identity and pack size stay fixed throughout the comparison."
      >
        <div className="data-pill">
          <Sparkles size={14} /> Prototype data · not live retailer pricing
        </div>
      </PageIntro>
      <section className="container catalogue-section">
        <div className="catalogue-toolbar">
          <label className="search-field">
            <span className="sr-only">Search products</span>
            <span>⌕</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by product, brand or variant"
            />
          </label>
          <label className="select-field">
            <span className="sr-only">Filter category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option>All</option>
              {CATEGORIES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <ChevronDown size={16} />
          </label>
        </div>
        <div className="catalogue-summary">
          <p>
            <strong>{products.length}</strong> products shown
          </p>
          <p>8 categories · Singapore serviceable scenario</p>
        </div>
        {isLoading ? (
          <div className="loading-state">Loading the curated catalogue…</div>
        ) : products.length ? (
          <div className="product-grid">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <CircleHelp size={24} />
            <h2>No matching products</h2>
            <p>Try a different product name or category.</p>
            <button
              className="button button--outline"
              onClick={() => {
                setSearch("");
                setCategory("All");
              }}
            >
              Reset filters
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

export function ProductDetail() {
  const [, params] = useRouteParams();
  const productId = params?.id ?? "";
  const [quantity, setQuantity] = useState(1);
  const { data, isLoading } = trpc.product.useQuery({ productId, quantity });
  const { addToBasket } = useBasket();
  const [location, navigate] = useLocation();
  const clickMutation = trpc.outboundClick.useMutation();
  if (isLoading)
    return (
      <main>
        <div className="loading-state container">Loading product offers…</div>
      </main>
    );
  if (!data)
    return (
      <main>
        <div className="container empty-state">
          <AlertCircle size={28} />
          <h1>Product not found</h1>
          <p>That product is not in the prototype dataset.</p>
          <Link className="button button--primary" href="/catalogue">
            Back to catalogue
          </Link>
        </div>
      </main>
    );
  const { product, offers } = data;
  const openRetailer = (offer: Offer) => {
    clickMutation.mutate(
      { retailer: offer.retailer, productId: offer.productId, destination: offer.productUrl },
      { onError: () => undefined },
    );
    window.open(offer.productUrl, "_blank", "noopener,noreferrer");
  };
  return (
    <main>
      <div className="container breadcrumb-row">
        <Link href="/catalogue" className="text-link">
          ← Back to catalogue
        </Link>
        <span>/</span>
        <span>{product.category}</span>
      </div>
      <section className="container product-detail">
        <div className="product-detail__visual">
          <ProductImage product={product} className="product-image--detail" />
          <div className="prototype-note">
            <Sparkles size={15} /> Exact product identity · demo data
          </div>
        </div>
        <div className="product-detail__content">
          <p className="eyebrow">{product.category}</p>
          <h1>{product.name}</h1>
          <p className="product-detail__variant">
            {product.brand} · {product.variant}
          </p>
          <div className="identity-grid">
            <div>
              <span>Pack size</span>
              <strong>{product.packSize}</strong>
            </div>
            <div>
              <span>Pack count</span>
              <strong>{product.packCount}</strong>
            </div>
            <div>
              <span>Quantity rule</span>
              <strong>Whole packs only</strong>
            </div>
          </div>
          <p className="product-detail__copy">
            Compare the estimated product cost for your requested quantity. Promotions are applied
            only when the same-product terms are explicit and supported in the prototype dataset.
          </p>
          <div className="quantity-control">
            <span>Quantity</span>
            <button
              aria-label="Decrease quantity"
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
            >
              −
            </button>
            <strong>{quantity}</strong>
            <button
              aria-label="Increase quantity"
              onClick={() => setQuantity(Math.min(20, quantity + 1))}
            >
              +
            </button>
            <em>packs</em>
          </div>
          <div className="offer-list">
            <div className="offer-list__head">
              <span>Retailer offer</span>
              <span>Estimated total</span>
            </div>
            {offers.map((offer) => (
              <OfferRow
                key={offer.retailer}
                offer={offer}
                quantity={quantity}
                onOpen={() => openRetailer(offer)}
              />
            ))}
          </div>
          <div className="detail-actions">
            <button
              className="button button--primary"
              onClick={() => {
                addToBasket(product.id, quantity);
                toast.success("Added to basket", { description: `${quantity} × ${product.name}` });
                navigate("/basket");
              }}
            >
              <ShoppingBasket size={17} /> Add {quantity} pack{quantity > 1 ? "s" : ""} to basket
            </button>
            <Link href="/basket" className="button button--outline">
              View basket
            </Link>
          </div>
        </div>
      </section>
      <section className="container detail-disclosure">
        <CircleHelp size={17} />
        <p>
          <strong>Stock and pricing note.</strong>{" "}
          {product.unavailableReason ?? "Offers show direct supermarket fulfilment only."} Prices
          are estimated prototype values and may have changed. Confirm details on the retailer’s
          website before checkout.
        </p>
      </section>
    </main>
  );
}

function useRouteParams() {
  const [match, params] = useRoute("/product/:id");
  return [match, params] as const;
}

function OfferRow({
  offer,
  quantity,
  onOpen,
}: {
  offer: Offer & { requestedQuantity?: number; productCostCents?: number | null };
  quantity: number;
  onOpen: () => void;
}) {
  const cost =
    offer.productCostCents ??
    (offer.stockState === "in_stock" ? offer.unitPriceCents * quantity : null);
  const accent =
    offer.retailer === "RedMart"
      ? "#e85c62"
      : offer.retailer === "FairPrice"
        ? "#16866e"
        : "#355cb4";
  return (
    <div className={`offer-row ${offer.stockState === "unavailable" ? "offer-row--muted" : ""}`}>
      <div className="offer-row__retailer">
        <span className="retailer-dot" style={{ background: accent }} />{" "}
        <div>
          <strong>{offer.retailer}</strong>
          <span>
            {formatSgd(offer.unitPriceCents)} / pack ·{" "}
            {offer.stockState === "in_stock" ? "In stock in dataset" : "Unavailable"}
          </span>
        </div>
      </div>
      <div className="offer-row__price">
        <strong>{formatSgd(cost)}</strong>
        {offer.promotion ? (
          <span className="promo-chip">
            <Check size={12} /> {offer.promotion.label}
          </span>
        ) : offer.promotionExcluded ? (
          <span className="promo-chip promo-chip--excluded">Promotion excluded</span>
        ) : null}
      </div>
      <button
        className="icon-button"
        disabled={offer.stockState === "unavailable"}
        onClick={onOpen}
        aria-label={`Open ${offer.retailer} product link`}
      >
        <ArrowRight size={18} />
      </button>
    </div>
  );
}

export function BasketPage() {
  const {
    basket,
    retailerLimit,
    comparison,
    isStale,
    setQuantity,
    removeFromBasket,
    setRetailerLimit,
    setComparison,
    loadScenario,
  } = useBasket();
  const [location, navigate] = useLocation();
  const compareMutation = trpc.compare.useMutation();
  const demoQuery = trpc.demo.useQuery();
  const totalPacks = basket.reduce((sum, line) => sum + line.quantity, 0);
  const runComparison = () => {
    compareMutation.mutate(
      { lines: basket, retailerLimit, datasetVersion: DATASET_VERSION },
      {
        onSuccess: (result) => {
          setComparison(result);
          navigate("/results");
        },
        onError: () => toast.error("Calculation failed — please retry"),
      },
    );
  };
  return (
    <main>
      <PageIntro
        eyebrow="Your basket"
        title="Compare the basket, not partial items."
        description="CartOptix assigns every basket line to one retailer at a time. Choose the maximum number of orders, then run a fresh estimate."
      >
        <div className="data-pill">
          <ShoppingBasket size={14} /> {basket.length} distinct lines · {totalPacks} whole packs
        </div>
      </PageIntro>
      <section className="container basket-layout">
        <div className="basket-main">
          {isStale && (
            <div className="stale-banner">
              <AlertCircle size={18} />
              <div>
                <strong>Your basket changed.</strong>
                <span>Run a new comparison to view current results.</span>
              </div>
              <Link href="/results" className="text-link">
                View previous
              </Link>
            </div>
          )}
          {basket.length === 0 ? (
            <div className="empty-state basket-empty">
              <ShoppingBasket size={30} />
              <h2>Your basket is empty</h2>
              <p>Start with the curated catalogue or load a reproducible demo scenario.</p>
              <Link className="button button--primary" href="/catalogue">
                Browse products <ArrowRight size={16} />
              </Link>
            </div>
          ) : (
            <div className="basket-card">
              <div className="basket-card__header">
                <div>
                  <p className="eyebrow">Basket lines</p>
                  <h2>Exact products you selected</h2>
                </div>
                <Link href="/catalogue" className="button button--outline button--small">
                  Add more
                </Link>
              </div>
              {basket.map((line) => {
                const product = getProduct(line.productId);
                if (!product) return null;
                return (
                  <BasketRow
                    key={line.productId}
                    line={line}
                    product={product}
                    onChange={(quantity) => setQuantity(line.productId, quantity)}
                    onRemove={() => removeFromBasket(line.productId)}
                  />
                );
              })}
            </div>
          )}
          <div className="demo-panel">
            <div>
              <p className="eyebrow">Reproducible demos</p>
              <h3>Try a known scenario</h3>
              <p>These controls load fixed baskets for testing comparison outcomes.</p>
            </div>
            <div className="demo-grid">
              {Object.entries(demoQuery.data?.scenarios ?? DEMO_SCENARIOS).map(
                ([key, scenario]) => (
                  <button
                    key={key}
                    className="demo-button"
                    onClick={() => {
                      loadScenario(scenario.lines, scenario.retailerLimit);
                      toast.success("Demo scenario loaded", { description: scenario.label });
                    }}
                  >
                    <strong>{scenario.label}</strong>
                    <span>{scenario.description}</span>
                  </button>
                ),
              )}
            </div>
          </div>
        </div>
        <aside className="basket-sidebar">
          <div className="basket-summary-card">
            <p className="eyebrow">Comparison setup</p>
            <h2>How many retailer orders?</h2>
            <p className="muted">
              CartOptix checks single-retailer plans and permitted split plans up to this limit.
            </p>
            <div className="limit-options">
              {([1, 2, 3] as const).map((limit) => (
                <button
                  key={limit}
                  className={retailerLimit === limit ? "is-selected" : ""}
                  onClick={() => setRetailerLimit(limit)}
                >
                  <strong>{limit}</strong>
                  <span>{limit === 1 ? "One order" : "Up to " + limit + " orders"}</span>
                </button>
              ))}
            </div>
            <div className="scenario-box">
              <div>
                <Check size={15} /> Singapore serviceable location
              </div>
              <div>
                <Check size={15} /> Standard delivery
              </div>
              <div>
                <Check size={15} /> Non-member pricing
              </div>
              <small>No postcode or delivery-slot selector.</small>
            </div>
            <div className="basket-summary-card__footer">
              <span>Basket lines</span>
              <strong>{basket.length} / 50</strong>
            </div>
            <button
              className="button button--primary button--full"
              disabled={!basket.length || compareMutation.isPending}
              onClick={runComparison}
            >
              {compareMutation.isPending ? "Comparing…" : "Compare basket"} <ArrowRight size={17} />
            </button>
            {comparison && !isStale && (
              <Link className="button button--text button--full" href="/results">
                View current results
              </Link>
            )}
          </div>
          <div className="trust-card">
            <Sparkles size={17} />
            <p>
              <strong>Fixed dataset disclaimer</strong> Prices and availability are prototype
              estimates, not live checkout prices. Confirm details on retailer websites.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}

function BasketRow({
  line,
  product,
  onChange,
  onRemove,
}: {
  line: BasketLine;
  product: Product;
  onChange: (quantity: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="basket-row">
      <ProductImage product={product} className="product-image--basket" />
      <div className="basket-row__identity">
        <strong>{product.name}</strong>
        <span>
          {product.brand} · {product.packSize}
        </span>
        <span>{product.category}</span>
      </div>
      <div className="quantity-control quantity-control--compact">
        <button
          aria-label={`Decrease ${product.name}`}
          onClick={() => onChange(Math.max(1, line.quantity - 1))}
        >
          −
        </button>
        <strong>{line.quantity}</strong>
        <button
          aria-label={`Increase ${product.name}`}
          onClick={() => onChange(Math.min(20, line.quantity + 1))}
        >
          +
        </button>
      </div>
      <button
        className="icon-button icon-button--subtle"
        aria-label={`Remove ${product.name}`}
        onClick={onRemove}
      >
        <X size={17} />
      </button>
    </div>
  );
}

export function ResultsPage() {
  const { comparison, isStale } = useBasket();
  if (!comparison)
    return (
      <main>
        <div className="container empty-state">
          <AlertCircle size={28} />
          <h1>No comparison yet</h1>
          <p>Build a basket and run a new estimate first.</p>
          <Link className="button button--primary" href="/basket">
            Go to basket <ArrowRight size={16} />
          </Link>
        </div>
      </main>
    );
  const total =
    comparison.recommended === "split"
      ? comparison.bestSplit?.totalCents
      : comparison.baseline?.totalCents;
  const resultOrders =
    comparison.recommended === "split"
      ? (comparison.bestSplit?.orders ?? [])
      : comparison.baseline
        ? [comparison.baseline]
        : [];
  return (
    <main>
      <PageIntro
        eyebrow="Comparison results"
        title="A transparent plan for this basket."
        description="Every plan below completes the same basket using whole packs. Use the breakdown to make an informed decision before checkout."
      >
        <div className="data-pill">
          <Check size={14} /> {comparison.calculationStatus}
        </div>
      </PageIntro>
      <section className="container results-page">
        {isStale && (
          <div className="stale-banner stale-banner--large">
            <AlertCircle size={18} />
            <div>
              <strong>Your basket changed.</strong>
              <span>Run a new comparison to view current results.</span>
            </div>
            <Link href="/basket" className="button button--small button--outline">
              Edit basket
            </Link>
          </div>
        )}
        {comparison.status === "no_valid_plan" ? (
          <NoPlanResult />
        ) : (
          <>
            <div className="result-hero">
              <div>
                <p className="result-hero__label">
                  <Sparkles size={15} /> Recommended plan
                </p>
                <h2>
                  {comparison.recommended === "split"
                    ? "Split your basket"
                    : "Keep it with one retailer"}
                </h2>
                <p>{comparison.explanation}</p>
              </div>
              <div className="result-hero__total">
                <span>Estimated total</span>
                <strong>{formatSgd(total)}</strong>
                {comparison.savingsCents && comparison.savingsCents > 0 ? (
                  <em>Save {formatSgd(comparison.savingsCents)}</em>
                ) : (
                  <em className="result-hero__neutral">No lower split total</em>
                )}
              </div>
            </div>
            <div className="results-grid">
              <PlanSummary
                title="Single-retailer baseline"
                subtitle="Cheapest complete one-order plan"
                order={comparison.baseline}
                emptyLabel="No complete single-retailer baseline available."
                highlighted={comparison.recommended === "baseline"}
              />
              <SplitSummary
                split={comparison.bestSplit}
                highlighted={comparison.recommended === "split"}
              />
            </div>
            <div className="result-explanation">
              <CircleHelp size={17} />
              <p>
                <strong>Calculation status.</strong> {comparison.calculationStatus} CartOptix
                recommends the best valid plan found within the selected limit; it does not claim
                mathematical optimality.
              </p>
            </div>
            <div className="orders-section">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Purchase plan</p>
                  <h2>
                    {comparison.recommended === "split"
                      ? "Products by retailer"
                      : "Complete order breakdown"}
                  </h2>
                </div>
                <Link href="/basket" className="button button--outline button--small">
                  Edit basket
                </Link>
              </div>
              {resultOrders.map((order) => (
                <OrderCard key={order.retailer} order={order} />
              ))}
            </div>
            {comparison.excludedPromotions.length > 0 && (
              <div className="notice-card notice-card--warning">
                <AlertCircle size={18} />
                <div>
                  <strong>Excluded-promotion notices</strong>
                  {comparison.excludedPromotions.map((notice) => (
                    <p key={notice}>{notice}</p>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        <div className="results-disclaimer">
          <Sparkles size={17} />
          <div>
            <strong>Prototype estimate, not live checkout pricing.</strong>
            <p>
              Fixed curated dataset · direct supermarket fulfilment only · third-party sellers
              excluded · prices and availability may have changed. Retailer payments do not
              influence recommendations.
            </p>
          </div>
        </div>
        <div className="results-actions">
          <Link href="/basket" className="button button--primary">
            Run another comparison <ArrowRight size={17} />
          </Link>
          <Link href="/catalogue" className="button button--outline">
            Browse catalogue
          </Link>
        </div>
      </section>
    </main>
  );
}

function NoPlanResult() {
  return (
    <div className="no-plan-card">
      <div className="no-plan-card__icon">
        <AlertCircle size={24} />
      </div>
      <div>
        <p className="eyebrow">Calculation status</p>
        <h2>No valid plan found.</h2>
        <p>
          No complete basket plan met the fixed dataset’s stock and order constraints within the
          selected retailer limit. This is not labelled impossible because the search limits do not
          prove impossibility.
        </p>
        <Link href="/basket" className="text-link">
          Edit basket and try again <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  );
}

function PlanSummary({
  title,
  subtitle,
  order,
  emptyLabel,
  highlighted,
}: {
  title: string;
  subtitle: string;
  order: any;
  emptyLabel: string;
  highlighted: boolean;
}) {
  return (
    <div className={`plan-summary ${highlighted ? "plan-summary--highlighted" : ""}`}>
      <div className="plan-summary__head">
        <div>
          <p className="plan-summary__eyebrow">{highlighted ? "Recommended plan" : "Baseline"}</p>
          <h3>{title}</h3>
          <span>{subtitle}</span>
        </div>
        {order ? (
          <strong>{formatSgd(order.totalCents)}</strong>
        ) : (
          <strong className="muted">Unavailable</strong>
        )}
      </div>
      {order ? (
        <>
          <div className="plan-retailer-pill">
            <span className="retailer-dot retailer-dot--navy" />
            {order.retailer}
            <span>1 order</span>
          </div>
          <PlanBreakdown order={order} />
        </>
      ) : (
        <div className="plan-empty">
          <AlertCircle size={17} /> {emptyLabel}
        </div>
      )}
    </div>
  );
}

function SplitSummary({
  split,
  highlighted,
}: {
  split: ComparisonResult["bestSplit"];
  highlighted: boolean;
}) {
  return (
    <div className={`plan-summary ${highlighted ? "plan-summary--highlighted" : ""}`}>
      <div className="plan-summary__head">
        <div>
          <p className="plan-summary__eyebrow">
            {highlighted ? "Recommended plan" : "Alternative"}
          </p>
          <h3>Best plan found</h3>
          <span>Permitted split up to selected limit</span>
        </div>
        {split ? (
          <strong>{formatSgd(split.totalCents)}</strong>
        ) : (
          <strong className="muted">No valid split</strong>
        )}
      </div>
      {split ? (
        <>
          <div className="plan-retailer-pill">
            <span className="retailer-dot retailer-dot--green" />
            {split.retailerCount} retailer orders<span>Search limit reached</span>
          </div>
          <div className="mini-assignment">
            {split.orders.map((order) => (
              <div key={order.retailer}>
                <span>{order.retailer}</span>
                <strong>{formatSgd(order.totalCents)}</strong>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="plan-empty">
          <AlertCircle size={17} /> No permitted split plan beat the baseline.
        </div>
      )}
    </div>
  );
}

function PlanBreakdown({ order }: { order: any }) {
  return (
    <div className="plan-breakdown">
      <div>
        <span>Products</span>
        <strong>{formatSgd(order.subtotalCents)}</strong>
      </div>
      <div>
        <span>Delivery</span>
        <strong>{formatSgd(order.deliveryCents)}</strong>
      </div>
      <div>
        <span>Mandatory</span>
        <strong>{formatSgd(order.mandatoryCents)}</strong>
      </div>
    </div>
  );
}

function OrderCard({ order }: { order: any }) {
  const clickMutation = trpc.outboundClick.useMutation();
  return (
    <article className="order-card">
      <div className="order-card__head">
        <div>
          <p className="eyebrow">Retailer order</p>
          <h3>{order.retailer}</h3>
        </div>
        <div className="order-card__total">
          <span>Estimated order total</span>
          <strong>{formatSgd(order.totalCents)}</strong>
        </div>
      </div>
      <div className="order-card__lines">
        {order.lines.map((line: any) => (
          <div className="order-line" key={line.productId}>
            <div>
              <strong>
                {line.quantity} × {line.product.name}
              </strong>
              <span>
                {line.product.brand} · {line.product.packSize}
              </span>
            </div>
            <strong>{formatSgd(line.lineTotalCents)}</strong>
            <button
              className="icon-button icon-button--subtle"
              onClick={() => {
                clickMutation.mutate(
                  {
                    retailer: order.retailer,
                    productId: line.productId,
                    destination: line.offer.productUrl,
                  },
                  { onError: () => undefined },
                );
                window.open(line.offer.productUrl, "_blank", "noopener,noreferrer");
              }}
              aria-label={`Open ${line.product.name} at ${order.retailer}`}
            >
              <ArrowRight size={16} />
            </button>
          </div>
        ))}
      </div>
      <div className="order-card__breakdown">
        <div>
          <span>Product subtotal</span>
          <strong>{formatSgd(order.subtotalCents)}</strong>
        </div>
        <div>
          <span>
            Delivery fee <small>{order.deliveryNote}</small>
          </span>
          <strong>{formatSgd(order.deliveryCents)}</strong>
        </div>
        <div>
          <span>
            Mandatory charges <small>{order.mandatoryNote}</small>
          </span>
          <strong>{formatSgd(order.mandatoryCents)}</strong>
        </div>
      </div>
      <button
        className="button button--outline button--small"
        onClick={() =>
          toast("Outbound links ready", {
            description:
              "CartOptix does not transfer carts. Rebuild this order on the retailer’s website.",
          })
        }
      >
        Open retailer product links <ArrowRight size={15} />
      </button>
    </article>
  );
}

function HowItWorks() {
  return (
    <section id="how-it-works" className="how-it-works">
      <div className="container">
        <div className="section-heading section-heading--center">
          <div>
            <p className="eyebrow">How the comparison works</p>
            <h2>Simple inputs. Transparent trade-offs.</h2>
          </div>
          <p>
            CartOptix is designed to help you decide before checkout, without pretending to be a
            live cart or a guaranteed lowest-price service.
          </p>
        </div>
        <div className="steps-grid">
          <div className="step">
            <span>01</span>
            <h3>Choose exact products</h3>
            <p>
              Search a fixed curated dataset. Brands, variants and pack sizes are never substituted.
            </p>
          </div>
          <div className="step">
            <span>02</span>
            <h3>Set the order limit</h3>
            <p>
              Compare one retailer against permitted split plans using whole packs and non-member
              pricing.
            </p>
          </div>
          <div className="step">
            <span>03</span>
            <h3>Read the plan</h3>
            <p>
              See product subtotals, delivery fees, mandatory charges, promotions and
              excluded-promotion notes.
            </p>
          </div>
        </div>
        <div className="transparency-grid">
          <div>
            <h3>What is included</h3>
            <p>
              Direct supermarket fulfilment, ordinary prices, clearly unconditional sale prices,
              verified same-product multibuys, delivery fees, free-delivery thresholds and
              minimum-order values.
            </p>
          </div>
          <div>
            <h3>What is not included</h3>
            <p>
              Live scraping, third-party sellers, cross-product promotions, cart transfer, stock
              reservation, payment, delivery-slot selection or buying extra items just to unlock a
              discount.
            </p>
          </div>
          <div>
            <h3>Why the result is an estimate</h3>
            <p>
              Prices and availability may have changed, and some promotions are excluded when their
              terms cannot be verified. Confirm details on the retailer’s website.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export { AppShell, DATASET_VERSION, HowItWorks };

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/catalogue" component={CataloguePage} />
      <Route path="/product/:id" component={ProductDetail} />
      <Route path="/basket" component={BasketPage} />
      <Route path="/results" component={ResultsPage} />
      <Route
        component={() => (
          <main>
            <div className="container empty-state">
              <h1>Page not found</h1>
              <Link href="/" className="button button--primary">
                Back home
              </Link>
            </div>
          </main>
        )}
      />
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <BasketProvider>
            <Toaster />
            <AppShell>
              <Router />
            </AppShell>
          </BasketProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
