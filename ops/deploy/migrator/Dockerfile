# THE DEPLOY-TIME DATABASE TOOLBOX (go-live gate P1-1).
#
# The live-auction freeze check, both migration sets, the grant drift gate and
# the production preflight all have to reach the database, and the production
# database publishes no port. They used to run on a GitHub-hosted runner
# against a URL it could not reach — so a deploy either failed at the freeze
# check or, worse, was configured around it. This image carries exactly those
# tools to the host, where `deploy-host.yml` runs them over SSH on the compose
# network (`docker compose --profile ops run --rm migrator <step>`).
#
# Built from the repo root in the same pipeline, tagged with the same commit as
# the app images, so the migrations applied are the ones the new images expect.
# A full (dev) install on purpose: drizzle-kit and tsx are dev dependencies,
# and this image never serves traffic.
FROM node:24-slim
WORKDIR /repo
# psql: check-live-window.mjs asks its one question through it.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-client ca-certificates; \
    rm -rf /var/lib/apt/lists/*; \
    corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# The lockfile pins patchedDependencies (patches/); a frozen install refuses without them.
COPY patches ./patches
COPY packages ./packages
COPY apps/engine ./apps/engine
COPY apps/web ./apps/web
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile \
      --filter @desiauction/db... \
      --filter @desiauction/engine... \
      --filter @desiauction/web...
COPY ops/deploy/migrator/run.sh /usr/local/bin/migrator
ARG APP_VERSION=dev
ENV NODE_ENV=production APP_VERSION=$APP_VERSION
# Runs as root, deliberately and only because of the preflight: it reads the
# host's web/engine/runner env files through a read-only bind mount, and those
# are `chmod 600` and owned by whichever uid the host's deploy user has — which
# the `node` user (1000) matches only by coincidence. A one-shot client with no
# port, run for seconds per deploy, is the cheapest place to spend that.
ENTRYPOINT ["/usr/local/bin/migrator"]
