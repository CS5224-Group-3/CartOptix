/** Frontend presentation data only. These types are not an HTTP contract or #40 schema. */
export interface SubmittedProduct {
  productId: string;
  name: string;
  packDescription: string;
  quantity: number;
}

export interface BasketSnapshot {
  revision: number;
  products: SubmittedProduct[];
}

export interface RetailerPresentation {
  id: string;
  name: string;
  purchaseUrl: string;
}

export interface CompleteRetailerOption {
  kind: "complete";
  retailer: RetailerPresentation;
  lines: (SubmittedProduct & { amountCents: number; purchaseUrl: string })[];
  productSubtotalCents: number;
  /** Additional charges only; amounts already in line prices are not added again. */
  charges: { label: string; amountCents: number }[];
  estimatedTotalCents: number;
}

export interface UnavailableRetailerOption {
  kind: "unavailable";
  retailer: RetailerPresentation;
  reasons: string[];
}

export type RetailerOption = CompleteRetailerOption | UnavailableRetailerOption;

export interface BasketComparisonPresentation {
  submittedBasket: BasketSnapshot;
  options: RetailerOption[];
  outcome: { kind: "recommended"; retailerId: string } | { kind: "no-feasible-plan" };
  fixtureLabel: string;
}

/** A frontend request to a presentation-data source, never an HTTP payload. */
export interface ComparisonSubmission {
  scenario: string;
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

export type ComparisonRequestState =
  | { phase: "idle" }
  | { phase: "pending"; submitted: ComparisonSubmission; retry: boolean }
  | { phase: "success"; submitted: ComparisonSubmission }
  | { phase: "failure"; submitted: ComparisonSubmission; failure: ComparisonFailure };

export type ComparisonSource = (
  submission: ComparisonSubmission,
) => Promise<BasketComparisonPresentation>;
