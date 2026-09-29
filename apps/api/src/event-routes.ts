/**
 * The outbound-click endpoint (PR-07, #19).
 *
 * Separate from the shopper routes because it is not part of a shopper
 * journey: nothing on the page waits for it, and its traffic is reported
 * apart from the four shopper endpoints.
 */
import { type OutboundClickRequest, routes } from "@cartoptix/contracts";
import type { FastifyError, FastifyInstance } from "fastify";
import type { ClickRecorder } from "./events/outbound-click.ts";

/**
 * Registers the endpoint inside its own plugin scope.
 *
 * The encapsulation is the point: an error handler set here applies to this
 * route alone, so the click endpoint can answer 204 for a malformed body
 * without changing how every other endpoint reports a bad request.
 */
export function registerEventRoutes(server: FastifyInstance, recorder: ClickRecorder): void {
  server.register(async (events) => {
    /**
     * Answers 204 with no body for every outcome: a body that is not JSON, a
     * body that fails the schema, an unknown listing, a shed write and a
     * database fault all look identical from outside.
     *
     * This is the project's one exception to answering errors with
     * `ErrorResponse`, and it is deliberate. The caller is a beacon fired as
     * the shopper navigates away; it has already discarded the response and
     * could not act on a failure if it read one. Following the GA Measurement
     * Protocol keeps this a pure side channel and leaves room to hand it to a
     * third-party analytics provider later.
     *
     * What is given up is status-code visibility, so the click endpoint is
     * excluded from SC-06 and #22 reports lost events from the logs instead.
     * Nothing rejected here reaches storage: the listing lookup in the
     * recorder is what decides that, not the status code.
     */
    events.setErrorHandler(async (error: FastifyError, request, reply) => {
      request.log.warn(`Outbound click rejected: ${error.message}`);
      return reply.code(204).send();
    });

    events.route<{ Body: OutboundClickRequest }>({
      ...routes.outboundClick,
      handler: async (request, reply): Promise<null> => {
        await recorder.record(request.body.listingId);
        reply.code(204);
        return null;
      },
    });
  });
}
