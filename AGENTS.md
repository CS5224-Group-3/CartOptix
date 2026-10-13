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
- Cost controls for the presentation stack (`infra/`): deploy and destroy it only from an engineer's machine, never from CI; destroy it at the end of each working session; run one baseline application instance (accepted availability debt, see the technical spec); keep the development host stopped while it is up; tag every resource `Project=cartoptix` so the tag-filtered budget sees it; and keep `cdk synth` free of context lookups so CI can synthesise without AWS credentials. These exist only because of the SGD 84 budget. Once cost no longer needs managing, or after teardown on 13 November 2026, remove them from this file, the spec and the runbooks.
- The API catalogue and products routes use the imported seed. Do not build production features on a synthetic API placeholder or present fixture figures as retailer data. Comparison fixtures remain explicitly synthetic for tests and demonstrations.
- When importing generated or template code, keep only what the app uses. Remove unused components, dependencies, lint or type exceptions, and template infrastructure (auth, ORMs, RPC layers) that the spec does not call for.

## Branching and integration

We use trunk-based development: `main` is the trunk and must always pass CI and stay releasable.

- Never commit directly to `main`. Branch from the latest `main` and merge back through a pull request after CI passes.
- Keep branches short-lived and pull requests small. Split large work into incremental PRs that each leave `main` working, rather than one long-running branch. Do not create long-lived `develop`, `release` or per-person branches.
- Name branches `<type>/<short-description>`, adding the issue number where there is one (for example `feat/issue-7-ci-cd-releases`). Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `data`.
- Write commit messages and PR titles as Conventional Commits, referencing the issue (for example `feat(api): compare complete baskets (#11)`).
- Rebase on or merge the latest `main` before requesting review if your branch has fallen behind. Merged branches are deleted automatically.

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

This applies inside `apps/api` too. When a module produces a value that reaches the wire, such as a status, reason code or field name, it uses the contract's type directly. It does not define a parallel internal spelling (`"no-feasible-plan"` for `"no_feasible_plan"`) that a mapper then translates. Internal-only values that never reach a response, such as the pricing module's result codes, may have their own names. For named constants, use `as const` objects or the contract's literal unions, not `enum`.

Keep a contract change and both sides of its usage in the same pull request, so type checking catches a mismatch before review.

Register API endpoints from the contracts' `routes`, so Fastify validates requests and serialises responses with the same schemas the client compiles against. The server rejects unknown fields (`removeAdditional: false`) because the contracts use closed objects; keep that setting. Every error response uses `ErrorResponse`, with one deliberate exception: `POST /api/v1/events/outbound-click` always answers `204` with no body, whatever happened. It is a fire-and-forget beacon sent as the shopper navigates away, so the caller has already discarded the response and could not act on a failure. Failures are logged server side and reported from there (#22), and the endpoint is excluded from SC-06 because status codes cannot show them.

The web client calls the API only through `apps/web/src/lib/api.ts`.
