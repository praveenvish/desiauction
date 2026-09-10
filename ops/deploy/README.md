# Self-hosted deployment

Three containers, one Caddy, one Postgres, one backup sidecar — on one host.
This directory holds the files that describe it; `docs/operations/DEPLOYMENT.md`
holds the procedure and the rollback decision tree.

## Why images are built in CI, never on the host

The Next.js build peaks at 4–8 GB. Sizing the production box for that means
paying around the clock for capacity used ten minutes a week — and it puts a
compiler on the machine that serves auction night. `deploy-host.yml` builds and
pushes to GHCR; the host only ever pulls.

It also means every deploy passes the same quality gates as `main`.

## Files

| File                            | What it is                                                  |
| ------------------------------- | ----------------------------------------------------------- |
| `docker-compose.production.yml` | The stack. Images pinned by `TAG`, Postgres pinned to 17    |
| `Caddyfile`                     | TLS termination + reverse proxy. Certificates are automatic |
| `*.env`                         | **Not in git.** Created on the host, `chmod 600`            |

## The env files the host needs

Copy from the production template and split by service:

- `web.env` — the full web environment (see `preflight:production`)
- `engine.env` — `DATABASE_URL` (engine role), `ENGINE_SECRET`, `ENGINE_ALLOWED_ORIGINS`
- `runner.env` — `DATABASE_URL` (runner role), `FINOPS_*`
- `db.env` — `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `pgbackrest.env` — R2 credentials for the WAL archive
- `.env` — `REGISTRY` and `TAG`, rewritten by the deploy workflow

Each app refuses to boot on bad env, so a missing value fails fast and loudly
rather than at a user's login.

## PITR is the only rollback, so prove it works

Migrations are forward-only. There are no down migrations and there never have
been, so the restore point is the only thing that can undo one. Migration 0058
already dropped `NOT NULL` on both `fixtures` side columns — once one lobby
exists, no image rollback recovers that.

pgBackRest archives WAL to Cloudflare R2, **off the box**. A backup on the same
disk is not a backup.

**You do not have PITR until a restore has been rehearsed.** The repo ships the
drill:

```sh
pnpm restore:drill
```

Run it against the production stanza before the first real auction, and record
the RTO. Until it passes you have a hope, not a backup.

## The engine is exactly one process

It claims a Postgres advisory lock at boot and a second instance refuses to
start. `replicas: 1` in the compose file is a statement of fact, not a tuning
choice — scaling it produces a crash loop, by design. Scale the web tier.

The `tcp_keepalives_*` settings on Postgres are load-bearing for the same
reason: a connection severed _without_ a close leaves that lock held by a
backend nobody is using, and every replacement engine refuses to boot. Observed
idle for four hours once. With keepalives a severed holder is reaped in ~60s;
without them, never.
