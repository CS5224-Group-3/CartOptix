# CartOptix agent guide

CartOptix compares Singapore grocery baskets across RedMart, FairPrice and Cold Storage using a curated snapshot dataset.

## Read before making changes

- [Product specification](docs/product-spec.md): authoritative user journeys, scope, constraints and success criteria.
- [Technical implementation specification](docs/technical-implementation-spec.md): architecture, data rules, evaluation plan and task IDs with dependencies and acceptance criteria.

Follow the product contract. The technical spec distinguishes agreed decisions from proposed implementation defaults; validate the latter before adopting them. Keep both specs consistent when requirements change.

## Core constraints

- Match exact products and pack configurations. Compare the complete basket at each retailer; do not split a basket across retailers, substitute products or add quantities.
- Support at most 50 distinct lines and 1–20 whole packs per line.
- Use verified, directly supermarket-fulfilled offers marked in stock. Quarantine ambiguous matches, prices, promotions and mandatory charges.
- Calculate in integer SGD cents. Recommend the cheapest feasible retailer option; show each unavailable retailer with its reason, and never price a partial basket as complete.
- Show the fixed-dataset disclaimer, not collection dates. Keep the clean seed in Git.

## Working conventions

- Map work to the technical spec's task IDs and acceptance criteria. Keep changes scoped and run relevant checks.
- Consult actual package scripts and infrastructure configuration as they are added; do not assume proposed tools are already implemented.
- Record unresolved evidence and measured results accurately. Do not present catalogue coverage, performance or AWS affordability as verified before checking them.
- AWS deployments are budget-constrained. Consult the spec before provisioning or changing resources; never commit credentials.
- `apps/api/src/placeholder/` holds a synthetic dataset and comparison that let the UI run end to end until the catalogue, pricing and comparison work (#8, #9, #13) lands. Replace it; do not build features on it or present its figures as retailer data.
- When importing generated or template code, keep only what the app uses. Remove unused components, dependencies, lint or type exceptions, and template infrastructure (auth, ORMs, RPC layers) that the spec does not call for.

## Local development

See [README.md](README.md) for prerequisites, setup and commands. Docker must be installed and running, because it provides the local PostgreSQL database.

Run `pnpm check` before proposing changes; it runs the same format, lint, type and test checks as CI. It needs PostgreSQL running, because the API integration tests query it; start it with `pnpm dev` or `docker compose up --detach --wait`.

- `@cartoptix/contracts` is consumed from its compiled `dist/`. `pnpm check` and `pnpm dev` build it first; after editing contracts, run `tsc --build` before running `pnpm test` or Vitest on their own, or they will use stale output.
- The API runs TypeScript directly with Node's type stripping (`node src/main.ts`). Use `.ts` extensions in relative imports, and avoid syntax that needs compilation: enums, namespaces and constructor parameter properties.
- The database schema lives in `apps/api/src/db/schema.ts`. After changing it, run `pnpm --filter @cartoptix/api db:generate --name <change>` and commit the generated migration; never edit an applied migration.
- Only `apps/web` type-checks its tests; API and contracts tests are not covered by `tsc --build`. Keep them type-correct by hand.

## Shared API contracts

This repository is a monorepo so that the web client and backend evolve together.

**Types exchanged between `apps/web` and `apps/api` are declared once in `packages/contracts`.** Define the request and response types there first, then import them on both sides. Neither side redefines a shape the other owns, and no endpoint is consumed by the client through a locally declared type.

Keep a contract change and both sides of its usage in the same pull request, so type checking catches a mismatch before review.

Register API endpoints from the contracts' `routes`, so Fastify validates requests and serialises responses with the same schemas the client compiles against. The server rejects unknown fields (`removeAdditional: false`) because the contracts use closed objects; keep that setting. Every error response uses `ErrorResponse`.

The web client calls the API only through `apps/web/src/lib/api.ts`.
