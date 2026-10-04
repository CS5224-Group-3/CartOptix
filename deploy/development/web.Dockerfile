FROM node:24-slim AS build

WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY patches ./patches
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile --filter @cartoptix/web... --filter @cartoptix/contracts...

COPY packages/contracts ./packages/contracts
COPY apps/web ./apps/web

RUN pnpm --filter @cartoptix/contracts build \
 && pnpm --filter @cartoptix/web build

FROM nginx:alpine

COPY deploy/development/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
