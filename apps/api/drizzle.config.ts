// drizzle-kit configuration: generates SQL migrations from src/db/schema.ts.
// Run from apps/api: pnpm db:generate --name <change>
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./migrations",
});
