/**
 * Types exchanged between apps/api and apps/web.
 *
 * Every shape crossing the HTTP boundary is declared here once, so neither side
 * redefines the other's payloads. See AGENTS.md for the contract-first workflow.
 *
 * Shopper API shapes are TypeBox schemas with types inferred from them, so the
 * API can validate with the same definitions the client compiles against.
 */

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
    /** Whether a seed has been imported, so comparisons have data to read. */
    seed: DependencyCheck;
  };
}

export interface DependencyCheck {
  status: "ok" | "unavailable";
  /** Populated only when the check fails, for operator diagnosis. */
  detail?: string;
}

export * from "./api.ts";
export * from "./common.ts";
