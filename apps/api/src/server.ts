import type { LivenessResponse, ReadinessResponse } from "@cartoptix/contracts";
import Fastify, { type FastifyInstance } from "fastify";
import type { Database } from "./database.ts";
import { registerShopperRoutes } from "./shopper-routes.ts";

export interface BuildServerOptions {
  database: Database;
  databaseUrl?: string;
  /** Allowed browser origin for the local web app during development. */
  webOrigin?: string;
}

/**
 * Builds the Fastify instance without starting it, so tests can drive the
 * server in-process using `.inject()`.
 */
export function buildServer({
  database,
  databaseUrl,
  webOrigin,
}: BuildServerOptions): FastifyInstance {
  const server = Fastify({
    logger: false,
    // The contracts use closed objects; reject unknown fields instead of
    // Fastify's default of silently stripping them.
    ajv: { customOptions: { removeAdditional: false } },
  });

  if (webOrigin !== undefined) {
    server.addHook("onSend", async (_request, reply) => {
      reply.header("access-control-allow-origin", webOrigin);
    });
  }

  server.get("/health/live", async (): Promise<LivenessResponse> => {
    return { status: "ok" };
  });

  server.get("/health/ready", async (_request, reply): Promise<ReadinessResponse> => {
    const database_ = await database.checkConnection();
    const body: ReadinessResponse = {
      status: database_.status === "ok" ? "ok" : "unavailable",
      checks: { database: database_ },
    };

    // Readiness failure must be observable by a load balancer, not just in the body.
    reply.code(body.status === "ok" ? 200 : 503);
    return body;
  });

  registerShopperRoutes(server, database);

  return server;
}
