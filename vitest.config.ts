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
    // Keep worker concurrency predictable; the default starts one worker per test file.
    maxWorkers: 4,
  },
});
