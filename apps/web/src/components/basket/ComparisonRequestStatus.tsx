import { Link } from "wouter";
import type { ComparisonRequestState } from "../../features/basket-comparison/model";

export default function ComparisonRequestStatus({
  request,
  currentRevision,
  onRetry,
}: {
  request: ComparisonRequestState;
  currentRevision: number;
  onRetry: () => void;
}) {
  if (request.phase === "pending")
    return (
      <div className="notice-card" role="status">
        <div>
          <p>{request.retry ? "Retrying comparison..." : "Comparing submitted basket..."}</p>
          <p>
            You can edit your basket. This request still uses the products and quantities you
            submitted.
          </p>
          {request.retry && (
            <button type="button" className="button button--outline" disabled>
              Retrying...
            </button>
          )}
        </div>
      </div>
    );
  if (request.phase !== "failure") return null;
  return (
    <div className="notice-card notice-card--warning" role="alert">
      <div>
        <h2>Could not compare basket</h2>
        <p>{request.failure.message}</p>
        <p>This is a service failure, not a finding that retailers cannot fulfil your basket.</p>
        {request.failure.retryable && (
          <>
            <p>
              {request.submitted.basket.revision !== currentRevision
                ? "Your basket has changed. Retry uses the previously submitted basket; its result will be shown as an earlier comparison. To compare your edits, return to the basket and start a new comparison."
                : "Retry uses the same submitted products and quantities."}
            </p>
            <button type="button" className="button button--primary" onClick={onRetry}>
              Retry comparison
            </button>
          </>
        )}
        <Link className="button button--outline" href="/basket">
          Back to basket editing
        </Link>
      </div>
    </div>
  );
}
