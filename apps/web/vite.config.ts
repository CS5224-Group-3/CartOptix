import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
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
  test: {
    environment: "jsdom",
    globals: false,
  },
});
