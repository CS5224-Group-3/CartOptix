import type { OrderCharge, PlanLine, UnavailableReason } from "@cartoptix/contracts";

/** Frontend presentation data only. Shared financial details reuse the HTTP contract types. */
export interface SubmittedProduct {
  productId: string;
  name: string;
  packDescription: string;
  quantity: number;
  /** Catalogue image, when known; shown for a product a retailer is missing. */
  imageUrl?: string | null;
}

export interface BasketSnapshot {
  revision: number;
  products: SubmittedProduct[];
}

export interface RetailerPresentation {
  id: string;
  name: string;
}

/** One retailer order as displayed: its lines, charges and estimated total. */
export interface OrderPresentation {
  lines: (SubmittedProduct & {
    amountCents: number;
    purchaseUrl: string;
    pricing: Pick<
      PlanLine,
      | "unitPriceCents"
      | "originalPriceCents"
      | "priceKind"
      | "multibuy"
      | "itemCharges"
      | "excludedPromotions"
    >;
  })[];
  productSubtotalCents: number;
  /** Additional charges only; amounts already in line prices are not added again. */
  charges: { label: string; amountCents: number }[];
  /** Original API charges, including normal amounts for waived fees. */
  orderCharges: OrderCharge[];
  deliveryCents: number;
  estimatedTotalCents: number;
}

export interface CompleteRetailerOption extends OrderPresentation {
  kind: "complete";
  retailer: RetailerPresentation;
}

export interface UnavailableRetailerOption {
  kind: "unavailable";
  retailer: RetailerPresentation;
  reasons: string[];
  explanations?: { reason: UnavailableReason; text: string }[];
  /** What checking out the lines this retailer has would cost; never ranked or recommended. */
  partial?: OrderPresentation;
  /** Basket products this retailer does not have. */
  missingProducts?: SubmittedProduct[];
}

export type RetailerOption = CompleteRetailerOption | UnavailableRetailerOption;

export interface BasketComparisonPresentation {
  submittedBasket: BasketSnapshot;
  options: RetailerOption[];
  outcome: { kind: "recommended"; retailerId: string } | { kind: "no-feasible-plan" };
  fixtureLabel?: string;
}

/** A frontend request to a presentation-data source, never an HTTP payload. */
export interface ComparisonSubmission {
  basket: BasketSnapshot;
}

export class ComparisonFailure extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "ComparisonFailure";
    this.retryable = retryable;
  }
}

/** Invalid data or missing display metadata is not a retryable transport failure. */
export class PresentationDataFailure extends ComparisonFailure {
  constructor() {
    super(
      "Comparison data could not be displayed safely. No purchase plan or recommendation is available.",
      false,
    );
    this.name = "PresentationDataFailure";
  }
}

export type ComparisonRequestState =
  | { phase: "idle" }
  | { phase: "pending"; submitted: ComparisonSubmission; retry: boolean }
  | { phase: "success"; submitted: ComparisonSubmission }
  | { phase: "failure"; submitted: ComparisonSubmission; failure: ComparisonFailure };

export type ComparisonSource = (
  submission: ComparisonSubmission,
) => Promise<BasketComparisonPresentation>;
