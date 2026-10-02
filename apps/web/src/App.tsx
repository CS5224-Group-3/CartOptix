// Defines the top-level web application shell, routing, and shared providers.

import {
  type BasketCompareResponse,
  DEPOSIT_NOTICE,
  MAX_BASKET_LINES,
  MAX_PACKS_PER_LINE,
  MIN_PACKS_PER_LINE,
  type Offer,
  type Order,
  type Product,
  type RetailerId,
  SNAPSHOT_DISCLAIMER,
} from "@cartoptix/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link, Route, Switch, useLocation, useRoute } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import ErrorBoundary from "./components/ErrorBoundary";
import { type BasketLine, DEMO_SCENARIOS } from "./demo";
import {
  ApiError,
  useCatalogue,
  useCompareBasket,
  useOffers,
  useProductIndex,
  useProducts,
} from "./lib/api";
import {
  categoryVisual,
  excludedPromotionNotes,
  formatSgd,
  orderChargeLabel,
  orderChargesCents,
  orderSubtotalCents,
  RETAILER_DISPLAY,
  RETAILER_IDS,
} from "./lib/format";
import Home from "./pages/Home";

const clampPacks = (quantity: number) =>
  Math.min(MAX_PACKS_PER_LINE, Math.max(MIN_PACKS_PER_LINE, Math.round(quantity)));

