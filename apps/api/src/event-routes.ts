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
 * Logs an event that did not reach storage.
 *
 * Deliberately the same channel and prefix the recorder's `onFailure` uses.
 * The response is 204 whatever happened, so these lines are the only record
 * that an event was lost, and #22 reports them from one place rather than
 * reconstructing them from two. Fastify's own logger is off (`server.ts`), so
 * `request.log` would discard them.
 */
function logNotRecorded(reason: string): void {
  console.warn(`Outbound click not recorded: ${reason}`);
}

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
    events.setErrorHandler(async (error: FastifyError, _request, reply) => {
      logNotRecorded(`rejected request: ${error.message}`);
      return reply.code(204).send();
    });

    events.route<{ Body: OutboundClickRequest }>({
      ...routes.outboundClick,
      handler: async (request, reply): Promise<null> => {
        // A shed write or a database fault is logged by the recorder; an
        // unknown listing is only visible here, and it is still a lost event.
        if ((await recorder.record(request.body.listingId)) === "unknown-listing") {
          logNotRecorded(`unknown listing: ${request.body.listingId}`);
        }
        reply.code(204);
        return null;
      },
    });
  });
}
