import { defineConfig } from "vitest/config";

/**
 * Root test configuration.
 *
 * apps/web supplies its own jsdom environment through apps/web/vite.config.ts;
 * every other package runs in Node.
 */
export default defineConfig({
  test: {
    projects: ["apps/api", "apps/web", "packages/contracts"],
    // Dev: If you have an issue with timeouts when running `pnpm test`, uncomment the `maxWorkers` field below
    // maxWorkers: 4, // Vitest otherwise starts one worker per test file here, causing avoidable CPU contention and test timeouts.
  },
});