type BasketContextValue = {
  basket: BasketLine[];
  comparison: BasketCompareResponse | null;
  isStale: boolean;
  basketCount: number;
  addToBasket: (productId: string, quantity: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  removeFromBasket: (productId: string) => void;
  setComparison: (result: BasketCompareResponse) => void;
  loadScenario: (lines: BasketLine[]) => void;
};

const BasketContext = createContext<BasketContextValue | null>(null);

function BasketProvider({ children }: { children: ReactNode }) {
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [comparison, setComparisonState] = useState<BasketCompareResponse | null>(null);
  const [basketRevision, setBasketRevision] = useState(0);
  const [comparedRevision, setComparedRevision] = useState(-1);

  const changed = useCallback((next: BasketLine[]) => {
    setBasket(next);
    setBasketRevision((revision) => revision + 1);
  }, []);

  const value = useMemo<BasketContextValue>(
    () => ({
      basket,
      comparison,
      isStale: Boolean(comparison && comparedRevision !== basketRevision),
      basketCount: basket.reduce((total, line) => total + line.quantity, 0),
      addToBasket: (productId, quantity) => {
        const current = basket.find((line) => line.productId === productId);
        if (current) {
          changed(
            basket.map((line) =>
              line.productId === productId
                ? { ...line, quantity: clampPacks(line.quantity + quantity) }
                : line,
            ),
          );
        } else if (basket.length < MAX_BASKET_LINES) {
          changed([...basket, { productId, quantity: clampPacks(quantity) }]);
        } else {
          toast.error("Basket limit reached", {
            description: `CartOptix supports up to ${MAX_BASKET_LINES} distinct basket lines.`,
          });
        }
      },
      setQuantity: (productId, quantity) => {
        changed(
          basket.map((line) =>
            line.productId === productId ? { ...line, quantity: clampPacks(quantity) } : line,
          ),
        );
      },
      removeFromBasket: (productId) =>
        changed(basket.filter((line) => line.productId !== productId)),
      setComparison: (result) => {
        setComparisonState(result);
        setComparedRevision(basketRevision);
      },
      loadScenario: (lines) => {
        setBasket(lines);
        setComparisonState(null);
        setBasketRevision((revision) => revision + 1);
        setComparedRevision(-1);
      },
    }),
    [basket, comparison, basketRevision, comparedRevision, changed],
  );

  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>;
}

export function useBasket() {
  const context = useContext(BasketContext);
  if (!context) throw new Error("useBasket must be used within BasketProvider");
  return context;
}

/** Category names from the catalogue endpoint, keyed by ID. */
function useCategoryNames() {
  const { data } = useCatalogue();
  return useMemo(
    () => new Map((data?.categories ?? []).map((category) => [category.categoryId, category.name])),
    [data],
  );
}

/** The delivery-rule note for a retailer, from the catalogue. */
function useDeliveryNotes() {
  const { data } = useCatalogue();
  return useMemo(() => {
    const notes = new Map<RetailerId, string>();
    for (const rule of data?.delivery.rules ?? []) {
      notes.set(
        rule.retailerId,
        rule.status === "verified" ? rule.note : "Delivery rule unavailable",
      );
    }
    return notes;
  }, [data]);
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
            type="button"
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
  const { emoji, accent } = categoryVisual(product.categoryId);
  return failed || product.imageUrl === null ? (
    <div
      className={`product-image product-image--fallback ${className}`}
      style={{ background: accent }}
      role="img"
      aria-label={`${product.name} placeholder`}
    >
      <span>{emoji}</span>
    </div>
  ) : (
    <div className={`product-image ${className}`} style={{ background: accent }}>
      <img src={product.imageUrl} alt={product.name} onError={() => setFailed(true)} />
      <span className="product-image__emoji" aria-hidden="true">
        {emoji}
      </span>
    </div>
  );
}

function ProductCard({ product, categoryName }: { product: Product; categoryName: string }) {
  const { addToBasket } = useBasket();
  return (
    <article className="product-card">
      <Link
        href={`/product/${product.productId}`}
        className="product-card__link"
        aria-label={`View ${product.name}`}
      >
        <ProductImage product={product} />
        <div className="product-card__body">
          <p className="product-card__category">{categoryName}</p>
          <h3>{product.name}</h3>
          <p className="product-card__meta">{product.packSize}</p>
        </div>
      </Link>
      <div className="product-card__actions">
        <button
          type="button"
          className="button button--small button--outline"
          onClick={() => {
            addToBasket(product.productId, 1);
            toast.success("Added to basket", { description: product.name });
          }}
        >
          <ShoppingBasket size={15} /> Add
        </button>
        <Link className="text-link text-link--small" href={`/product/${product.productId}`}>
          Compare offers <ArrowRight size={13} />
        </Link>
      </div>
    </article>
  );
}

export function CataloguePage() {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 24;
  const [pageInput, setPageInput] = useState("1");
  const catalogue = useCatalogue();
  const categoryNames = useCategoryNames();
  const query = useMemo(
    () => ({
      ...(search.trim() ? { q: search.trim() } : {}),
      ...(categoryId ? { categoryId } : {}),
      page,
      pageSize,
    }),
    [search, categoryId, page],
  );
  const { data, isLoading, isError } = useProducts(query);
  const products = data?.products ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const jumpToPage = () => {
    const nextPage = Math.min(totalPages, Math.max(1, Number.parseInt(pageInput, 10) || 1));
    setPageInput(String(nextPage));
    setPage(nextPage);
  };
  return (
    <main>
      <PageIntro
        eyebrow="Prototype catalogue"
        title="Build a basket from exact products."
        description="Search the demo catalogue, inspect retailer offers, then add whole packs to your basket. Product identity and pack size stay fixed throughout the comparison."
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
              maxLength={100}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
                setPageInput("1");
              }}
              placeholder="Search by product, brand or variant"
            />
          </label>
          <label className="select-field">
            <span className="sr-only">Filter category</span>
            <select
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
                setPage(1);
                setPageInput("1");
              }}
            >
              <option value="">All</option>
              {(catalogue.data?.categories ?? []).map((category) => (
                <option key={category.categoryId} value={category.categoryId}>
                  {category.name}
                </option>
              ))}
            </select>
            <ChevronDown size={16} />
          </label>
        </div>
        <div className="catalogue-summary">
          <p>
            <strong>{total}</strong> products shown
          </p>
          <p>{catalogue.data?.categories.length ?? 0} categories</p>
        </div>
        {isLoading ? (
          <div className="loading-state">Loading the catalogue…</div>
        ) : isError ? (
          <div className="empty-state">
            <AlertCircle size={24} />
            <h2>Could not load products</h2>
            <p>The catalogue service is unavailable. Please try again shortly.</p>
          </div>
        ) : products.length ? (
          <>
            <div className="product-grid">
              {products.map((product) => (
                <ProductCard
                  key={product.productId}
                  product={product}
                  categoryName={categoryNames.get(product.categoryId) ?? ""}
                />
              ))}
            </div>
            <nav className="catalogue-pagination" aria-label="Catalogue pages">
              <button type="button" className="button button--outline" disabled={page === 1} onClick={() => { setPage((current) => current - 1); setPageInput(String(page - 1)); }}>Previous</button>
              <span>Page {page} of {totalPages}</span>
              <button type="button" className="button button--outline" disabled={page >= totalPages} onClick={() => { setPage((current) => current + 1); setPageInput(String(page + 1)); }}>Next</button>
              <label className="page-size-control">
                <span>Go to page</span>
                <input
                  type="number"
                  min="1"
                  max={totalPages}
                  value={pageInput}
                  onChange={(event) => setPageInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") jumpToPage();
                  }}
                />
                <button type="button" className="button button--outline" onClick={jumpToPage}>Go</button>
              </label>
            </nav>
          </>
        ) : (
          <div className="empty-state">
            <CircleHelp size={24} />
            <h2>No matching products</h2>
            <p>Try a different product name or category.</p>
            <button
              type="button"
              className="button button--outline"
              onClick={() => {
                setSearch("");
                setCategoryId("");
                setPage(1);
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

function openRetailerLink(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function ProductDetail() {
  const [, params] = useRoute("/product/:id");
  const productId = params?.id ?? "";
  const [quantity, setQuantity] = useState(1);
  const { data, isLoading, error } = useOffers(productId, quantity);
  const categoryNames = useCategoryNames();
  const { addToBasket } = useBasket();
  const [, navigate] = useLocation();
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
          <h1>
            {error instanceof ApiError && error.status === 404
              ? "Product not found"
              : "Could not load offers"}
          </h1>
          <p>
            {error instanceof ApiError && error.status === 404
              ? "That product is not in the prototype dataset."
              : "The offers service is unavailable. Please try again shortly."}
          </p>
          <Link className="button button--primary" href="/catalogue">
            Back to catalogue
          </Link>
        </div>
      </main>
    );
  const { product, offers } = data;
  const categoryName = categoryNames.get(product.categoryId) ?? "";
  const missingRetailers = RETAILER_IDS.filter(
    (retailerId) => !offers.some((offer) => offer.retailerId === retailerId),
  );
  return (
    <main>
      <div className="container breadcrumb-row">
        <Link href="/catalogue" className="text-link">
          ← Back to catalogue
        </Link>
        <span>/</span>
        <span>{categoryName}</span>
      </div>
      <section className="container product-detail">
        <div className="product-detail__visual">
          <ProductImage product={product} className="product-image--detail" />
          <div className="prototype-note">
            <Sparkles size={15} /> Exact product identity · demo data
          </div>
        </div>
        <div className="product-detail__content">
          <p className="eyebrow">{categoryName}</p>
          <h1>{product.name}</h1>
          <div className="identity-grid">
            <div>
              <span>Pack size</span>
              <strong>{product.packSize}</strong>
            </div>
            <div>
              <span>Quantity rule</span>
              <strong>Whole packs only</strong>
            </div>
            <div>
              <span>Pricing</span>
              <strong>Non-member</strong>
            </div>
          </div>
          <p className="product-detail__copy">
            Compare the estimated product cost for your requested quantity. Prices use ordinary or
            clearly unconditional sale prices; other promotions are shown as excluded.
          </p>
          <div className="quantity-control">
            <span>Quantity</span>
            <button
              type="button"
              aria-label="Decrease quantity"
              onClick={() => setQuantity(clampPacks(quantity - 1))}
            >
              −
            </button>
            <strong>{quantity}</strong>
            <button
              type="button"
              aria-label="Increase quantity"
              onClick={() => setQuantity(clampPacks(quantity + 1))}
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
                key={offer.retailerId}
                offer={offer}
                onOpen={() => openRetailerLink(offer.productUrl)}
              />
            ))}
            {missingRetailers.map((retailerId) => (
              <UnavailableOfferRow key={retailerId} retailerId={retailerId} />
            ))}
          </div>
          <div className="detail-actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                addToBasket(product.productId, quantity);
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
          {offers.length === 0
            ? "No retailer has an eligible direct-fulfilment offer for this product in the dataset."
            : "Offers show direct supermarket fulfilment only."}{" "}
          {SNAPSHOT_DISCLAIMER}
        </p>
      </section>
    </main>
  );
}

