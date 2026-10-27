// Defines the top-level web application shell, routing, and shared providers.

import {
  MAX_BASKET_LINES,
  MAX_PACKS_PER_LINE,
  MIN_PACKS_PER_LINE,
  type Offer,
  type Product,
  type RetailerId,
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
  Search,
  ShoppingBasket,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  type CSSProperties,
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
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Link, Redirect, Route, Switch, useLocation, useRoute } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import ComparisonRequestStatus from "./components/basket/ComparisonRequestStatus";
import ErrorBoundary from "./components/ErrorBoundary";
import WasPrice from "./components/WasPrice";
import type { BasketLine } from "./features/basket/model";
import {
  addBasketLine,
  removeBasketLine,
  setBasketLineQuantity,
} from "./features/basket/mutations";
import {
  BASKET_STORAGE_KEY,
  persistBasket,
  restoreBasket,
  restoreBasketSnapshot,
} from "./features/basket/storage";
import { createApiSource } from "./features/basket-comparison/apiSource";
import { buildKnownProductMap } from "./features/basket-comparison/knownProducts";
import { resolveSubmissionMetadata } from "./features/basket-comparison/metadata";
import type {
  BasketComparisonPresentation,
  ComparisonRequestState,
  ComparisonSource,
  ComparisonSubmission,
} from "./features/basket-comparison/model";
import { useComparison } from "./features/basket-comparison/useComparison";
import { validateRecommendation } from "./features/basket-comparison/validation";
import {
  ApiError,
  recordOutboundClick,
  useCatalogue,
  useOffers,
  useProductIndex,
  useProducts,
} from "./lib/api";
import {
  categoryVisual,
  excludedPromotionNote,
  formatSgd,
  multibuyNotes,
  RETAILER_DISPLAY,
  RETAILER_IDS,
} from "./lib/format";
import BasketComparisonPage from "./pages/BasketComparisonPage";

const clampPacks = (quantity: number) =>
  Math.min(MAX_PACKS_PER_LINE, Math.max(MIN_PACKS_PER_LINE, Math.round(quantity)));
const CATALOGUE_BACKDROP_TILE_COUNT = 50;
const CATALOGUE_BACKDROP_GROUP_KEYS = [
  "primary",
  "copy-1",
  "copy-2",
  "copy-3",
  "copy-4",
  "copy-5",
] as const;

function createCatalogueBackdropSequence(products: Product[]) {
  if (products.length <= 1) return products.map((product, slot) => ({ product, slot }));

  const sequence: { product: Product; slot: number }[] = [];
  for (let slot = 0; slot < CATALOGUE_BACKDROP_TILE_COUNT; slot += 1) {
    const product = products[slot % products.length];
    if (product) sequence.push({ product, slot });
  }
  return sequence;
}

type BasketContextValue = {
  basket: BasketLine[];
  productMetadata: Map<string, Product>;
  basketRevision: number;
  persistenceFailed: boolean;
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
};

const BasketContext = createContext<BasketContextValue | null>(null);
const TutorialRequestContext = createContext<{
  requestId: number;
  requestPath: string;
  requestTutorial: (path: string) => void;
  consumeTutorialRequest: (requestId: number) => boolean;
} | null>(null);
const NavigationContext = createContext<{
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
} | null>(null);

