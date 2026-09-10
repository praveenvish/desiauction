# The web tier as a container (deployment moved from a platform build to a
# self-hosted host). Same shape as apps/engine/Dockerfile: deterministic build
# in CI, non-root at runtime, nothing from the build stage carried forward
# except what the server actually needs.
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter @desiauction/web...

# The build reads env at module scope (env.ts refuses to boot on bad values), so
# a placeholder is supplied for the BUILD only. Nothing here reaches the image:
# the runtime values arrive from the compose file. ALLOW_INSECURE_LOCAL_PRODUCTION
# is deliberately NOT set — a build must never be able to skip the boot checks.
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=$APP_VERSION \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    SYSTEM_DATABASE_URL=postgres://build2:build2@localhost:5432/build \
    PUBLIC_BASE_URL=https://build.invalid
RUN pnpm --filter @desiauction/web build

# `distroless/nodejs` has no shell, so `next start` (a bin script) cannot run.
# The standalone output ships its own server.js, which is the entrypoint.
FROM gcr.io/distroless/nodejs24-debian12:nonroot
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production APP_VERSION=$APP_VERSION PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["apps/web/server.js"]
