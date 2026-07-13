# Deterministic image built in CI (IP-0_DESIGN §21, §31): non-root, distroless.
# Workspace code is bundled into dist/index.mjs; npm runtime deps ship as the
# pnpm-deployed production node_modules.
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/engine ./apps/engine
RUN pnpm install --frozen-lockfile --filter @desiauction/engine...
RUN pnpm --filter @desiauction/engine build
# --legacy: workspace code is bundled into dist/index.mjs; the deployed
# node_modules only carries npm runtime deps (pnpm v10 injection not needed).
RUN pnpm --filter @desiauction/engine deploy --legacy --prod /deployed

FROM gcr.io/distroless/nodejs24-debian12:nonroot
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production APP_VERSION=$APP_VERSION
COPY --from=build /deployed/node_modules ./node_modules
COPY --from=build /repo/apps/engine/dist/index.mjs ./index.mjs
EXPOSE 4000
CMD ["index.mjs"]
