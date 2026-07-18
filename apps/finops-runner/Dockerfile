# Deterministic image built in CI (engine precedent, PRP-1 §2): non-root,
# distroless. Workspace code is bundled into dist/index.mjs; npm runtime deps
# ship as the pnpm-deployed production node_modules. No port — this is the
# platform's one scheduled-work process (follower poll, job queue, triggers).
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/finops-runner ./apps/finops-runner
RUN pnpm install --frozen-lockfile --filter @desiauction/finops-runner...
RUN pnpm --filter @desiauction/finops-runner build
# --legacy: workspace code is bundled into dist/index.mjs; the deployed
# node_modules only carries npm runtime deps (pnpm v10 injection not needed).
RUN pnpm --filter @desiauction/finops-runner deploy --legacy --prod /deployed

FROM gcr.io/distroless/nodejs24-debian12:nonroot
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production APP_VERSION=$APP_VERSION
COPY --from=build /deployed/node_modules ./node_modules
COPY --from=build /repo/apps/finops-runner/dist/index.mjs ./index.mjs
CMD ["index.mjs"]
