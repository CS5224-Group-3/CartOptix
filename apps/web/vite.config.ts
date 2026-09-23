import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    host: "localhost",
    port: 5173,
    // Proxy keeps the browser on one origin in development, matching the
    // deployed setup where /api/* is routed to the backend.
    proxy: {
      "/api": {
        target: process.env.API_ORIGIN ?? "http://localhost:3001",
        changeOrigin: true,
      },
      "/health": {
        target: process.env.API_ORIGIN ?? "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  test: { environment: "jsdom", globals: false },
});
