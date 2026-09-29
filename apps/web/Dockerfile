# The web tier as a container (deployment moved from a platform build to a
# self-hosted host). Same shape as apps/engine/Dockerfile: deterministic build
# in CI, non-root at runtime, nothing from the build stage carried forward
# except what the server actually needs.
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# The lockfile pins patchedDependencies (patches/); a frozen install refuses without them.
COPY patches ./patches
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
# ONE KEY ACROSS BUILDS, OR EVERY DEPLOY BREAKS EVERY OPEN TAB (PRR 2026-09-29).
#
# Next derives the id of each server action from a salt, and the salt is the
# "server actions encryption key". With none supplied it invents one PER BUILD
# (next/dist/build/webpack-config.js: `serverReferenceHashSalt: encryptionKey`),
# and a CI build starts from a clean checkout every time. So each release
# renamed every action: a bid, a registration, a saved lineup sent from a page
# that was loaded before the deploy reached a server that no longer knew the
# name, and failed until the person reloaded — with a message about the
# connection, since that is what an unknown action looks like from the browser.
#
# Supplied as a BuildKit SECRET, never an ARG: an ARG is recorded in the image
# history. The mount is optional on purpose — CI's image job and a laptop build
# have no secret, and build exactly as before with a throwaway key. The deploy
# passes it when the environment has one (deploy-host.yml), and says so loudly
# when it does not. The key: `openssl rand -base64 32`, one per environment.
RUN --mount=type=secret,id=server_actions_key \
    if [ -s /run/secrets/server_actions_key ]; then \
      NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(cat /run/secrets/server_actions_key)"; \
      export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY; \
      echo "server actions key: pinned for this environment"; \
    else \
      echo "server actions key: none supplied, generated for this build only"; \
    fi; \
    pnpm --filter @desiauction/web build

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
