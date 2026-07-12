# @desiauction/engine

The stateful auction runtime and realtime service (C-12). IP-0 ships the shell: fail-closed env, pino logging, `/healthz`, `/ws` echo, Drizzle migration discipline. The auction engine itself arrives in IP-4. Deploys to Fly.io Mumbai; one machine per environment.

- `pnpm dev` — watch mode on :4000 (needs `docker compose up -d` at repo root)
- `pnpm db:migrate` — apply committed SQL migrations
- `pnpm test` / `pnpm test:integration`
