import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "scrape", include: ["**/*.test.ts"], environment: "node" },
});