function OfferRow({ offer, onOpen }: { offer: Offer; onOpen: () => void }) {
  const retailer = RETAILER_DISPLAY[offer.retailerId];
  return (
    <div className="offer-row">
      <div className="offer-row__retailer">
        <span className="retailer-dot" style={{ background: retailer.accent }} />{" "}
        <div>
          <strong>{retailer.name}</strong>
          <span>
            {formatSgd(offer.unitPriceCents)} / pack ·{" "}
            {offer.priceKind === "unconditional_sale" ? "Sale price" : "In stock in dataset"}
          </span>
        </div>
      </div>
      <div className="offer-row__price">
        <strong>{formatSgd(offer.lineTotalCents)}</strong>
        {offer.excludedPromotions.length > 0 && (
          <span className="promo-chip promo-chip--excluded" title={offer.excludedPromotions[0]}>
            Promotion excluded
          </span>
        )}
      </div>
      <button
        type="button"
        className="icon-button"
        onClick={onOpen}
        aria-label={`Open ${retailer.name} product link`}
      >
        <ArrowRight size={18} />
      </button>
    </div>
  );
}

function UnavailableOfferRow({ retailerId }: { retailerId: RetailerId }) {
  const retailer = RETAILER_DISPLAY[retailerId];
  return (
    <div className="offer-row offer-row--muted">
      <div className="offer-row__retailer">
        <span className="retailer-dot" style={{ background: retailer.accent }} />{" "}
        <div>
          <strong>{retailer.name}</strong>
          <span>No eligible offer</span>
        </div>
      </div>
      <div className="offer-row__price">
        <strong>Unavailable</strong>
      </div>
      <span />
    </div>
  );
}

