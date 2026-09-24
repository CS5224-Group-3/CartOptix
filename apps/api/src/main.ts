// Starts the Express API server, registers health and tRPC routes, and handles graceful shutdown.
import "dotenv/config";
import { createServer } from "node:http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express from "express";
import { loadConfig } from "./config.ts";
import { createDatabase } from "./database.ts";
import { createContext } from "./product/_core/context.ts";
import { appRouter } from "./product/routers.ts";

const config = loadConfig();
const database = createDatabase(config.databaseUrl);
const app = express();
const server = createServer(app);
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";

app.use((request, response, next) => {
  response.header("access-control-allow-origin", webOrigin);
  response.header("access-control-allow-credentials", "true");
  response.header("access-control-allow-headers", "content-type");
  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.get("/", (_request, response) => {
  response.json({
    service: "CartOptix API",
    status: "ok",
    health: "/health/ready",
    productApi: "/api/trpc",
  });
});
app.get("/health/live", (_request, response) => response.json({ status: "ok" }));
app.get("/health/ready", async (_request, response) => {
  const databaseCheck = await database.checkConnection();
  const body = {
    status: databaseCheck.status === "ok" ? "ok" : "unavailable",
    checks: { database: databaseCheck },
  } as const;
  response.status(body.status === "ok" ? 200 : 503).json(body);
});
app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

async function shutdown(signal: string): Promise<void> {
  process.stdout.write(`\nReceived ${signal}, shutting down.\n`);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await database.close();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    shutdown(signal).catch((error: unknown) => {
      console.error(`Error during shutdown after ${signal}:`, error);
      process.exit(1);
    });
  });
}

// Bind to all interfaces so the process is reachable from a container host.
server.listen(config.port, "0.0.0.0", () => {
  process.stdout.write(`API listening on http://localhost:${config.port}\n`);
});
