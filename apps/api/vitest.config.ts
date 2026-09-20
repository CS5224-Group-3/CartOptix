import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Load the repository .env so the database integration test can reach the local
// container without the developer exporting variables by hand. CI supplies the
// same variables directly, and the test skips when neither is present.
const envFile = resolve(import.meta.dirname, "../../.env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
