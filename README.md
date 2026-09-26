# CartOptix

Intelligent Multi-Retailer Grocery Basket Optimisation

## Specifications

- [Product specification](docs/product-spec.md): user journeys, scope, constraints and success criteria.
- [Technical implementation specification](docs/technical-implementation-spec.md): architecture, data design, evaluation plan and issue-ready workstreams.

## Repository layout

This is a monorepo holding the web client and backend together, so a change to an
API response and the client that consumes it land in one commit and one review.

| Path | Contents |
| --- | --- |
| `apps/api` | Fastify backend |
| `apps/web` | React and Vite client |
| `packages/contracts` | Request and response types shared by both |
| `data` | Committed retailer source exports |
| `docs` | Product and technical specifications |
| `scripts` | Repository tooling |

Shared API types belong in `packages/contracts`. See [AGENTS.md](AGENTS.md) for
that convention.

## Prerequisites

- **Node.js 24** (the major version is pinned; minor and patch are free). With
  [nvm](https://github.com/nvm-sh/nvm): `nvm install && nvm use` reads `.nvmrc`.
- **pnpm** via Corepack, which ships with Node: `corepack enable`. The version in
  `package.json` is activated automatically, so everyone uses the same pnpm.
- **Docker** must be installed **and running**. It provides the local PostgreSQL
  database; `pnpm dev` fails with an explicit message when Docker is unavailable.
  On macOS and Windows install Docker Desktop and start it before development.

## Setup

```bash
nvm use                 # Node 24 from .nvmrc
corepack enable         # activates the pinned pnpm version
pnpm install
cp .env.example .env    # local placeholder values; never commit .env
pnpm dev
```

`pnpm dev` starts PostgreSQL, builds the shared contracts, then starts the API
and web app. Open <http://localhost:5173>. The catalogue, product offers and
basket comparison are served by the API under <http://localhost:3001/api/v1>,
using a synthetic placeholder dataset until the curated seed lands. The API
health check is available at <http://localhost:3001/health/ready>.

Never commit real credentials. `.env` is ignored by Git; only `.env.example` is
tracked, and it holds local placeholders.

## Commands

Run these from the repository root.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start PostgreSQL, the API and the web app |
| `pnpm check` | Format check, lint, type check and tests — the same checks CI runs |
| `pnpm fix` | Apply formatting and safe lint fixes |
| `pnpm build` | Production build of the API and web app |
| `pnpm --filter @cartoptix/api db:migrate` | Apply pending database migrations |
| `pnpm --filter @cartoptix/api db:generate --name <change>` | Generate a migration after editing `apps/api/src/db/schema.ts` |
| `pnpm --filter @cartoptix/api seed:import <file>` | Validate a seed and replace the loaded dataset with it; an invalid seed changes nothing |

`pnpm dev` leaves PostgreSQL running after you stop it with `Ctrl+C`. Stop the
database with `docker compose down`, or `docker compose down --volumes` to also
discard its data.

The database listens on port **5433** to avoid clashing with any PostgreSQL
already installed on your machine.

## Container image

Daily development does not need a container; `pnpm dev` runs everything
natively. The API image targets `linux/arm64` to match the planned Graviton
deployment, and is normally built in CI.

```bash
docker build --platform linux/arm64 -f apps/api/Dockerfile -t cartoptix-api .
```

On an x86 machine this runs under emulation and is slow. There is no need to
build it locally.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Docker is not available or not running` | Start Docker Desktop, then rerun `pnpm dev`. |
| `Missing .env` | Run `cp .env.example .env`. |
| `Missing required environment variable DATABASE_URL` | `.env` exists but is incomplete; compare it against `.env.example`. |
| `/health/ready` reports the database as `unavailable` | PostgreSQL is not healthy. Check `docker compose ps` and `docker compose logs postgres`. |
| Port 5433, 3001 or 5173 already in use | Another process holds the port. Stop it, or change the value in `.env` and `docker-compose.yml`. |

## Simple File Architecture

The repository is a pnpm monorepo. The paths below are the main places to look
when navigating the project.

<pre>
CartOptix/
├── .github/            # Repository and CI configuration
├── apps/               # Runnable web and API applications
│   ├── api/            # Fastify backend: health checks and shopper endpoints (placeholder data for now)
│   └── web/            # React/Vite browser client and its user interface
├── data/               # Retailer source exports used for the curated dataset
├── docs/               # Product and technical specifications
├── packages/           # Shared libraries used by the applications
│   └── contracts/      # Request and response schemas and types shared by the API and web app
├── scripts/            # Development and repository utility scripts
├── AGENTS.md           # Project instructions for contributors and coding agents
├── biome.json          # Formatting and linting configuration
├── docker-compose.yml  # Local PostgreSQL service definition
├── package.json        # Workspace scripts and shared development dependencies
├── pnpm-workspace.yaml # pnpm workspace package definitions
├── tsconfig.base.json  # Shared TypeScript compiler defaults
├── tsconfig.json       # Root TypeScript project references
└── vitest.config.ts    # Root test configuration
</pre>
