#!/bin/sh
# One entrypoint, one step per call, so the deploy log says which step failed.
#
#   migrator live-window   refuse (exit 1/2) while any auction is live or paused
#   migrator migrate       apply the web and engine migration sets, in order
#   migrator roles         create/refresh the four runtime roles and their grants
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
  roles)
    # ops/db/create-app-role.sql, on EVERY deploy, between migrate and grants.
    # It has to follow the migrations (its grants name tables they create),
    # it is idempotent (roles are created only if missing), and the runbook
    # already says to re-run it after any migration that adds a table — so a
    # first deploy onto an empty database no longer fails at `grants` waiting
    # for a hand step. The four passwords are read from the service env files
    # already mounted for the preflight, never typed a second time, and the
    # role in each URL is checked against the role it is meant to be.
    role_pw() { # file key expected-role
      node -e '
        const [file, key, role] = process.argv.slice(1);
        const line = require("fs").readFileSync(file, "utf8").split("\n")
          .find((l) => l.startsWith(key + "="));
        if (!line) { console.error(`${key} missing in ${file}`); process.exit(2); }
        const url = new URL(line.slice(key.length + 1).trim());
        if (decodeURIComponent(url.username) !== role) {
          console.error(`${key} in ${file} is ${url.username}, expected ${role}`); process.exit(2);
        }
        process.stdout.write(decodeURIComponent(url.password));
      ' "$1" "$2" "$3"
    }
    APP_PW="$(role_pw /env/web.env DATABASE_URL desiauction_app)"
    SYSTEM_PW="$(role_pw /env/web.env SYSTEM_DATABASE_URL desiauction_system)"
    ENGINE_PW="$(role_pw /env/engine.env DATABASE_URL desiauction_engine)"
    RUNNER_PW="$(role_pw /env/runner.env DATABASE_URL desiauction_runner)"
    exec psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 \
      -v app_password="$APP_PW" -v system_password="$SYSTEM_PW" \
      -v engine_password="$ENGINE_PW" -v runner_password="$RUNNER_PW" \
      -f /repo/ops/db/create-app-role.sql
    ;;
  grants)
    cd apps/web && exec node node_modules/tsx/dist/cli.mjs scripts/verify-grants.ts
    ;;
  preflight)
    exec node scripts/preflight-production.mjs \
      --env=/env/web.env --engine-env=/env/engine.env --runner-env=/env/runner.env
    ;;
  *)
    echo "usage: migrator live-window|migrate|roles|grants|preflight" >&2
    exit 64
    ;;
esac
