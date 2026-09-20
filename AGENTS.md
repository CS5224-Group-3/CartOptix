# CartOptix agent guide

CartOptix compares Singapore grocery baskets across RedMart, FairPrice and Cold Storage using a curated snapshot dataset.

## Read before making changes

- [Product specification](docs/product-spec.md): authoritative user journeys, scope, constraints and success criteria.
- [Technical implementation specification](docs/technical-implementation-spec.md): architecture, data rules, evaluation plan and task IDs with dependencies and acceptance criteria.

Follow the product contract. The technical spec distinguishes agreed decisions from proposed implementation defaults; validate the latter before adopting them. Keep both specs consistent when requirements change.

## Core constraints

- Match exact products and pack configurations. Allocate each line entirely to one retailer; do not substitute products or add quantities.
- Support at most 50 distinct lines, 1–20 whole packs per line and a user-selected maximum of 1–3 retailers.
- Use verified, directly supermarket-fulfilled offers marked in stock. Quarantine ambiguous matches, prices, promotions and mandatory charges.
- Calculate in integer SGD cents. Retain the cheapest feasible single-retailer baseline; recommendations must never cost more than it under the same rules.
- Describe heuristic results as best-found plans. Distinguish unsuccessful search from proven infeasibility; savings are unavailable without a baseline.
- Show the fixed-dataset disclaimer, not collection dates. Keep clean seed data version-controlled and preserve provenance.

## Working conventions

- Map work to the technical spec's task IDs and acceptance criteria. Keep changes scoped and run relevant checks.
- Consult actual package scripts and infrastructure configuration as they are added; do not assume proposed tools are already implemented.
- Record unresolved evidence and measured results accurately. Do not present catalogue coverage, performance or AWS affordability as verified before checking them.
- AWS deployments are budget-constrained. Consult the spec before provisioning or changing resources; never commit credentials.

## Local development

See [README.md](README.md) for prerequisites, setup and commands. Docker must be installed and running, because it provides the local PostgreSQL database.

Run `pnpm check` before proposing changes; it runs the same format, lint, type and test checks as CI.

## Shared API contracts

This repository is a monorepo so that the web client and backend evolve together.

**Types exchanged between `apps/web` and `apps/api` are declared once in `packages/contracts`.** Define the request and response types there first, then import them on both sides. Neither side redefines a shape the other owns, and no endpoint is consumed by the client through a locally declared type.

Keep a contract change and both sides of its usage in the same pull request, so type checking catches a mismatch before review.
