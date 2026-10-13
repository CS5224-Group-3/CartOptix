import { ApiError } from "../../lib/api";
import { ComparisonFailure, PresentationDataFailure } from "./model";
/** Classify HTTP-call errors separately from invalid display data. */
export function classifyApiFailure(error: unknown): ComparisonFailure {
  if (error instanceof ApiError) {
    const retryable =
      error.status === 429 // Too Many Requests error (429 from a proxy or load balancer should be treated as retryable)
        ? true
        : error.code === "invalid_request" || error.code === "not_found"
          ? false
          : error.code === "service_error" || error.status >= 500; //  Internal Server Error
    return new ComparisonFailure(error.message, retryable);
  }
  if (error instanceof TypeError)
    return new ComparisonFailure(
      "The comparison service could not be reached. Please retry.",
      true,
    );
  return new PresentationDataFailure();
}