function BasketProvider({ children, source }: { children: ReactNode; source: ComparisonSource }) {
  const [basket, setBasket] = useState<BasketLine[]>(restoreBasket);
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

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== BASKET_STORAGE_KEY && event.key !== null) return;
      // Access may throw when browser storage is blocked.
      try {
        if (event.storageArea !== window.localStorage) return;
      } catch {
        return;
      }
      const next = restoreBasketSnapshot(event.newValue);
      if (JSON.stringify(next) === JSON.stringify(basket)) return;
      setBasket(next);
      setBasketRevision((revision) => revision + 1);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [basket]);

  const changed = useCallback(
    (next: BasketLine[]) => {
      const basketChanged =
        next.length !== basket.length ||
        next.some(
          (line, index) =>
            line.productId !== basket[index]?.productId ||
            line.quantity !== basket[index]?.quantity,
        );
      if (!basketChanged) return;
      setBasket(next);
      const saved = persistBasket(next);
      setPersistenceFailed(!saved);
      if (!saved && !persistenceFailed)
        toast.warning("Basket changes may not survive a reload", {
          description: "Browser storage is unavailable. Keep this tab open to retain your edits.",
        });
      setBasketRevision((revision) => revision + 1);
    },
    [basket, persistenceFailed],
  );
  const isStale = Boolean(comparison && comparison.submittedBasket.revision !== basketRevision);

  const value = useMemo<BasketContextValue>(
    () => ({
      basket,
      productMetadata,
      basketRevision,
      persistenceFailed,
      comparison,
      isStale,
      requestState,
      canCompare: basket.length > 0 && basket.length <= MAX_BASKET_LINES,
      runComparison: () => {
        if (!basket.length) return;
        // Freeze available catalogue pages and product details before resolving any missing metadata.
        const known = new Map<
          string,
          Pick<Product, "name" | "packSize"> & { imageUrl?: string | null }
        >();
        // Metadata already resolved for an earlier API attempt is still usable for the same IDs.
        if (requestState.phase !== "idle")
          for (const product of requestState.submitted.basket.products)
            if (product.name && product.packDescription)
              known.set(product.productId, {
                name: product.name,
                packSize: product.packDescription,
                imageUrl: product.imageUrl,
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
                imageUrl: known.get(line.productId)?.imageUrl ?? null,
              })),
            },
          },
          successNavigation(),
          false,
          prepareSubmission,
        );
      },
      retryComparison: () => retry(successNavigation()),
      basketCount: basket.reduce((total, line) => total + line.quantity, 0),
      addToBasket: (productId, quantity) => {
        const mutation = addBasketLine(basket, productId, quantity);
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
        if (mutation.changed) changed(mutation.basket);
        return mutation.changed;
      },
      setQuantity: (productId, quantity) => {
        const mutation = setBasketLineQuantity(basket, productId, quantity);
        if (mutation.error) {
          toast.error("Quantity not changed", {
            description: `Choose a whole-pack quantity from ${MIN_PACKS_PER_LINE} to ${MAX_PACKS_PER_LINE}.`,
          });
        } else if (mutation.changed) changed(mutation.basket);
      },
      removeFromBasket: (productId) => {
        const mutation = removeBasketLine(basket, productId);
        if (mutation.changed) changed(mutation.basket);
      },
    }),
    [
      basket,
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
  const [location, navigate] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const tutorialRequest = useContext(TutorialRequestContext);
  const navigationValue = useMemo(() => ({ menuOpen, setMenuOpen }), [menuOpen]);
  return (
    <NavigationContext.Provider value={navigationValue}>
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
              <button
                id="how-it-works"
                type="button"
                className="nav-how-it-works"
                onClick={() => {
                  setMenuOpen(true);
                  const tutorialPath =
                    location === "/basket" || location === "/results"
                      ? location
                      : location.startsWith("/product/")
                        ? location
                        : "/catalogue";
                  if (tutorialPath === "/catalogue") navigate("/catalogue");
                  tutorialRequest?.requestTutorial(tutorialPath);
                }}
              >
                <CircleHelp size={16} /> How it works
              </button>
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
          </div>
        </footer>
      </div>
    </NavigationContext.Provider>
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

const TUTORIAL_STORAGE_KEY = "cartoptix:tutorial:completed:v1";
type TutorialStep = {
  selector: string | null;
  title: string;
  description: string;
};

const WELCOME_TUTORIAL_STEP = {
  selector: null,
  title: "Welcome to CartOptix",
  description:
    "CartOptix helps you compare the cost of your complete grocery basket across Singapore supermarkets, using exact products and clear retailer offers.",
} as const;
const TUTORIAL_STEPS = [
  WELCOME_TUTORIAL_STEP,
  {
    selector: "#catalogue-search",
    title: "Search the catalogue",
    description:
      "Search by product name, brand or pack size to find the exact groceries you want to compare.",
  },
  {
    selector: "#catalogue-products .product-card",
    title: "Explore products",
    description:
      "Browse the matching products here. After finishing the guide, select a product to compare retailer offers or add it to your basket.",
  },
  {
    selector: "#catalogue-filters",
    title: "Narrow your search",
    description:
      "Choose a category to filter the catalogue. You can combine a category with your search.",
  },
  {
    selector: "#how-it-works",
    title: "Replay this guide any time",
    description: "If you need a refresher, select How it works to start this guide again.",
  },
] as const;
const BASKET_ITEMS_STEP: TutorialStep = {
  selector: ".basket-card .basket-row",
  title: "Review your basket items",
  description:
    "Your selected products and pack counts appear here. Adjust quantities or remove items before comparing.",
};
const COMPARE_BASKET_STEP: TutorialStep = {
  selector: "#compare-basket",
  title: "Compare your basket",
  description:
    "Compare basket checks the cost and availability of your complete basket at RedMart, FairPrice and Cold Storage.",
};
const BASKET_TUTORIAL_STEPS: readonly TutorialStep[] = [BASKET_ITEMS_STEP, COMPARE_BASKET_STEP];
const EMPTY_BASKET_TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    selector: ".basket-empty a[href='/catalogue']",
    title: "Add products to your basket",
    description:
      "Your basket is empty. Select Browse products to find groceries and add them to your basket before comparing.",
  },
  COMPARE_BASKET_STEP,
];
const PRODUCT_QUANTITY_STEP: TutorialStep = {
  selector: "#product-quantity",
  title: "Choose how many packs you need",
  description:
    "Use the minus and plus buttons to set the number of whole packs. Prices and multibuy offers update for that quantity.",
};
const PRODUCT_RETAILER_OFFERS_STEP: TutorialStep = {
  selector: "#product-offers",
  title: "Compare the three retailers",
  description:
    "RedMart, FairPrice, and Cold Storage are listed here. Review each available offer, sale or multibuy note, and product cost; delivery and order charges are not included.",
};
const PRODUCT_RETAILER_LINKS_STEP: TutorialStep = {
  selector: ".offer-row:not(.offer-row--muted) a.icon-button",
  title: "Open a retailer product page",
  description:
    "The green arrow beside an available retailer opens that product's page on the retailer's website in a new tab.",
};
const PRODUCT_ADD_TO_BASKET_STEP: TutorialStep = {
  selector: "#add-to-basket",
  title: "Add these packs to your basket",
  description:
    "Add the selected number of packs to your CartOptix basket. You can change the quantity above before adding it.",
};
const PRODUCT_VIEW_BASKET_STEP: TutorialStep = {
  selector: "#view-basket",
  title: "View your basket",
  description:
    "Open your basket here to review the products you have added and compare the complete basket across retailers.",
};

