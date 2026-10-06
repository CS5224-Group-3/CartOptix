import { loadConfig } from "./config.ts";
import { createDatabase } from "./database.ts";
import { createClickRecorder } from "./events/outbound-click.ts";
import { buildServer } from "./server.ts";

const config = loadConfig();
const database = createDatabase(config.databaseUrl);
const clickRecorder = createClickRecorder({ connectionString: config.databaseUrl });
const server = buildServer({
  database,
  clickRecorder,
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
});

async function shutdown(signal: string): Promise<void> {
  process.stdout.write(`\nReceived ${signal}, shutting down.\n`);
  await server.close();
  await clickRecorder.close();
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
await server.listen({ port: config.port, host: "0.0.0.0" });
process.stdout.write(`API listening on http://localhost:${config.port}\n`);
