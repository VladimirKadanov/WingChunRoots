# The application image (milestone M12; plan §3.1, §3.3, §7.6; docs/operations/local-run.md):
# one image for the three commands of the Compose profile `app`:
#
#   web      the Next.js standalone server (`node server.js`) on port 3000
#   worker   the pg-boss worker (src/worker.ts through tsx)
#   migrate  the migrations and the pg-boss schema, as migrator (src/server/db/cli.ts migrate)
#
# docker/app/entrypoint.sh runs scripts/check-env.sh for the command first, so a missing setting
# or one left as the example of .env.example stops the start. The process never runs as root
# (user `node` of the base image). Built and started in CI (the `image` job of ci.yml); never
# published (hosting is deferred, plan §3.3). The base image is pinned by digest; Renovate keeps
# it current (renovate.json).

ARG NODE_IMAGE=node:26.12.1-trixie-slim@sha256:94816674c62774da0d099a947bf4613b9e1972a2733abd0d0cd80e795f8411d0

FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1
# pnpm at the exact version of packageManager, through npm (never Corepack; CLAUDE.md §3).
RUN npm install --global pnpm@12.14.0 && npm cache clean --force
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Every dependency, for the build.
FROM base AS deps
RUN --mount=type=cache,id=wcr-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# Production dependencies only, for the worker and the migration step (tsx among them).
FROM base AS prod-deps
RUN --mount=type=cache,id=wcr-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --store-dir /pnpm/store

FROM deps AS build
COPY . .
# public/ is optional for Next.js; the runtime stage copies it either way.
RUN mkdir -p public && pnpm build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
# web: the standalone server with its static files; owned by `node`, which writes .next/cache.
COPY --from=build --chown=node:node /src/.next/standalone ./web
COPY --from=build --chown=node:node /src/.next/static ./web/.next/static
COPY --from=build --chown=node:node /src/public ./web/public
# worker and migrate: the TypeScript sources run through tsx, with the production dependencies.
COPY --from=prod-deps /src/node_modules ./ops/node_modules
COPY --from=build /src/package.json /src/tsconfig.json ./ops/
COPY --from=build /src/src ./ops/src
COPY --from=build /src/drizzle ./ops/drizzle
COPY --chmod=0755 scripts/check-env.sh ./scripts/check-env.sh
COPY .env.example ./.env.example
COPY --chmod=0755 docker/app/entrypoint.sh ./entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["web"]