export function BasketPage() {
  const {
    basket,
    comparison,
    isStale,
    setQuantity,
    removeFromBasket,
    setComparison,
    loadScenario,
  } = useBasket();
  const [, navigate] = useLocation();
  const compareMutation = useCompareBasket();
  const products = useProductIndex();
  const categoryNames = useCategoryNames();
  const totalPacks = basket.reduce((sum, line) => sum + line.quantity, 0);
  const runComparison = () => {
    compareMutation.mutate(
      { lines: basket },
      {
        onSuccess: (result) => {
          setComparison(result);
          navigate("/results");
        },
        onError: (error) =>
          toast.error(
            error instanceof ApiError && error.code === "invalid_request"
              ? "The basket could not be compared"
              : "Calculation failed — please retry",
            { description: error.message },
          ),
      },
    );
  };
  return (
    <main>
      <PageIntro
        eyebrow="Your basket"
        title="Compare the basket, not partial items."
        description="CartOptix prices your complete basket at each retailer. Run a fresh estimate whenever the basket changes."
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
              <p>Start with the catalogue or load a reproducible demo scenario.</p>
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
                const product = products.get(line.productId);
                if (!product)
                  return (
                    <div className="basket-row" key={line.productId}>
                      <div className="basket-row__identity">
                        <strong>Loading product…</strong>
                        <span>{line.quantity} packs</span>
                      </div>
                    </div>
                  );
                return (
                  <BasketRow
                    key={line.productId}
                    line={line}
                    product={product}
                    categoryName={categoryNames.get(product.categoryId) ?? ""}
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
              {Object.entries(DEMO_SCENARIOS).map(([key, scenario]) => (
                <button
                  type="button"
                  key={key}
                  className="demo-button"
                  onClick={() => {
                    loadScenario(scenario.lines);
                    toast.success("Demo scenario loaded", { description: scenario.label });
                  }}
                >
                  <strong>{scenario.label}</strong>
                  <span>{scenario.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <aside className="basket-sidebar">
          <div className="basket-summary-card">
            <p className="eyebrow">Comparison setup</p>
            <h2>Compare the complete basket</h2>
            <p className="muted">
              CartOptix prices every line at each retailer and recommends the cheapest retailer that
              can supply the whole basket.
            </p>
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
              <strong>
                {basket.length} / {MAX_BASKET_LINES}
              </strong>
            </div>
            <button
              type="button"
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
              <strong>Fixed dataset disclaimer</strong> {SNAPSHOT_DISCLAIMER}
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
  categoryName,
  onChange,
  onRemove,
}: {
  line: BasketLine;
  product: Product;
  categoryName: string;
  onChange: (quantity: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="basket-row">
      <ProductImage product={product} className="product-image--basket" />
      <div className="basket-row__identity">
        <strong>{product.name}</strong>
        <span>{product.packSize}</span>
        <span>{categoryName}</span>
      </div>
      <div className="quantity-control quantity-control--compact">
        <button
          type="button"
          aria-label={`Decrease ${product.name}`}
          onClick={() => onChange(line.quantity - 1)}
        >
          −
        </button>
        <strong>{line.quantity}</strong>
        <button
          type="button"
          aria-label={`Increase ${product.name}`}
          onClick={() => onChange(line.quantity + 1)}
        >
          +
        </button>
      </div>
      <button
        type="button"
        className="icon-button icon-button--subtle"
        aria-label={`Remove ${product.name}`}
        onClick={onRemove}
      >
        <X size={17} />
      </button>
    </div>
  );
}

type Comparison = BasketCompareResponse;
type Option = Comparison["options"][number];
type UnavailableOption = Extract<Option, { status: "unavailable" }>;
type CompleteOption = Extract<Option, { status: "complete" }>;

function reasonText(
  reason: UnavailableOption["reasons"][number],
  productName: (productId: string) => string,
): string {
  switch (reason.code) {
    case "missing_products":
      return `No eligible offer for ${reason.productIds.map(productName).join(", ")}.`;
    case "below_minimum_order":
      return `Order of ${formatSgd(reason.spendCents)} is below the ${formatSgd(reason.minimumOrderCents)} minimum.`;
    case "delivery_rule_unverified":
      return "Delivery charges could not be verified, so a complete total is not shown.";
  }
}

export function ResultsPage() {
  const { comparison, isStale } = useBasket();
  const products = useProductIndex();
  const productName = (productId: string) => products.get(productId)?.name ?? productId;
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
  const recommended =
    comparison.status === "recommended"
      ? comparison.options.find(
          (option): option is CompleteOption =>
            option.status === "complete" && option.retailerId === comparison.recommendedRetailerId,
        )
      : undefined;
  const notices = recommended ? excludedPromotionNotes(recommended, productName) : [];
  return (
    <main>
      <PageIntro
        eyebrow="Comparison results"
        title="A transparent plan for this basket."
        description="Each retailer is priced for the same complete basket using whole packs. Use the breakdown to make an informed decision before checkout."
      >
        <div className="data-pill">
          <Check size={14} />{" "}
          {recommended
            ? "Cheapest complete basket found across all retailers."
            : "No retailer can supply the complete basket."}
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
        {recommended ? (
          <div className="result-hero">
            <div>
              <p className="result-hero__label">
                <Sparkles size={15} /> Recommended retailer
              </p>
              <h2>Buy it all at {RETAILER_DISPLAY[recommended.retailerId].name}</h2>
              <p>
                The cheapest complete basket under the current dataset and delivery assumptions.
              </p>
            </div>
            <div className="result-hero__total">
              <span>Estimated total</span>
              <strong>{formatSgd(recommended.totalCents)}</strong>
            </div>
          </div>
        ) : (
          <NoFeasiblePlanResult />
        )}
        <div className="results-grid">
          {comparison.options.map((option) => (
            <OptionSummary
              key={option.retailerId}
              option={option}
              highlighted={option.retailerId === recommended?.retailerId}
              productName={productName}
            />
          ))}
        </div>
        {recommended && (
          <>
            <div className="orders-section">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Purchase plan</p>
                  <h2>Complete order breakdown</h2>
                </div>
                <Link href="/basket" className="button button--outline button--small">
                  Edit basket
                </Link>
              </div>
              <OrderCard order={recommended} productName={productName} />
            </div>
            {notices.length > 0 && (
              <div className="notice-card notice-card--warning">
                <AlertCircle size={18} />
                <div>
                  <strong>Excluded-promotion notices</strong>
                  {notices.map((notice) => (
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
              {SNAPSHOT_DISCLAIMER} {DEPOSIT_NOTICE} Direct supermarket fulfilment only; third-party
              sellers excluded. Retailer payments do not influence recommendations.
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

function NoFeasiblePlanResult() {
  return (
    <div className="no-plan-card">
      <div className="no-plan-card__icon">
        <AlertCircle size={24} />
      </div>
      <div>
        <p className="eyebrow">Calculation status</p>
        <h2>No feasible purchasing plan available</h2>
        <p>
          No retailer can supply every line of this basket under the dataset’s stock and order
          rules. Each retailer’s reason is shown below; change the basket to compare again.
        </p>
        <Link href="/basket" className="text-link">
          Edit basket <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  );
}

function OptionSummary({
  option,
  highlighted,
  productName,
}: {
  option: Option;
  highlighted: boolean;
  productName: (productId: string) => string;
}) {
  const retailer = RETAILER_DISPLAY[option.retailerId];
  return (
    <div className={`plan-summary ${highlighted ? "plan-summary--highlighted" : ""}`}>
      <div className="plan-summary__head">
        <div>
          <p className="plan-summary__eyebrow">
            {highlighted
              ? "Recommended"
              : option.status === "complete"
                ? "Complete"
                : "Unavailable"}
          </p>
          <h3>{retailer.name}</h3>
          <span>Complete basket at one retailer</span>
        </div>
        {option.status === "complete" ? (
          <strong>{formatSgd(option.totalCents)}</strong>
        ) : (
          <strong className="muted">Unavailable</strong>
        )}
      </div>
      {option.status === "complete" ? (
        <PlanBreakdown order={option} />
      ) : (
        option.reasons.map((reason) => (
          <div className="plan-empty" key={reason.code}>
            <AlertCircle size={17} /> {reasonText(reason, productName)}
          </div>
        ))
      )}
    </div>
  );
}

function PlanBreakdown({ order }: { order: Order }) {
  return (
    <div className="plan-breakdown">
      <div>
        <span>Products</span>
        <strong>{formatSgd(orderSubtotalCents(order))}</strong>
      </div>
      <div>
        <span>Delivery</span>
        <strong>{formatSgd(order.deliveryCents)}</strong>
      </div>
      <div>
        <span>Mandatory</span>
        <strong>{formatSgd(orderChargesCents(order))}</strong>
      </div>
    </div>
  );
}

function OrderCard({
  order,
  productName,
}: {
  order: Order;
  productName: (productId: string) => string;
}) {
  const products = useProductIndex();
  const deliveryNotes = useDeliveryNotes();
  const retailer = RETAILER_DISPLAY[order.retailerId];
  return (
    <article className="order-card">
      <div className="order-card__head">
        <div>
          <p className="eyebrow">Retailer order</p>
          <h3>{retailer.name}</h3>
        </div>
        <div className="order-card__total">
          <span>Estimated order total</span>
          <strong>{formatSgd(order.totalCents)}</strong>
        </div>
      </div>
      <div className="order-card__lines">
        {order.lines.map((line) => (
          <div className="order-line" key={line.productId}>
            <div>
              <strong>
                {line.quantity} × {productName(line.productId)}
              </strong>
              <span>
                {products.get(line.productId)?.packSize} · {formatSgd(line.unitPriceCents)} / pack
              </span>
            </div>
            <strong>{formatSgd(line.lineTotalCents)}</strong>
            <button
              type="button"
              className="icon-button icon-button--subtle"
              onClick={() => openRetailerLink(line.productUrl)}
              aria-label={`Open ${productName(line.productId)} at ${retailer.name}`}
            >
              <ArrowRight size={16} />
            </button>
          </div>
        ))}
      </div>
      <div className="order-card__breakdown">
        <div>
          <span>Product subtotal</span>
          <strong>{formatSgd(orderSubtotalCents(order))}</strong>
        </div>
        <div>
          <span>
            Delivery fee <small>{deliveryNotes.get(order.retailerId)}</small>
          </span>
          <strong>{formatSgd(order.deliveryCents)}</strong>
        </div>
        <div>
          <span>
            Mandatory charges{" "}
            <small>
              {order.orderCharges.length
                ? order.orderCharges.map(orderChargeLabel).join(", ")
                : "No mandatory charge"}
            </small>
          </span>
          <strong>{formatSgd(orderChargesCents(order))}</strong>
        </div>
      </div>
      <p className="muted">
        CartOptix does not transfer carts. Rebuild this order on the retailer’s website.
      </p>
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
            <p>Search a fixed dataset. Brands, variants and pack sizes are never substituted.</p>
          </div>
          <div className="step">
            <span>02</span>
            <h3>Compare retailers</h3>
            <p>
              Price the complete basket at each retailer using whole packs and non-member pricing.
            </p>
          </div>
          <div className="step">
            <span>03</span>
            <h3>Read the plan</h3>
            <p>
              See product subtotals, delivery fees, mandatory charges and excluded-promotion notes.
            </p>
          </div>
        </div>
        <div className="transparency-grid">
          <div>
            <h3>What is included</h3>
            <p>
              Direct supermarket fulfilment, ordinary prices, clearly unconditional sale prices,
              delivery fees, free-delivery thresholds and minimum-order values.
            </p>
          </div>
          <div>
            <h3>What is not included</h3>
            <p>
              Live scraping, third-party sellers, multibuy and cross-product promotions, cart
              transfer, stock reservation, payment, delivery-slot selection or buying extra items
              just to unlock a discount.
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

export { AppShell, HowItWorks };

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

export default function App({ queryClient }: { queryClient?: QueryClient }) {
  const [client] = useState(() => queryClient ?? new QueryClient());
  return (
    <ErrorBoundary>
      <QueryClientProvider client={client}>
        <BasketProvider>
          <Toaster />
          <AppShell>
            <Router />
          </AppShell>
        </BasketProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
