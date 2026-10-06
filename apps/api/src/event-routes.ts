/**
 * The outbound-click endpoint (PR-07, #19).
 *
 * Separate from the shopper routes because it is not part of a shopper
 * journey: nothing on the page waits for it, and its traffic is reported
 * apart from the four shopper endpoints.
 */
import {
  type OutboundClickRequest,
  type OutboundClickResponse,
  routes,
} from "@cartoptix/contracts";
import type { FastifyInstance } from "fastify";
import type { ClickRecorder } from "./events/outbound-click.ts";

export function registerEventRoutes(server: FastifyInstance, recorder: ClickRecorder): void {
  server.route<{ Body: OutboundClickRequest }>({
    ...routes.outboundClick,
    handler: async (request, reply): Promise<OutboundClickResponse> => {
      const result = await recorder.record(request.body.listingId);

      // 202 for every outcome, including an unknown listing. The client has
      // already navigated away and cannot act on a failure, and a 4xx here
      // would turn a rejected event into a reported request failure (SC-06)
      // without telling anyone anything they can use. The body carries the
      // distinction for usage reporting (#22); the rejection itself is what
      // stops an arbitrary event being stored.
      reply.code(202);
      return { status: result === "recorded" ? "recorded" : "not_recorded" };
    },
  });
}
