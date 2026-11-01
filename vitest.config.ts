import { defineConfig } from "vitest/config";

/**
 * Root test configuration.
 *
 * apps/web supplies its own jsdom environment through apps/web/vite.config.ts;
 * every other package, and the scrapers in scripts/scrape, runs in Node.
 */
export default defineConfig({
  test: {
    projects: ["apps/api", "apps/web", "packages/contracts", "scripts/scrape", "infra"],
    // Keep worker concurrency predictable; the default starts one worker per test file.
    maxWorkers: 4,
  },
});
