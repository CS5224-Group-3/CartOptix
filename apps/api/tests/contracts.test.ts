import { BasketCompareRequestSchema, duplicateProductIds, routes } from "@cartoptix/contracts";
import {
  basketRequestExample,
  bestFoundExample,
  duplicateLinesErrorExample,
  missingBaselineExample,
  noPlanFoundExample,
  provenInfeasibleExample,
} from "@cartoptix/contracts/fixtures";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";

describe("contract compatibility with Fastify 5", () => {
  it.each([bestFoundExample, missingBaselineExample, noPlanFoundExample, provenInfeasibleExample])(
    "serialises $status without changing the shared example",
    async (example) => {
      const server = Fastify();
      try {
        server.post(routes.compare.url, { schema: routes.compare.schema }, async () => example);
        const response = await server.inject({
          method: "POST",
          url: routes.compare.url,
          payload: basketRequestExample,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual(example);
      } finally {
        await server.close();
      }
    },
  );

  it("rejects rather than strips client prices, coerces body quantities, or merges duplicate lines", async () => {
    const server = Fastify({
      ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    });
    try {
      server.post<{ Body: typeof basketRequestExample }>(
        routes.compare.url,
        { schema: { body: BasketCompareRequestSchema } },
        async (request, reply) => {
          if (duplicateProductIds(request.body).length)
            return reply.code(400).send(duplicateLinesErrorExample);
          return bestFoundExample;
        },
      );
      for (const payload of [
        { ...basketRequestExample, totalCents: 1 },
        { ...basketRequestExample, lines: [{ productId: "fixture-rice", quantity: "1" }] },
        {
          ...basketRequestExample,
          lines: [
            { productId: "fixture-rice", quantity: 1 },
            { productId: "fixture-rice", quantity: 2 },
          ],
        },
      ]) {
        const response = await server.inject({ method: "POST", url: routes.compare.url, payload });
        expect(response.statusCode).toBe(400);
      }
    } finally {
      await server.close();
    }
  });
});
