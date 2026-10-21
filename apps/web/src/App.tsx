// Defines the top-level web application shell, routing, and shared providers.

import {
  MAX_BASKET_LINES,
  MAX_PACKS_PER_LINE,
  MIN_PACKS_PER_LINE,
  type Offer,
  type Product,
  type RetailerId,
  SNAPSHOT_DISCLAIMER,
} from "@cartoptix/contracts";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
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
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Link, Route, Switch, useLocation, useRoute } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import ComparisonRequestStatus from "./components/basket/ComparisonRequestStatus";
import ErrorBoundary from "./components/ErrorBoundary";
import type { BasketLine } from "./demo";
import {
  addBasketLine,
  removeBasketLine,
  setBasketLineQuantity,
} from "./features/basket/mutations";
import { persistBasket, restoreBasket } from "./features/basket/storage";
import { createApiSource } from "./features/basket-comparison/apiSource";
import { createFixtureSource, fixtureScenarios } from "./features/basket-comparison/fixtureSource";
import { comparisonFixtures, fixtureForBasket } from "./features/basket-comparison/fixtures";
import { buildKnownProductMap } from "./features/basket-comparison/knownProducts";
import { resolveSubmissionMetadata } from "./features/basket-comparison/metadata";
import type {
  BasketComparisonPresentation,
  ComparisonRequestState,
  ComparisonSource,
  ComparisonSubmission,
} from "./features/basket-comparison/model";
import { useComparison } from "./features/basket-comparison/useComparison";
import {
  ApiError,
  recordOutboundClick,
  useCatalogue,
  useOffers,
  useProductIndex,
  useProducts,
} from "./lib/api";
import { categoryVisual, formatSgd, RETAILER_DISPLAY, RETAILER_IDS } from "./lib/format";
import BasketComparisonPage from "./pages/BasketComparisonPage";
import Home from "./pages/Home";

const clampPacks = (quantity: number) =>
  Math.min(MAX_PACKS_PER_LINE, Math.max(MIN_PACKS_PER_LINE, Math.round(quantity)));

type BasketContextValue = {
  basket: BasketLine[];
  productMetadata: Map<string, Product>;
  basketRevision: number;
  fixtureScenario: string | null;
  persistenceFailed: boolean;
  leaveDemo: () => void;
  comparison: BasketComparisonPresentation | null;
  isStale: boolean;
  basketCount: number;
  addToBasket: (productId: string, quantity: number) => boolean;
  setQuantity: (productId: string, quantity: number) => void;
  removeFromBasket: (productId: string) => void;
  requestState: ComparisonRequestState;
  canCompare: boolean;
  runComparison: () => void;
  retryComparison: () => void;
  loadScenario: (lines: BasketLine[]) => void;
  loadComparisonScenario: (scenario: string) => void;
};

const BasketContext = createContext<BasketContextValue | null>(null);

