/**
 * Types exchanged between apps/api and apps/web.
 *
 * Every shape crossing the HTTP boundary is declared here once, so neither side
 * redefines the other's payloads. See AGENTS.md for the contract-first workflow.
 *
 * Runtime schemas are the source of truth; HTTP types are inferred from them.
 */

/** Base path for the versioned HTTP API. */
export const API_BASE_PATH = "/api/v1";

export * from "./api.ts";
export * from "./common.ts";
export * from "./health.ts";
export * from "./pricing.ts";
export * from "./routes.ts";
