/**
 * Types exchanged between apps/api and apps/web.
 *
 * Every shape crossing the HTTP boundary is declared here once, so neither side
 * redefines the other's payloads. See AGENTS.md for the contract-first workflow.
 *
 * This package currently exports types only. Runtime values (for example request
 * validation schemas) may be added later; the build already emits JavaScript.
 */

/** Base path for the versioned HTTP API. */
export const API_BASE_PATH = "/api/v1";

/** Whether the API process is running. */
export interface LivenessResponse {
  status: "ok";
}

/** Whether the API can serve requests, including its PostgreSQL dependency. */
export interface ReadinessResponse {
  /** "ok" only when every checked dependency is reachable. */
  status: "ok" | "unavailable";
  checks: {
    /** Result of a real query against PostgreSQL, not a connection guess. */
    database: DependencyCheck;
  };
}

export interface DependencyCheck {
  status: "ok" | "unavailable";
  /** Populated only when the check fails, for operator diagnosis. */
  detail?: string;
}