function productTutorialSteps(hasOffers: boolean): readonly TutorialStep[] {
  return [
    PRODUCT_QUANTITY_STEP,
    {
      ...PRODUCT_RETAILER_OFFERS_STEP,
      description: hasOffers
        ? PRODUCT_RETAILER_OFFERS_STEP.description
        : "RedMart, FairPrice, and Cold Storage are listed here. None has an eligible offer for this product right now.",
    },
    ...(hasOffers ? [PRODUCT_RETAILER_LINKS_STEP] : []),
    PRODUCT_ADD_TO_BASKET_STEP,
    PRODUCT_VIEW_BASKET_STEP,
  ];
}

const RESULTS_INTRO_STEP: TutorialStep = {
  selector: null,
  title: "What to do next",
  description:
    "Review the estimated prices, then visit a retailer to confirm the exact product and current availability. CartOptix does not transfer your basket or place an order. Use Edit basket to make changes and compare again.",
};
const RESULTS_RETAILERS_STEP: TutorialStep = {
  selector: "#results-retailer-row",
  title: "Compare the three retailers",
  description:
    "These columns show RedMart, FairPrice, and Cold Storage. Compare each retailer's estimated basket total and availability; unavailable items and partial estimates are labelled.",
};
const RESULTS_INCOMPLETE_STEP: TutorialStep = {
  selector: "#results-retailer-row .matrix__retailer--muted",
  title: "Some retailer baskets are incomplete",
  description:
    "This retailer cannot price your complete basket. The reason is shown in its top-row column; any partial estimate only covers the items it can supply and is not a complete basket total.",
};
const RESULTS_FIRST_PRODUCT_STEP: TutorialStep = {
  selector: "#results-first-product",
  title: "Your first selected product",
  description:
    "This row is the first exact product in your basket, including its pack size and quantity. Each retailer column shows its amount for this item or says when it is unavailable.",
};
const RESULTS_VIEW_STEP: TutorialStep = {
  selector: "#results-first-product .text-link",
  title: "Confirm the product with a retailer",
  description:
    "View opens the retailer's product page in a new tab. Check the product and current details there before rebuilding your basket and checking out on the retailer's website.",
};
const RESULTS_PRICE_BREAKDOWN_STEP: TutorialStep = {
  selector: "#results-price-breakdown",
  title: "Understand the price breakdown",
  description:
    "Product subtotal covers the items. Delivery and any service fee or other mandatory charge are listed separately. Estimated total adds these costs together for that retailer; partial estimates are labelled.",
};
const RESULTS_SIGN_IN_STEP: TutorialStep = {
  selector: "#results-signin-row",
  title: "Sign in on the retailer's website",
  description:
    "Use the sign-in links for each retailer to open its account page. Rebuild your basket and check out there; CartOptix cannot transfer basket contents or place an order.",
};
const RESULTS_EDIT_STEP: TutorialStep = {
  selector: "#results-edit-basket",
  title: "Edit your basket",
  description:
    "Return to your basket to add or remove products, change pack quantities, and run a fresh comparison.",
};
const RESULTS_EMPTY_BASKET_STEP: TutorialStep = {
  selector: "#results-empty-basket",
  title: "Go to your basket",
  description:
    "There is no comparison to review yet. Open your basket, add products, then compare it to see retailer prices.",
};

