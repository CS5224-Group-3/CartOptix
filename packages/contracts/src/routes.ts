import type { TObject, TSchema } from "@sinclair/typebox";
import {
  BasketCompareRequestSchema,
  BasketCompareResponseSchema,
  CatalogueResponseSchema,
  DatasetConflictSchema,
  InternalErrorSchema,
  NotFoundErrorSchema,
  OffersParamsSchema,
  OffersQuerySchema,
  OffersResponseSchema,
  OutboundClickRequestSchema,
  ProductsQuerySchema,
  ProductsResponseSchema,
  ServiceUnavailableErrorSchema,
  ValidationErrorSchema,
} from "./api.ts";
import { LivenessResponseSchema, ReadinessResponseSchema } from "./health.ts";
import { closedObject } from "./schema.ts";

export interface RouteContract {
  method: "GET" | "POST";
  url: string;
  operationId: string;
  description: string;
  schema: {
    querystring?: TObject;
    params?: TObject;
    body?: TSchema;
    response: Record<number, TSchema>;
  };
  noContentStatus?: number;
}
const errors = {
  400: ValidationErrorSchema,
  500: InternalErrorSchema,
  503: ServiceUnavailableErrorSchema,
};
const versionedErrors = { ...errors, 409: DatasetConflictSchema };

/** Reuse each schema in Fastify; registering handlers remains downstream work. */
export const routes = {
  catalogue: {
    method: "GET",
    url: "/api/v1/catalogue",
    operationId: "getCatalogue",
    description:
      "Active dataset, fixed-dataset disclaimer, and standard non-member delivery assumptions.",
    schema: {
      querystring: closedObject({}),
      response: { 200: CatalogueResponseSchema, ...errors },
    },
  },
  products: {
    method: "GET",
    url: "/api/v1/products",
    operationId: "getProducts",
    description:
      "Published products. Case-insensitive literal substring search over name, brand and variant; category AND query; order by productId ascending. Page defaults to 1 and pageSize to 20. Unknown category is 400; an empty match or out-of-range page is 200 with an empty list.",
    schema: {
      querystring: ProductsQuerySchema,
      response: { 200: ProductsResponseSchema, ...versionedErrors },
    },
  },
  offers: {
    method: "GET",
    url: "/api/v1/products/:id/offers",
    operationId: "getOffers",
    description:
      "Eligible quantity-aware product costs before delivery; known product with no offers returns 200 and an empty list. Product URLs must come from approved listing records.",
    schema: {
      params: OffersParamsSchema,
      querystring: OffersQuerySchema,
      response: { 200: OffersResponseSchema, ...versionedErrors, 404: NotFoundErrorSchema },
    },
  },
  compare: {
    method: "POST",
    url: "/api/v1/basket/compare",
    operationId: "compareBasket",
    description:
      "Reject duplicate product IDs, unknown products and client prices with 400. All business outcomes return 200. Validate whole-line assignments, arithmetic and baseline protection before responding. Never claim search failure proves infeasibility.",
    schema: {
      body: BasketCompareRequestSchema,
      response: { 200: BasketCompareResponseSchema, ...versionedErrors },
    },
  },
  outboundClick: {
    method: "POST",
    url: "/api/v1/events/outbound-click",
    operationId: "recordOutboundClick",
    description:
      "Record a known dataset/product/listing/retailer tuple with a server timestamp. 204 means stored. Best-effort client tracking must never block navigation. No user identity or arbitrary redirect URL.",
    schema: {
      body: OutboundClickRequestSchema,
      response: { ...versionedErrors, 404: NotFoundErrorSchema },
    },
    noContentStatus: 204,
  },
  live: {
    method: "GET",
    url: "/health/live",
    operationId: "getLiveness",
    description: "Process health only.",
    schema: { response: { 200: LivenessResponseSchema } },
  },
  ready: {
    method: "GET",
    url: "/health/ready",
    operationId: "getReadiness",
    description:
      "200 only when all required checks pass, otherwise 503. Foundation checks PostgreSQL with SELECT 1; shopper-route integration must also check an active, readable dataset and include checks.activeDataset. No active dataset is unavailable, never an empty catalogue.",
    schema: { response: { 200: ReadinessResponseSchema, 503: ReadinessResponseSchema } },
  },
} satisfies Record<string, RouteContract>;

function parameters(schema: TObject | undefined, location: "query" | "path") {
  if (!schema) return [];
  return Object.entries(schema.properties).map(([name, property]) => ({
    name,
    in: location,
    required: location === "path" || (schema.required?.includes(name) ?? false),
    schema: property,
  }));
}

function operation(route: RouteContract) {
  const responses: Record<string, unknown> = Object.fromEntries(
    Object.entries(route.schema.response).map(([status, schema]) => [
      status,
      {
        description:
          status === "200"
            ? "Success"
            : `HTTP ${status}; see the error code and endpoint semantics.`,
        content: { "application/json": { schema } },
      },
    ]),
  );
  if (route.noContentStatus)
    responses[route.noContentStatus] = { description: "Recorded; no response body." };
  return {
    operationId: route.operationId,
    description: route.description,
    parameters: [
      ...parameters(route.schema.params, "path"),
      ...parameters(route.schema.querystring, "query"),
    ],
    ...(route.schema.body
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema: route.schema.body } },
          },
        }
      : {}),
    responses,
  };
}

/** OpenAPI 3.1 uses JSON Schema, including null types and const discriminators.
 * Generated from the same route schemas; no separately maintained DTOs.
 * Methods are merged per path, so adding a second method to an existing path
 * (for example DELETE on an existing resource) does not drop the first. */
export function buildOpenApiDocument(routeContracts: Record<string, RouteContract>) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of Object.values(routeContracts)) {
    const path = route.url.replace(/:([A-Za-z]+)/g, "{$1}");
    const methods = paths[path] ?? {};
    paths[path] = methods;
    const method = route.method.toLowerCase();
    if (method in methods) {
      throw new Error(`Duplicate OpenAPI operation: ${route.method} ${path}`);
    }
    methods[method] = operation(route);
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "CartOptix API",
      version: "1.0.0",
      description:
        "Contract-first API; route definitions do not imply deployed handlers. See docs/api-contracts.md.",
    },
    paths,
  };
}

export const openApiDocument = buildOpenApiDocument(routes);
