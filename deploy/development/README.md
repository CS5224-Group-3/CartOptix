# Development AWS POC deployment

This directory contains the repeatable deployment configuration for the CartOptix
development proof of concept used for Issue #6.

## Architecture

The development POC runs on a single AWS EC2 `t4g.micro` ARM64 instance.

Architecture:

    Browser
       |
       | HTTP :80
       v
    nginx / CartOptix web
       |
       +---- /api/* ------> CartOptix API :3001
       |
       +---- /health/* ---> CartOptix API :3001
                              |
                              v
                        PostgreSQL :5432
                              |
                              v
                  cartoptix-postgres-data

Only nginx publishes a host port.

The API and PostgreSQL are connected through the private Docker network
`cartoptix-net` and do not publish ports directly on the EC2 host.

## Prerequisites

The EC2 host requires:

- ARM64 / aarch64 Linux
- Docker
- Docker Compose
- Docker Buildx
- Git

The tested development POC uses Amazon Linux 2023 on a `t4g.micro`.

Verify:

    uname -m
    docker --version
    docker compose version
    docker buildx version
    git --version

`uname -m` should report `aarch64`.

## Required Docker resources

The deployment uses these persistent Docker resources:

    cartoptix-postgres-data
    cartoptix-net

Create them on a fresh host with:

    docker volume create cartoptix-postgres-data
    docker network create cartoptix-net

The PostgreSQL volume must not be deleted during normal application redeployment.

## Environment configuration

Create the deployment environment file from the template:

    cd deploy/development
    cp .env.example .env
    chmod 600 .env

Set:

    POSTGRES_DB
    POSTGRES_USER
    POSTGRES_PASSWORD

Do not commit `.env`.

## Build

From `deploy/development`:

    docker compose build api web

Both application images are built natively for the ARM64 EC2 host.

## Start the application

    docker compose up -d postgres api web

Check status:

    docker compose ps

Expected running services:

    cartoptix-postgres
    cartoptix-api
    cartoptix-web

PostgreSQL should report healthy.

## Database migrations

Run migrations through the one-off operations profile:

    docker compose --profile ops run --rm migrate

The migration command is repeatable. When no schema changes are pending it reports:

    Database migrations are up to date.

## Seed import

Import the committed curated seed:

    docker compose --profile ops run --rm seed

The import is repeatable. Re-running it should not duplicate the seed dataset.

For the Issue #6 deployment verification, repeated imports produced the same counts:

    products   294
    listings   623
    retailers    3

## Smoke checks

Health:

    curl -i http://127.0.0.1/health/live
    curl -i http://127.0.0.1/health/ready

Readiness should return HTTP 200 and indicate that the database is healthy.

Shopper API:

    curl -i http://127.0.0.1/api/v1/catalogue
    curl -i "http://127.0.0.1/api/v1/products?page=1&pageSize=5"

Web:

    curl -I http://127.0.0.1/

These smoke paths should return HTTP 200.

## Port exposure

Verify published Docker ports:

    docker port cartoptix-web
    docker port cartoptix-api
    docker port cartoptix-postgres

Expected:

- web publishes TCP 80;
- API publishes no host port;
- PostgreSQL publishes no host port.

The EC2 security group should restrict administrative access and development
HTTP access to approved source addresses.

PostgreSQL port 5432 and API port 3001 must not be opened in the EC2 security
group.

## Persistence check

Database state is stored in the named Docker volume:

    cartoptix-postgres-data

Application containers can be restarted or recreated without deleting the
database.

For example:

    docker restart cartoptix-api
    curl -i http://127.0.0.1/health/ready

The Issue #6 verification retained:

    294 products
    623 listings
    3 retailers

before and after the API restart.

The same database volume also survived an EC2 stop/start cycle.

## Backup

Create a PostgreSQL backup with:

    docker exec cartoptix-postgres \
      pg_dump -U cartoptix -d cartoptix -Fc \
      > cartoptix.dump

Do not commit database dumps or credentials.

## Resource observations

During the Issue #6 verification, the `t4g.micro` POC had approximately:

    RAM              910 MiB
    Available RAM    493 MiB
    Swap               0 B
    Root disk          30 GB
    Root disk used    4.3 GB (15%)

Approximate idle container memory during verification:

    web          3.5 MiB
    API         33.4 MiB
    PostgreSQL  36.3 MiB

This is sufficient for the current development POC, but the instance has
limited memory headroom and no swap.

Resource use should be monitored during larger builds, imports, tests, or
concurrent usage.

## Development POC limitations

This configuration is intentionally not the production or presentation
architecture.

Current limitations include:

- single EC2 instance and single Availability Zone;
- no load balancer or Auto Scaling Group;
- PostgreSQL runs on EC2 rather than managed RDS;
- database persistence relies on the EC2-attached Docker volume;
- HTTP is used for this development smoke deployment;
- HTTPS termination is not configured here;
- no automated CI/CD deployment is included in Issue #6;
- no high-availability database or automatic database failover;
- `t4g.micro` has limited CPU and memory capacity;
- the current shopper routes still use the repository placeholder shopper
  dataset while the curated seed is loaded into PostgreSQL.

Integrating shopper routes with the seeded PostgreSQL data belongs to the
corresponding application/API work rather than this infrastructure POC.

Later infrastructure work can replace this single-instance development POC
with the presentation architecture without changing the purpose of Issue #6.
