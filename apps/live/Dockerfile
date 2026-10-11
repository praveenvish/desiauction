# Deterministic image built in CI (IP-0_DESIGN §21, §31): non-root, distroless.
# Workspace code is bundled into dist/index.mjs; npm runtime deps ship as the
# pnpm-deployed production node_modules.
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# The lockfile pins patchedDependencies (patches/); a frozen install refuses without them.
COPY patches ./patches
COPY packages ./packages
COPY apps/live ./apps/live
RUN pnpm install --frozen-lockfile --filter @desiauction/live...
RUN pnpm --filter @desiauction/live build
# --legacy: workspace code is bundled into dist/index.mjs; the deployed
# node_modules only carries npm runtime deps (pnpm v10 injection not needed).
# The next@ patch belongs to apps/web, which this context never copies, so
# pnpm deploy calls it unused and refuses (ERR_PNPM_UNUSED_PATCH). Allowed
# here only: the workspace install still fails on a genuinely stale patch.
RUN pnpm --config.allow-unused-patches=true --filter @desiauction/live deploy --legacy --prod /deployed

FROM gcr.io/distroless/nodejs24-debian12:nonroot
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production APP_VERSION=$APP_VERSION
COPY --from=build /deployed/node_modules ./node_modules
COPY --from=build /repo/apps/live/dist/index.mjs ./index.mjs
EXPOSE 4100
CMD ["index.mjs"]
