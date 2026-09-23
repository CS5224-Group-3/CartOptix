import {
  type BasketCompareRequest,
  duplicateProductIds,
  type ErrorResponse,
  routes,
} from "@cartoptix/contracts";
import {
  baselineOnlyExample,
  basketRequestExample,
  duplicateLinesExample,
  duplicateLinesRequest,
  missingBaselineExample,
  noPlanFoundExample,
  provenInfeasibleExample,
  singleRetailerWinsExample,
  splitWinsExample,
} from "@cartoptix/contracts/fixtures";
import Fastify, { type FastifyError } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

// Proves the shared schemas work with Fastify's default validator and serialiser.
// The real handler and error mapping belong to #13; this stands in for both.
function compareServer(result: unknown) {
  const server = Fastify();
  server.setErrorHandler((error: FastifyError, _request, reply) => {
    const body: ErrorResponse = { error: { code: "invalid_request", message: error.message } };
    return reply.code(error.statusCode ?? 500).send(body);
  });
  server.post<{ Body: BasketCompareRequest }>(
    routes.compare.url,
    { schema: routes.compare.schema },
    async (request, reply) => {
      if (duplicateProductIds(request.body).length > 0) {
        return reply.code(400).send(duplicateLinesExample);
      }
      return result;
    },
  );
  return server;
}

let server: ReturnType<typeof compareServer> | undefined;
afterEach(async () => {
  await server?.close();
});

describe("basket comparison contract in Fastify", () => {
  it.each([
    ["split wins", splitWinsExample],
    ["single retailer wins", singleRetailerWinsExample],
    ["baseline only", baselineOnlyExample],
    ["missing baseline", missingBaselineExample],
    ["no plan found", noPlanFoundExample],
    ["proven infeasible", provenInfeasibleExample],
  ] as const)("serialises %s unchanged", async (_name, example) => {
    server = compareServer(example);
    const response = await server.inject({
      method: "POST",
      url: routes.compare.url,
      payload: basketRequestExample,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(example);
  });

  it("rejects duplicate lines and out-of-range quantities with the error shape", async () => {
    server = compareServer(splitWinsExample);
    const outOfRange = { ...basketRequestExample, lines: [{ productId: "p", quantity: 21 }] };

    for (const payload of [duplicateLinesRequest, outOfRange]) {
      const response = await server.inject({ method: "POST", url: routes.compare.url, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("invalid_request");
    }
  });
});