function resultsTutorialSteps(
  result: BasketComparisonPresentation | null,
  hasPurchaseLinks: boolean,
  hasSignInRows: boolean,
): readonly TutorialStep[] {
  if (!result) return [RESULTS_INTRO_STEP, RESULTS_EMPTY_BASKET_STEP];
  if (validateRecommendation(result).kind === "invalid")
    return [RESULTS_INTRO_STEP, RESULTS_EDIT_STEP];
  return [
    RESULTS_INTRO_STEP,
    RESULTS_RETAILERS_STEP,
    ...(result.options.some((option) => option.kind === "unavailable")
      ? [RESULTS_INCOMPLETE_STEP]
      : []),
    RESULTS_FIRST_PRODUCT_STEP,
    ...(hasPurchaseLinks ? [RESULTS_VIEW_STEP] : []),
    RESULTS_PRICE_BREAKDOWN_STEP,
    ...(hasSignInRows ? [RESULTS_SIGN_IN_STEP] : []),
    RESULTS_EDIT_STEP,
  ];
}

function TutorialGuide({
  open,
  stepIndex,
  onStepChange,
  onFinish,
  menuOpen,
  steps = TUTORIAL_STEPS,
}: {
  open: boolean;
  stepIndex: number;
  onStepChange: (step: number) => void;
  onFinish: () => void;
  menuOpen: boolean;
  steps?: readonly TutorialStep[];
}) {
  const step = steps[stepIndex] ?? WELCOME_TUTORIAL_STEP;
  const [spotlight, setSpotlight] = useState<DOMRect | null>(null);
  const [dialogTop, setDialogTop] = useState<number | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      setSpotlight(null);
      setDialogTop(null);
      return;
    }
    const target = step.selector
      ? (document.querySelector(step.selector) ??
        (step.selector === "#catalogue-products .product-card"
          ? document.querySelector(".catalogue-summary")
          : null))
      : null;
    if (step.selector === "#how-it-works" && window.innerWidth <= 720 && !menuOpen) {
      setSpotlight(null);
      setDialogTop(null);
      return;
    }
    if (!target) {
      setSpotlight(null);
      setDialogTop(null);
    } else {
      target.scrollIntoView?.({ block: "center", behavior: "smooth" });
      const updatePosition = () => {
        const targetRect = target.getBoundingClientRect();
        const dialogRect = dialogRef.current?.getBoundingClientRect();
        const dialogHeight = dialogRect?.height ?? 220;
        const dialogWidth = dialogRect?.width ?? Math.min(440, window.innerWidth - 32);
        const viewportPadding = 16;
        const centerTop = Math.max(viewportPadding, (window.innerHeight - dialogHeight) / 2);
        const centerLeft = (window.innerWidth - dialogWidth) / 2;
        const horizontalOverlap =
          centerLeft < targetRect.right && targetRect.left < centerLeft + dialogWidth;
        let nextTop = centerTop;

        if (
          horizontalOverlap &&
          centerTop < targetRect.bottom &&
          targetRect.top < centerTop + dialogHeight
        ) {
          const above = targetRect.top - dialogHeight - 20;
          const below = targetRect.bottom + 20;
          const fitsAbove = above >= viewportPadding;
          const fitsBelow = below + dialogHeight <= window.innerHeight - viewportPadding;
          if (fitsAbove && fitsBelow)
            nextTop = Math.abs(above - centerTop) <= Math.abs(below - centerTop) ? above : below;
          else if (fitsAbove) nextTop = above;
          else if (fitsBelow) nextTop = below;
          else
            nextTop = Math.max(
              viewportPadding,
              window.innerHeight - dialogHeight - viewportPadding,
            );
        }

        setSpotlight(targetRect);
        setDialogTop(nextTop);
      };
      updatePosition();
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);
      return () => {
        window.removeEventListener("resize", updatePosition);
        window.removeEventListener("scroll", updatePosition, true);
      };
    }
  }, [open, step.selector, menuOpen]);

  useEffect(() => {
    if (!open) return;
    nextButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const buttons = Array.from(
        dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      );
      const firstButton = buttons[0];
      const lastButton = buttons.at(-1);
      if (!firstButton || !lastButton) {
        event.preventDefault();
        return;
      }
      const focusIsInsideDialog = dialog.contains(document.activeElement);
      if (event.shiftKey && (!focusIsInsideDialog || document.activeElement === firstButton)) {
        event.preventDefault();
        lastButton.focus();
      } else if (
        !event.shiftKey &&
        (!focusIsInsideDialog || document.activeElement === lastButton)
      ) {
        event.preventDefault();
        firstButton.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  if (!open) return null;
  return createPortal(
    <>
      <div className="tutorial-backdrop" aria-hidden="true" data-testid="tutorial-backdrop" />
      {spotlight && (
        <div
          className="tutorial-spotlight"
          aria-hidden="true"
          style={{
            top: spotlight.top - 8,
            left: spotlight.left - 8,
            width: spotlight.width + 16,
            height: spotlight.height + 16,
          }}
        />
      )}
      <section
        ref={dialogRef}
        className="tutorial-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
        aria-describedby="tutorial-description"
        style={dialogTop === null ? undefined : { top: dialogTop }}
        data-positioned={dialogTop !== null}
      >
        <div className="tutorial-dialog__topline">
          <span>CartOptix quick guide</span>
          <span>
            {stepIndex + 1} of {steps.length}
          </span>
        </div>
        <h2 id="tutorial-title">{step.title}</h2>
        <p id="tutorial-description">{step.description}</p>
        <div className="tutorial-dialog__actions">
          <button type="button" className="tutorial-skip" onClick={onFinish}>
            Skip guide
          </button>
          <div>
            {stepIndex > 0 && (
              <button
                type="button"
                className="button button--outline button--small"
                onClick={() => onStepChange(stepIndex - 1)}
              >
                Back
              </button>
            )}
            <button
              ref={nextButtonRef}
              type="button"
              className="button button--primary button--small"
              onClick={() =>
                stepIndex === steps.length - 1 ? onFinish() : onStepChange(stepIndex + 1)
              }
            >
              {stepIndex === steps.length - 1 ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </section>
    </>,
    document.body,
  );
}

export function CataloguePage() {
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const tutorialRequest = useContext(TutorialRequestContext);
  const navigation = useContext(NavigationContext);
  const finishTutorial = useCallback(() => {
    try {
      window.localStorage.setItem(TUTORIAL_STORAGE_KEY, "true");
    } catch {
      // Keep the guide usable when browser storage is unavailable.
    }
    setTutorialOpen(false);
    navigation?.setMenuOpen(false);
  }, [navigation?.setMenuOpen]);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(TUTORIAL_STORAGE_KEY) !== "true") {
        setTutorialOpen(true);
        navigation?.setMenuOpen(true);
      }
    } catch {
      setTutorialOpen(true);
      navigation?.setMenuOpen(true);
    }
  }, [navigation?.setMenuOpen]);
  useEffect(() => {
    const requestId = tutorialRequest?.requestId ?? 0;
    if (
      tutorialRequest?.requestPath !== "/catalogue" ||
      requestId === 0 ||
      !tutorialRequest?.consumeTutorialRequest(requestId)
    )
      return;
    setTutorialStep(0);
    setTutorialOpen(true);
    navigation?.setMenuOpen(true);
  }, [
    navigation?.setMenuOpen,
    tutorialRequest?.consumeTutorialRequest,
    tutorialRequest?.requestId,
    tutorialRequest?.requestPath,
  ]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pageSize = 100;
  const [pageInput, setPageInput] = useState(String(page));
  useEffect(() => setPageInput(String(page)), [page]);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);
  const catalogue = useCatalogue();
  const categoryNames = useCategoryNames();
  const { data: heroData } = useProducts({ page: 1, pageSize: 50 });
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
  const categories = catalogue.data?.categories ?? [];
  const quickCategories = categories.slice(0, 6);
  const backdropProducts = heroData?.products ?? [];
  const backdropSequence = createCatalogueBackdropSequence(backdropProducts);
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
      <section className="catalogue-collage-hero">
        <div className="catalogue-collage-viewport" aria-hidden="true">
          <div className="catalogue-collage-track">
            {CATALOGUE_BACKDROP_GROUP_KEYS.map((copyKey) => (
              <div className="catalogue-collage-group" key={copyKey}>
                {backdropSequence.map(({ product, slot }) => {
                  const { accent } = categoryVisual(product.categoryId);
                  return (
                    <div
                      key={`${copyKey}-${slot}-${product.productId}`}
                      className={`catalogue-collage-tile catalogue-collage-tile--${(slot % backdropProducts.length) + 1}`}
                      data-product-id={product.productId}
                      style={{
                        background: accent,
                        gridColumn: Math.floor(slot / 2) + 1,
                        gridRow: (slot % 2) + 1,
                      }}
                    >
                      {product.imageUrl && <img src={product.imageUrl} alt="" />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="catalogue-collage-overlay" />
        <div className="container catalogue-collage-content">
          <h1>Find your everyday essentials.</h1>
          <div className="catalogue-search-card">
            <Search size={21} aria-hidden="true" />
            <label htmlFor="catalogue-search" className="sr-only">
              Search products
            </label>
            <input
              ref={searchInputRef}
              id="catalogue-search"
              value={search}
              maxLength={100}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search products, brands or pack sizes"
            />
            <span className="catalogue-search-card__hint">⌘ / Ctrl K</span>
          </div>
          <p className="catalogue-search-caption">
            Exact products. Clear retailer offers. No substitutions.
          </p>
        </div>
      </section>
      <section className="container catalogue-section">
        <div className="catalogue-controls">
          <fieldset
            id="catalogue-filters"
            className="category-chips"
            aria-label="Quick product category filters"
          >
            <button
              type="button"
              className={categoryId === "" ? "is-active" : ""}
              onClick={() => {
                setCategoryId("");
                setPage(1);
              }}
            >
              All
            </button>
            {quickCategories.map((category) => (
              <button
                key={category.categoryId}
                type="button"
                className={categoryId === category.categoryId ? "is-active" : ""}
                onClick={() => {
                  setCategoryId(category.categoryId);
                  setPage(1);
                }}
              >
                {category.name}
              </button>
            ))}
          </fieldset>
          <label className="select-field select-field--compact">
            <SlidersHorizontal size={15} aria-hidden="true" />
            <span className="sr-only">Filter category</span>
            <select
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.categoryId} value={category.categoryId}>
                  {category.name}
                </option>
              ))}
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </label>
        </div>
        <div className="catalogue-summary">
          <p>
            <strong>{total}</strong> products found
          </p>
          <p>Compare Singapore grocery retailers</p>
        </div>
        <div id="catalogue-products">
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
                className={
                  isPlaceholderData ? "product-grid product-grid--pending" : "product-grid"
                }
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
        </div>
      </section>
      <TutorialGuide
        open={tutorialOpen}
        stepIndex={tutorialStep}
        onStepChange={setTutorialStep}
        onFinish={finishTutorial}
        menuOpen={navigation?.menuOpen ?? false}
      />
    </main>
  );
}

export function ProductDetail() {
  const [, params] = useRoute("/product/:id");
  const [location] = useLocation();
  const productId = params?.id ?? "";
  const [quantity, setQuantity] = useState(1);
  const { data, isLoading, error } = useOffers(productId, quantity);
  const categoryNames = useCategoryNames();
  const { addToBasket } = useBasket();
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const tutorialRequest = useContext(TutorialRequestContext);
  const navigation = useContext(NavigationContext);
  const finishTutorial = useCallback(() => {
    setTutorialOpen(false);
    navigation?.setMenuOpen(false);
  }, [navigation?.setMenuOpen]);
  useEffect(() => {
    const requestId = tutorialRequest?.requestId ?? 0;
    if (
      tutorialRequest?.requestPath !== location ||
      requestId === 0 ||
      !tutorialRequest?.consumeTutorialRequest(requestId)
    )
      return;
    setTutorialStep(0);
    setTutorialOpen(true);
    navigation?.setMenuOpen(true);
  }, [
    location,
    navigation?.setMenuOpen,
    tutorialRequest?.consumeTutorialRequest,
    tutorialRequest?.requestId,
    tutorialRequest?.requestPath,
  ]);
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
              ? "That product is not in the catalogue."
              : "The offers service is unavailable. Please try again shortly."}
          </p>
          <Link className="button button--primary" href="/catalogue">
            Back to catalogue
          </Link>
        </div>
      </main>
    );
  // Offers for the previous quantity stay on screen while the new ones load, so
  // describe them with the quantity they were priced for.
  const { product, offers, quantity: pricedQuantity } = data;
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
          </div>
          <p className="product-detail__copy">
            Compare the estimated product cost for your requested quantity. Prices include sale
            prices and multibuy deals on this product; other promotions are not included.
          </p>
          <div className="quantity-control" id="product-quantity">
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
          <div className="offer-list" id="product-offers">
            <div className="offer-list__head">
              <span>Retailer offer</span>
              <span>Product cost</span>
            </div>
            <p className="offer-list__caption">
              For {pricedQuantity} {pricedQuantity === 1 ? "pack" : "packs"}; before delivery and
              order charges.
            </p>
            {offers.map((offer) => (
              <OfferRow key={offer.retailerId} offer={offer} quantity={pricedQuantity} />
            ))}
            {missingRetailers.map((retailerId) => (
              <UnavailableOfferRow key={retailerId} retailerId={retailerId} />
            ))}
          </div>
          <div className="detail-actions">
            <button
              id="add-to-basket"
              type="button"
              className="button button--primary"
              disabled={!product.available}
              onClick={() => {
                if (!addToBasket(product.productId, quantity)) return;
                toast.success("Added to basket", { description: `${quantity} × ${product.name}` });
              }}
            >
              <ShoppingBasket size={17} /> Add {quantity} pack{quantity > 1 ? "s" : ""} to basket
            </button>
            <Link href="/basket" className="button button--outline" id="view-basket">
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
            ? "No supported retailer has an eligible offer for this product."
            : "Offers are from our supported supermarket catalogues."}{" "}
        </p>
      </section>
      <TutorialGuide
        open={tutorialOpen}
        stepIndex={tutorialStep}
        onStepChange={setTutorialStep}
        onFinish={finishTutorial}
        menuOpen={navigation?.menuOpen ?? false}
        steps={productTutorialSteps(offers.length > 0)}
      />
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
            <WasPrice cents={offer.originalPriceCents} />
            {formatSgd(offer.unitPriceCents)} per pack ·{" "}
            {offer.priceKind === "unconditional_sale" ? "Sale price" : "Regular price"}
          </span>
          {multibuyNotes(offer.multibuy, quantity, offer.unitPriceCents, true).map((note) => (
            <span className="offer-row__deal" key={note}>
              {note}
            </span>
          ))}
          {offer.excludedPromotions.map((promotion) => (
            <span className="offer-row__promotion" key={promotion}>
              {excludedPromotionNote(promotion)}
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
          <span>Not available at {retailer.name}</span>
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
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const tutorialRequest = useContext(TutorialRequestContext);
  const navigation = useContext(NavigationContext);
  const {
    basket,
    basketRevision,
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
  } = useBasket();

  const finishTutorial = useCallback(() => {
    setTutorialOpen(false);
    navigation?.setMenuOpen(false);
  }, [navigation?.setMenuOpen]);
  useEffect(() => {
    const requestId = tutorialRequest?.requestId ?? 0;
    if (
      tutorialRequest?.requestPath !== "/basket" ||
      requestId === 0 ||
      !tutorialRequest?.consumeTutorialRequest(requestId)
    )
      return;
    setTutorialStep(0);
    setTutorialOpen(true);
    navigation?.setMenuOpen(true);
  }, [
    navigation?.setMenuOpen,
    tutorialRequest?.consumeTutorialRequest,
    tutorialRequest?.requestId,
    tutorialRequest?.requestPath,
  ]);

  const categoryNames = useCategoryNames();
  const basketBackdropProducts = basket.map((line) => {
    const product = productMetadata.get(line.productId);
    const { accent } = categoryVisual(product?.categoryId ?? "synthetic");
    return { productId: line.productId, imageUrl: product?.imageUrl ?? null, accent };
  });
  const isBasketEmpty = basketBackdropProducts.length === 0;
  const backdropProducts = isBasketEmpty
    ? Array.from({ length: 12 }, (_, index) => ({
        productId: `cartoptix-icon-${index}`,
        imageUrl: null,
        accent: "#1b342f",
      }))
    : basketBackdropProducts;
  const shouldScrollBackdrop = basket.length >= 11;
  const backdropCopies = shouldScrollBackdrop ? ["primary", "duplicate"] : ["primary"];
  const totalPacks = basket.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <main>
      <section
        className={`basket-product-hero${shouldScrollBackdrop ? " basket-product-hero--scrolling" : " basket-product-hero--static"}${isBasketEmpty ? " basket-product-hero--empty" : ""}`}
        style={{ "--basket-product-count": backdropProducts.length } as CSSProperties}
      >
        <div className="basket-product-hero__viewport" aria-hidden="true">
          <div
            className={`basket-product-hero__track${shouldScrollBackdrop ? " basket-product-hero__track--scrolling" : " basket-product-hero__track--static"}`}
          >
            {backdropCopies.map((copy) => (
              <div className="basket-product-hero__group" key={copy}>
                {backdropProducts.map((product) => (
                  <div
                    key={`${copy}-${product.productId}`}
                    className={`basket-product-hero__tile${isBasketEmpty ? " basket-product-hero__tile--brand" : ""}`}
                    data-product-id={isBasketEmpty ? undefined : product.productId}
                    style={{ background: product.accent }}
                  >
                    {isBasketEmpty ? (
                      <span className="basket-product-hero__brand-mark">
                        <Leaf size="40%" aria-hidden="true" />
                      </span>
                    ) : (
                      product.imageUrl && <img src={product.imageUrl} alt="" />
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="basket-product-hero__overlay" />
        <div className="container basket-product-hero__content">
          <p className="eyebrow">Shopping basket</p>
          <div className="basket-product-hero__heading-row">
            <h1>Review your basket</h1>
            <div className="basket-header__meta">
              <div>
                <strong>{basket.length}</strong>
                <span>items</span>
              </div>
              <div>
                <strong>{totalPacks}</strong>
                <span>packs</span>
              </div>
            </div>
          </div>
          <p className="basket-product-hero__description">
            Compare your complete basket at RedMart, FairPrice and Cold Storage.
          </p>
        </div>
      </section>
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
                  Browser storage is unavailable. Keep this tab open to retain your edits.
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
              <p>Browse the catalogue to add products to your basket.</p>
              <Link className="button button--primary" href="/catalogue">
                Browse products <ArrowRight size={16} />
              </Link>
            </div>
          ) : (
            <div className="basket-card">
              <div className="basket-card__header">
                <div>
                  <p className="eyebrow">Selected items</p>
                  <h2>Your grocery list</h2>
                </div>
                <Link href="/catalogue" className="button button--outline button--small">
                  Add more
                </Link>
              </div>
              {basket.map((line) => {
                const product = productMetadata.get(line.productId);
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
        </div>
        <aside className="basket-sidebar">
          <div className="basket-summary-card">
            <p className="eyebrow">Compare options</p>
            <h2>Complete retailer baskets</h2>
            <p className="muted">We’ll compare your shopping cart for you.</p>
            <div className="scenario-box">
              <div>
                <Check size={15} /> Singapore serviceable location
              </div>
              <div>
                <Check size={15} /> Standard delivery
              </div>
              <small>Compare estimated totals and see unavailable products at each retailer.</small>
            </div>
            <div className="basket-summary-card__footer">
              <span>Items in basket</span>
              <strong>
                {basket.length} / {MAX_BASKET_LINES}
              </strong>
            </div>
            <button
              id="compare-basket"
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
        </aside>
      </section>
      <TutorialGuide
        open={tutorialOpen}
        stepIndex={tutorialStep}
        onStepChange={setTutorialStep}
        onFinish={finishTutorial}
        menuOpen={navigation?.menuOpen ?? false}
        steps={basket.length > 0 ? BASKET_TUTORIAL_STEPS : EMPTY_BASKET_TUTORIAL_STEPS}
      />
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
  const productHref = `/product/${product.productId}`;

  return (
    <div className="basket-row">
      <Link
        href={productHref}
        className="basket-row__image-link"
        aria-label={`View details for ${product.name}`}
      >
        <ProductImage product={product} className="product-image--basket" />
      </Link>

      <div className="basket-row__identity">
        <Link href={productHref} className="basket-row__product-link">
          <strong>{product.name}</strong>
        </Link>
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
  const tutorialRequest = useContext(TutorialRequestContext);
  const navigation = useContext(NavigationContext);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const finishTutorial = useCallback(() => {
    setTutorialOpen(false);
    navigation?.setMenuOpen(false);
  }, [navigation?.setMenuOpen]);
  useEffect(() => {
    const requestId = tutorialRequest?.requestId ?? 0;
    if (
      tutorialRequest?.requestPath !== "/results" ||
      requestId === 0 ||
      !tutorialRequest?.consumeTutorialRequest(requestId)
    )
      return;
    setTutorialStep(0);
    setTutorialOpen(true);
    navigation?.setMenuOpen(true);
  }, [
    navigation?.setMenuOpen,
    tutorialRequest?.consumeTutorialRequest,
    tutorialRequest?.requestId,
    tutorialRequest?.requestPath,
  ]);
  const hasPurchaseLinks =
    !isStale &&
    requestState.phase !== "pending" &&
    requestState.phase !== "failure" &&
    comparison !== null &&
    validateRecommendation(comparison).kind !== "invalid" &&
    comparison.submittedBasket.products[0] !== undefined &&
    comparison.options.some((option) => {
      const order = option.kind === "unavailable" ? option.partial : option;
      return order?.lines.some(
        (line) =>
          line.productId === comparison.submittedBasket.products[0]?.productId &&
          Boolean(line.purchaseUrl),
      );
    });
  const hasSignInRows =
    comparison?.options.some(
      (option) => option.kind === "complete" || option.partial !== undefined,
    ) ?? false;
  return (
    <>
      <BasketComparisonPage
        result={comparison}
        isStale={isStale}
        request={requestState}
        currentRevision={basketRevision}
        onRetry={retryComparison}
      />
      <TutorialGuide
        open={tutorialOpen}
        stepIndex={tutorialStep}
        onStepChange={setTutorialStep}
        onFinish={finishTutorial}
        menuOpen={navigation?.menuOpen ?? false}
        steps={resultsTutorialSteps(comparison, hasPurchaseLinks, hasSignInRows)}
      />
    </>
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
            <p>Search exact products. Brands, variants and pack sizes are never substituted.</p>
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
              Supported supermarket listings, regular and sale prices, multibuy deals on the same
              product, delivery fees, free-delivery thresholds and minimum-order values.
            </p>
          </div>
          <div>
            <h3>What is not included</h3>
            <p>
              Live scraping, listings outside the supported storefronts, cross-product promotions,
              cart transfer, stock reservation, payment, delivery-slot selection or buying extra
              items just to unlock a discount.
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
      <Route path="/">
        <Redirect to="/catalogue" />
      </Route>
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
  const [source] = useState(() => comparisonSource ?? createApiSource());
  const [tutorialRequest, setTutorialRequest] = useState({
    requestId: 0,
    requestPath: "/catalogue",
  });
  const handledTutorialRequestId = useRef(0);
  const requestTutorial = useCallback((requestPath: string) => {
    setTutorialRequest((current) => ({
      requestId: current.requestId + 1,
      requestPath,
    }));
  }, []);
  const consumeTutorialRequest = useCallback((requestId: number) => {
    if (requestId <= handledTutorialRequestId.current) return false;
    handledTutorialRequestId.current = requestId;
    return true;
  }, []);
  const tutorialRequestValue = useMemo(
    () => ({ ...tutorialRequest, requestTutorial, consumeTutorialRequest }),
    [tutorialRequest, requestTutorial, consumeTutorialRequest],
  );
  return (
    <ErrorBoundary>
      <QueryClientProvider client={client}>
        <BasketProvider source={source}>
          <TutorialRequestContext.Provider value={tutorialRequestValue}>
            <Toaster />
            <AppShell>
              <Router />
            </AppShell>
          </TutorialRequestContext.Provider>
        </BasketProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