function BasketProvider({ children, source }: { children: ReactNode; source: ComparisonSource }) {
  const [basket, setBasket] = useState<BasketLine[]>(restoreBasket);
  const [fixtureScenario, setFixtureScenario] = useState<string | null>(null);
  const basketBeforeDemo = useRef<BasketLine[] | null>(null);
  const [productMetadataRevision, setProductMetadataRevision] = useState(0);
  const products = useProductIndex();
  const queryClient = useQueryClient();
  // The revision invalidates this memo when metadata-only cache entries change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: This state is an intentional cache revision token.
  const productMetadata = useMemo(
    () => buildKnownProductMap(queryClient, products),
    [productMetadataRevision, queryClient, products],
  );
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== "updated" || event.action.type !== "success") return;
        if (!["comparison-product", "offers", "products"].includes(String(event.query.queryKey[0])))
          return;
        setProductMetadataRevision((revision) => revision + 1);
      }),
    [queryClient],
  );
  const prepareSubmission = useCallback(
    async (captured: ComparisonSubmission) => {
      const draft = structuredClone(captured);
      const knownProducts = buildKnownProductMap(queryClient, products);
      for (const line of draft.basket.products) {
        const cached = knownProducts.get(line.productId);
        if (cached) {
          if (!line.name?.trim()) line.name = cached.name;
          if (!line.packDescription?.trim()) line.packDescription = cached.packSize;
        }
      }
      return resolveSubmissionMetadata(draft, (product) => {
        // Retain verified metadata for this browser session, including products outside page one.
        queryClient.setQueryDefaults(["comparison-product"], { gcTime: Infinity });
        queryClient.setQueryData(["comparison-product", product.productId], product);
      });
    },
    [products, queryClient],
  );
  const { result: comparison, request: requestState, submit, retry } = useComparison(source);
  const [location, navigate] = useLocation();
  const currentLocation = useRef(location);
  const departures = useRef(0);
  useLayoutEffect(() => {
    currentLocation.current = location;
    if (location !== "/basket" && location !== "/results") departures.current += 1;
  }, [location]);
  const successNavigation = useCallback(() => {
    const submittedBeforeDeparture = departures.current;
    return () => {
      // Leaving the comparison flow revokes automatic navigation for this attempt,
      // even if the shopper returns before it completes. The result is still stored.
      if (
        departures.current === submittedBeforeDeparture &&
        currentLocation.current === "/basket"
      ) {
        navigate("/results");
      }
    };
  }, [navigate]);
  const [basketRevision, setBasketRevision] = useState(0);
  const [persistenceFailed, setPersistenceFailed] = useState(false);

  const changed = useCallback(
    (next: BasketLine[], shouldPersist = true, force = false) => {
      const basketChanged =
        next.length !== basket.length ||
        next.some(
          (line, index) =>
            line.productId !== basket[index]?.productId ||
            line.quantity !== basket[index]?.quantity,
        );
      if (!basketChanged && !force) return;
      setBasket(next);
      if (shouldPersist) {
        const saved = persistBasket(next);
        setPersistenceFailed(!saved);
        if (!saved && !persistenceFailed)
          toast.warning("Basket changes may not survive a reload", {
            description: "Session storage is unavailable. Keep this tab open to retain your edits.",
          });
      }
      setBasketRevision((revision) => revision + 1);
    },
    [basket, persistenceFailed],
  );
  const isStale = Boolean(
    comparison &&
      (comparison.submittedBasket.revision !== basketRevision ||
        (comparison.submittedScenario ?? null) !== fixtureScenario),
  );

  const value = useMemo<BasketContextValue>(
    () => ({
      basket,
      productMetadata,
      basketRevision,
      fixtureScenario,
      persistenceFailed,
      comparison,
      isStale,
      requestState,
      canCompare:
        fixtureScenario !== null
          ? Boolean(
              fixtureForBasket(
                fixtureScenarios[fixtureScenario]?.fixture ?? "",
                basket,
                basketRevision,
              ),
            )
          : basket.length > 0 && basket.length <= MAX_BASKET_LINES,
      runComparison: () => {
        if (fixtureScenario !== null) {
          const fixture = fixtureForBasket(
            fixtureScenarios[fixtureScenario]?.fixture ?? "",
            basket,
            basketRevision,
          );
          if (fixture)
            submit(
              { scenario: fixtureScenario, basket: fixture.submittedBasket },
              successNavigation(),
            );
          return;
        }
        if (!basket.length) return;
        // Freeze available catalogue pages and product details before resolving any missing metadata.
        const known = new Map<string, Pick<Product, "name" | "packSize">>();
        // Metadata already resolved for an earlier API attempt is still usable for the same IDs.
        if (requestState.phase !== "idle" && !requestState.submitted.scenario)
          for (const product of requestState.submitted.basket.products)
            if (product.name && product.packDescription)
              known.set(product.productId, {
                name: product.name,
                packSize: product.packDescription,
              });
        for (const [id, product] of buildKnownProductMap(queryClient, products))
          known.set(id, product);
        submit(
          {
            basket: {
              revision: basketRevision,
              products: basket.map((line) => ({
                ...line,
                name: known.get(line.productId)?.name ?? "",
                packDescription: known.get(line.productId)?.packSize ?? "",
              })),
            },
          },
          successNavigation(),
          false,
          prepareSubmission,
        );
      },
      leaveDemo: () => {
        basketBeforeDemo.current = null;
        setFixtureScenario(null);
        changed([]);
      },
      retryComparison: () => retry(successNavigation()),
      basketCount: basket.reduce((total, line) => total + line.quantity, 0),
      addToBasket: (productId, quantity) => {
        const sourceBasket =
          fixtureScenario === null ? basket : (basketBeforeDemo.current ?? restoreBasket());
        const mutation = addBasketLine(sourceBasket, productId, quantity);
        if (mutation.error) {
          if (mutation.error === "line-limit") {
            toast.error("Basket limit reached", {
              description: `Remove a product from your basket before adding another. The limit is ${MAX_BASKET_LINES} distinct products.`,
            });
          } else if (mutation.error === "pack-limit") {
            toast.error("Pack limit reached", {
              description: `This would exceed ${MAX_PACKS_PER_LINE} packs for this product. Reduce the selected quantity or edit the existing basket line.`,
            });
          } else {
            toast.error("Invalid quantity", {
              description: `Choose a whole-pack quantity from ${MIN_PACKS_PER_LINE} to ${MAX_PACKS_PER_LINE}.`,
            });
          }
          return false;
        }
        if (mutation.changed) {
          const leavingDemo = fixtureScenario !== null;
          if (leavingDemo) {
            basketBeforeDemo.current = null;
            setFixtureScenario(null);
            toast.info("Demo ended. Your saved basket is ready to edit.");
          }
          changed(mutation.basket, true, leavingDemo);
        }
        return mutation.changed;
      },
      setQuantity: (productId, quantity) => {
        const mutation = setBasketLineQuantity(basket, productId, quantity);
        if (mutation.error) {
          toast.error("Quantity not changed", {
            description: `Choose a whole-pack quantity from ${MIN_PACKS_PER_LINE} to ${MAX_PACKS_PER_LINE}.`,
          });
        } else if (mutation.changed) changed(mutation.basket, fixtureScenario === null);
      },
      removeFromBasket: (productId) => {
        const mutation = removeBasketLine(basket, productId);
        if (mutation.changed) changed(mutation.basket, fixtureScenario === null);
      },
      // Homepage baskets use the normal API source.
      loadScenario: (lines) => {
        basketBeforeDemo.current = null;
        changed(lines);
        setFixtureScenario(null);
      },
      loadComparisonScenario: (scenario) => {
        const fixture = comparisonFixtures[fixtureScenarios[scenario]?.fixture ?? ""];
        if (!fixture) return;
        if (fixtureScenario === null) basketBeforeDemo.current = basket;
        changed(
          fixture.submittedBasket.products.map(({ productId, quantity }) => ({
            productId,
            quantity,
          })),
          false,
        );
        setFixtureScenario(scenario);
      },
    }),
    [
      basket,
      fixtureScenario,
      persistenceFailed,
      comparison,
      basketRevision,
      isStale,
      requestState,
      submit,
      retry,
      successNavigation,
      changed,
      productMetadata,
      prepareSubmission,
      queryClient,
      products,
    ],
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
          {!product.available && <p className="product-card__unavailable">Unavailable</p>}
        </div>
      </Link>
      <div className="product-card__actions">
        <button
          type="button"
          className="button button--small button--outline"
          disabled={!product.available}
          onClick={() => {
            if (addToBasket(product.productId, 1))
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
  const pageSize = 100;
  const [pageInput, setPageInput] = useState(String(page));
  useEffect(() => setPageInput(String(page)), [page]);
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
  const { data, isLoading, isError, isPlaceholderData } = useProducts(query);
  const products = data?.products ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);
  const jumpToPage = () => {
    if (isPlaceholderData) return;
    const nextPage = Math.min(totalPages, Math.max(1, Number.parseInt(pageInput, 10) || 1));
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
            <strong>{total}</strong> products found
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
        ) : products.length || total > 0 ? (
          <>
            <div
              className={isPlaceholderData ? "product-grid product-grid--pending" : "product-grid"}
              aria-busy={isPlaceholderData}
              inert={isPlaceholderData}
            >
              {products.map((product) => (
                <ProductCard
                  key={product.productId}
                  product={product}
                  categoryName={categoryNames.get(product.categoryId) ?? ""}
                />
              ))}
            </div>
            <nav className="catalogue-pagination" aria-label="Catalogue pages">
              <button
                type="button"
                className="button button--outline"
                disabled={page === 1 || isPlaceholderData}
                onClick={() => {
                  setPage((current) => current - 1);
                }}
              >
                Previous
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="button button--outline"
                disabled={page >= totalPages || isPlaceholderData}
                onClick={() => {
                  setPage((current) => current + 1);
                }}
              >
                Next
              </button>
              <label className="page-jump-control">
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
                <button
                  type="button"
                  className="button button--outline"
                  disabled={isPlaceholderData}
                  onClick={jumpToPage}
                >
                  Go
                </button>
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
            <Sparkles size={15} /> Exact product identity · fixed dataset
          </div>
        </div>
        <div className="product-detail__content">
          <p className="eyebrow">{categoryName}</p>
          <h1>{product.name}</h1>
          {!product.available && (
            <p className="notice-card notice-card--warning">
              Unavailable: no eligible retailer listing.
            </p>
          )}
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
            <span>Quantity (whole packs)</span>
            <button
              type="button"
              aria-label="Decrease quantity"
              disabled={quantity <= MIN_PACKS_PER_LINE}
              onClick={() => setQuantity(clampPacks(quantity - 1))}
            >
              −
            </button>
            <strong aria-live="polite">{quantity}</strong>
            <button
              type="button"
              aria-label="Increase quantity"
              disabled={quantity >= MAX_PACKS_PER_LINE}
              onClick={() => setQuantity(clampPacks(quantity + 1))}
            >
              +
            </button>
            <em>packs</em>
          </div>
          <div className="offer-list">
            <div className="offer-list__head">
              <span>Retailer offer</span>
              <span>Product cost</span>
            </div>
            <p className="offer-list__caption">
              For {quantity} {quantity === 1 ? "pack" : "packs"}; before delivery and order charges.
            </p>
            {offers.map((offer) => (
              <OfferRow key={offer.retailerId} offer={offer} quantity={quantity} />
            ))}
            {missingRetailers.map((retailerId) => (
              <UnavailableOfferRow key={retailerId} retailerId={retailerId} />
            ))}
          </div>
          <div className="detail-actions">
            <button
              type="button"
              className="button button--primary"
              disabled={!product.available}
              onClick={() => {
                if (!addToBasket(product.productId, quantity)) return;
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

function OfferRow({ offer, quantity }: { offer: Offer; quantity: number }) {
  const retailer = RETAILER_DISPLAY[offer.retailerId];
  return (
    <div className="offer-row">
      <div className="offer-row__retailer">
        <span className="retailer-dot" style={{ background: retailer.accent }} />{" "}
        <div>
          <strong>{retailer.name}</strong>
          <span>
            {formatSgd(offer.unitPriceCents)} per pack ·{" "}
            {offer.priceKind === "unconditional_sale"
              ? "Unconditional sale price"
              : "Regular price"}
          </span>
          {offer.excludedPromotions.map((promotion) => (
            <span className="offer-row__promotion" key={promotion}>
              Excluded promotion: {promotion}
            </span>
          ))}
        </div>
      </div>
      <div className="offer-row__price">
        <strong>{formatSgd(offer.lineTotalCents)}</strong>
        <span>
          for {quantity} {quantity === 1 ? "pack" : "packs"}
        </span>
      </div>
      <a
        href={offer.productUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="icon-button"
        aria-label={`View ${retailer.name} product page`}
        onClick={() => recordOutboundClick(offer.listingId)}
      >
        <ArrowRight size={18} />
      </a>
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
    basketRevision,
    fixtureScenario,
    persistenceFailed,
    productMetadata,
    comparison,
    isStale,
    setQuantity,
    removeFromBasket,
    requestState,
    canCompare,
    runComparison,
    retryComparison,
    loadComparisonScenario,
    leaveDemo,
  } = useBasket();

  const categoryNames = useCategoryNames();
  const totalPacks = basket.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <main>
      <PageIntro
        eyebrow="Your basket"
        title="Compare the basket, not partial items."
        description="Compare the complete basket independently at each retailer using prototype data."
      >
        <div className="data-pill">
          <ShoppingBasket size={14} /> {basket.length} distinct lines · {totalPacks} whole packs
        </div>
      </PageIntro>
      <section className="container basket-layout">
        <div className="basket-main">
          <ComparisonRequestStatus
            request={requestState}
            currentRevision={basketRevision}
            onRetry={retryComparison}
            showBackToBasket={false}
          />
          {persistenceFailed && (
            <div className="stale-banner" role="status">
              <AlertCircle size={18} />
              <div>
                <strong>Basket changes may not survive a reload.</strong>
                <span>
                  Session storage is unavailable. Keep this tab open to retain your edits.
                </span>
              </div>
            </div>
          )}
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
                const fixtureProduct =
                  fixtureScenario === null
                    ? undefined
                    : comparisonFixtures[
                        fixtureScenarios[fixtureScenario ?? ""]?.fixture ?? ""
                      ]?.submittedBasket.products.find(
                        (product) => product.productId === line.productId,
                      );
                const product = fixtureProduct
                  ? {
                      productId: fixtureProduct.productId,
                      name: fixtureProduct.name,
                      packSize: fixtureProduct.packDescription,
                      categoryId: "synthetic",
                      imageUrl: null,
                      available: true,
                    }
                  : productMetadata.get(line.productId);
                if (!product)
                  return (
                    <div className="basket-row" key={line.productId}>
                      <div className="basket-row__identity">
                        <strong>Product details unavailable</strong>
                        <span>Product ID: {line.productId}</span>
                        <span>{line.quantity} packs</span>
                      </div>
                      <div className="quantity-control">
                        <button
                          type="button"
                          aria-label={`Decrease ${line.productId}`}
                          disabled={line.quantity <= MIN_PACKS_PER_LINE}
                          onClick={() => setQuantity(line.productId, line.quantity - 1)}
                        >
                          -
                        </button>
                        <strong>{line.quantity}</strong>
                        <button
                          type="button"
                          aria-label={`Increase ${line.productId}`}
                          disabled={line.quantity >= MAX_PACKS_PER_LINE}
                          onClick={() => setQuantity(line.productId, line.quantity + 1)}
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove ${line.productId}`}
                        onClick={() => removeFromBasket(line.productId)}
                      >
                        <X size={16} />
                      </button>
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
              {Object.entries(fixtureScenarios).map(([key, scenario]) => (
                <button
                  type="button"
                  key={key}
                  className="demo-button"
                  onClick={() => {
                    loadComparisonScenario(key);
                    toast.success("Demo scenario loaded", { description: scenario.label });
                  }}
                >
                  <strong>{scenario.label}</strong>
                  <span>Synthetic data — not retailer prices</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <aside className="basket-sidebar">
          <div className="basket-summary-card">
            <p className="eyebrow">Comparison setup</p>
            <h2>Complete retailer baskets</h2>
            <p className="muted">
              {fixtureScenario === null
                ? "API comparison mode. Compare your basket using the curated retailer dataset."
                : "Demo mode. Only the exact selected demonstration basket can be compared."}
            </p>
            {fixtureScenario !== null && (
              <button type="button" className="button button--outline" onClick={leaveDemo}>
                Leave demo and start a new basket
              </button>
            )}
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
              disabled={!basket.length || !canCompare || requestState.phase === "pending"}
              onClick={runComparison}
            >
              {requestState.phase === "pending" ? "Comparing..." : "Compare basket"}{" "}
              <ArrowRight size={17} />
            </button>
            {comparison && (
              <Link className="button button--text button--full" href="/results">
                {isStale || requestState.phase !== "success"
                  ? "View previous results"
                  : "View current results"}
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
  // Product details URL for real catalogue products.
  // Synthetic demo products do not have catalogue detail pages.
  const productHref = product.categoryId === "synthetic" ? null : `/product/${product.productId}`;

  return (
    <div className="basket-row">
      {productHref ? (
        <Link
          href={productHref}
          className="basket-row__image-link"
          aria-label={`View details for ${product.name}`}
        >
          <ProductImage product={product} className="product-image--basket" />
        </Link>
      ) : (
        <ProductImage product={product} className="product-image--basket" />
      )}

      <div className="basket-row__identity">
        {productHref ? (
          <Link href={productHref} className="basket-row__product-link">
            <strong>{product.name}</strong>
          </Link>
        ) : (
          <strong>{product.name}</strong>
        )}
        <span>{product.packSize}</span>
        <span>{categoryName}</span>
      </div>
      <div className="quantity-control quantity-control--compact">
        <button
          type="button"
          aria-label={`Decrease ${product.name}`}
          disabled={line.quantity <= MIN_PACKS_PER_LINE}
          onClick={() => onChange(line.quantity - 1)}
        >
          −
        </button>
        <strong>{line.quantity}</strong>
        <button
          type="button"
          aria-label={`Increase ${product.name}`}
          disabled={line.quantity >= MAX_PACKS_PER_LINE}
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

export function ResultsPage() {
  const { comparison, isStale, requestState, basketRevision, retryComparison } = useBasket();
  return (
    <BasketComparisonPage
      result={comparison}
      isStale={isStale}
      request={requestState}
      currentRevision={basketRevision}
      onRetry={retryComparison}
    />
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

export default function App({
  queryClient,
  comparisonSource,
}: {
  queryClient?: QueryClient;
  comparisonSource?: ComparisonSource;
}) {
  const [client] = useState(() => queryClient ?? new QueryClient());
  const [source] = useState(() => {
    if (comparisonSource) return comparisonSource;
    const api = createApiSource();
    const demo = createFixtureSource();
    const selected: ComparisonSource = (submission) =>
      submission.scenario ? demo(submission) : api(submission);
    return selected;
  });
  return (
    <ErrorBoundary>
      <QueryClientProvider client={client}>
        <BasketProvider source={source}>
          <Toaster />
          <AppShell>
            <Router />
          </AppShell>
        </BasketProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
