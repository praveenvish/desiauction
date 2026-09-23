#!/bin/sh
# One entrypoint, one step per call, so the deploy log says which step failed.
#
#   migrator live-window   refuse (exit 1/2) while any auction is live or paused
#   migrator migrate       apply the web and engine migration sets, in order
#   migrator grants        assert the four runtime roles still match the manifest
#   migrator preflight     cross-service production env check over /env/*.env
#
# DATABASE_URL (migrator.env) is the database OWNER. DEPLOY_ANYWAY=1 is passed
# through to live-window by the deploy job only when the operator ticked it.
set -eu
cd /repo

case "${1:-}" in
  live-window)
    exec node scripts/check-live-window.mjs
    ;;
  migrate)
    # Forward-only. The same two sets, in the same order, that CI's integration
    # job applies — the platform schema, then the engine's own journal.
    (cd packages/db && node scripts/migrate.mjs)
    cd apps/engine && exec node node_modules/drizzle-kit/bin.cjs migrate
    ;;
  grants)
    cd apps/web && exec node node_modules/tsx/dist/cli.mjs scripts/verify-grants.ts
    ;;
  preflight)
    exec node scripts/preflight-production.mjs \
      --env=/env/web.env --engine-env=/env/engine.env --runner-env=/env/runner.env
    ;;
  *)
    echo "usage: migrator live-window|migrate|grants|preflight" >&2
    exit 64
    ;;
esac
