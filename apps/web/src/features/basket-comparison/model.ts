import type { OrderCharge, PlanLine, UnavailableReason } from "@cartoptix/contracts";

/** Frontend presentation data only. Shared financial details reuse the HTTP contract types. */
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
  purchaseUrl?: string;
}

export interface CompleteRetailerOption {
  kind: "complete";
  retailer: RetailerPresentation;
  lines: (SubmittedProduct & {
    amountCents: number;
    purchaseUrl: string;
    /** Optional only for legacy presentation fixtures; API adapters always supply this. */
    pricing?: Pick<PlanLine, "unitPriceCents" | "priceKind" | "itemCharges" | "excludedPromotions">;
  })[];
  productSubtotalCents: number;
  /** Additional charges only; amounts already in line prices are not added again. */
  charges: { label: string; amountCents: number }[];
  /** Original API charges, including normal amounts for waived fees. */
  orderCharges?: OrderCharge[];
  deliveryCents?: number;
  estimatedTotalCents: number;
}

export interface UnavailableRetailerOption {
  kind: "unavailable";
  retailer: RetailerPresentation;
  reasons: string[];
  explanations?: { reason: UnavailableReason; text: string }[];
}

export type RetailerOption = CompleteRetailerOption | UnavailableRetailerOption;

export interface BasketComparisonPresentation {
  submittedBasket: BasketSnapshot;
  options: RetailerOption[];
  outcome: { kind: "recommended"; retailerId: string } | { kind: "no-feasible-plan" };
  fixtureLabel?: string;
  provenance?: ComparisonProvenance;
}

/** Source identity is configuration, not an assertion inferred from an HTTP response. */
export interface ComparisonProvenance {
  kind: "synthetic" | "demo" | "test" | "curated";
  description: string;
}

/** A frontend request to a presentation-data source, never an HTTP payload. */
export interface ComparisonSubmission {
  /** Present only for an explicitly selected synthetic demo. */
  scenario?: string;
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
