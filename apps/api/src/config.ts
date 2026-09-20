/**
 * Environment configuration.
 *
 * Missing or invalid values fail fast at startup with an actionable message,
 * rather than surfacing later as an obscure connection error.
 */

export interface ApiConfig {
  port: number;
  databaseUrl: string;
}

const SETUP_HINT = "Copy .env.example to .env and see README.md for local setup.";

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable ${name}. ${SETUP_HINT}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const rawPort = env.API_PORT ?? "3001";
  const port = Number.parseInt(rawPort, 10);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`API_PORT must be a port number between 1 and 65535, received "${rawPort}".`);
  }

  return {
    port,
    databaseUrl: required("DATABASE_URL", env.DATABASE_URL),
  };
}
