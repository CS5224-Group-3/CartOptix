import { DEPOSIT_NOTICE, SNAPSHOT_DISCLAIMER } from "@cartoptix/contracts";
import { Link } from "wouter";
import ComparisonRequestStatus from "../components/basket/ComparisonRequestStatus";
import RetailerOptionCard from "../components/basket/RetailerOptionCard";
import type {
  BasketComparisonPresentation,
  ComparisonRequestState,
} from "../features/basket-comparison/model";
import { validateRecommendation } from "../features/basket-comparison/validation";

export default function BasketComparisonPage({
  result,
  isStale = false,
  request = { phase: "idle" },
  currentRevision = 0,
  onRetry = () => {},
}: {
  result: BasketComparisonPresentation | null;
  isStale?: boolean;
  request?: ComparisonRequestState;
  currentRevision?: number;
  onRetry?: () => void;
}) {
  if (!result)
    return (
      <main className="container empty-state">
        <h1>
          {request.phase === "pending"
            ? "Comparing basket"
            : request.phase === "failure"
              ? "Comparison unsuccessful"
              : "No comparison yet"}
        </h1>
        <ComparisonRequestStatus
          request={request}
          currentRevision={currentRevision}
          onRetry={onRetry}
        />
        {request.phase === "idle" && <p>Build a basket and run a new estimate first.</p>}
        <Link className="button button--primary" href="/basket">
          Go to basket
        </Link>
      </main>
    );
  const recommendation = validateRecommendation(result);
  const referenceOnly = isStale || request.phase === "pending" || request.phase === "failure";
  const recommendedId =
    !referenceOnly && recommendation.kind === "valid" ? recommendation.retailerId : null;
  const tied = !referenceOnly && recommendation.kind === "valid" && recommendation.tied;
  return (
    <main className="container results-page basket-comparison">
      <h1>Retailer basket comparison</h1>
      <ComparisonRequestStatus
        request={request}
        currentRevision={currentRevision}
        onRetry={onRetry}
      />
      {(request.phase === "pending" || request.phase === "failure") && (
        <p>
          Previous successful comparison, for reference only. Complete a new comparison before using
          its purchase links.
        </p>
      )}
      {isStale && (
        <div className="stale-banner stale-banner--large" role="status">
          <div>
            <strong>Your basket changed.</strong>
            <span>
              This comparison belongs to an earlier basket state. Recalculate after editing your
              basket; the previous result is shown for reference.
            </span>
          </div>
          <Link className="button button--small button--outline" href="/basket">
            Go to basket
          </Link>
        </div>
      )}
      {recommendation.kind === "invalid" && (
        <div className="notice-card notice-card--warning" role="alert">
          <p>
            Comparison fixture validation failed. The supplied retailer options, basket coverage, or
            recommendation are inconsistent. No purchase plan or recommendation is shown.
          </p>
        </div>
      )}
      {recommendation.kind !== "invalid" && (
        <>
          <p>Each complete option keeps your entire requested basket with one retailer.</p>
          <p className="notice-card">
            Synthetic demonstration: {result.fixtureLabel}. These are not retailer prices. Product
            links are illustrative.
          </p>
          {result.outcome.kind === "no-feasible-plan" && (
            <h2>No feasible purchasing plan available</h2>
          )}
          {tied && (
            <p>
              More than one complete retailer option shares the lowest estimated total. The
              highlighted option is one of these tied options.
            </p>
          )}
          <div className="basket-comparison__options">
            {result.options.map((option) => (
              <RetailerOptionCard
                key={option.retailer.id}
                option={option}
                recommended={option.retailer.id === recommendedId}
                tied={tied}
                purchaseEnabled={!referenceOnly}
              />
            ))}
          </div>
        </>
      )}
      <div className="results-disclaimer">
        <p>
          {SNAPSHOT_DISCLAIMER} {DEPOSIT_NOTICE}
        </p>
      </div>
      <div className="results-actions">
        <Link className="button button--primary" href="/basket">
          Edit basket
        </Link>
      </div>
    </main>
  );
}
