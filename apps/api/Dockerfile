# API image for the CartOptix backend.
#
# Targets linux/arm64 to match the planned Graviton (t4g) deployment. Local
# development does not need this image; see README.md.
#
# Build from the repository root:
#   docker build --platform linux/arm64 -f apps/api/Dockerfile -t cartoptix-api .

FROM node:24-slim AS build
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# Copy manifests first so dependency layers cache independently of source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --filter @cartoptix/api... --filter @cartoptix/contracts...

COPY packages/contracts ./packages/contracts
COPY apps/api ./apps/api
RUN pnpm --filter @cartoptix/contracts build && pnpm --filter @cartoptix/api build

# Reinstall without development dependencies for the runtime image.
RUN pnpm install --frozen-lockfile --prod --filter @cartoptix/api... --filter @cartoptix/contracts...

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/
# typebox is a runtime dependency of the contracts, linked only in this directory.
COPY --from=build /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist

# node:24-slim provides an unprivileged "node" user; never run the API as root.
USER node
EXPOSE 3001

# DATABASE_URL must be supplied at runtime; the application fails fast without it.
CMD ["node", "apps/api/dist/main.js"]
