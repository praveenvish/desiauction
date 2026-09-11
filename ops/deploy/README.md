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
- `minio.env` — `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` (read by both `minio`
  and `minio-init`)
- `pgbackrest.env` — credentials for the WAL archive **destination off this box**
- `.env` — `REGISTRY`, `TAG`, `PUBLIC_DOMAIN`, `ENGINE_DOMAIN`, `S3_DOMAIN`

### Object storage lives on this box

`minio` holds player photos and finops artifacts, and `minio-init` creates the
two buckets on every `up`. The web tier and the runner both reach it, which is
the thing a plain filesystem could not do for media: `LocalStorage` writes into
`public/_media` and serves it as a static path, but `public/` is baked at BUILD
time, so a built server never serves what was written there at runtime.

`S3_DOMAIN` needs its own DNS record (e.g. `s3.desiauction.in`) pointing at this
host, exactly like `PUBLIC_DOMAIN` and `ENGINE_DOMAIN`. It has to be a real
hostname rather than the internal `minio:9000`, because an AWS v4 signature
covers the Host header and the browser is the one making the upload request —
an endpoint the browser cannot reach produces signed URLs that are valid and
useless.

The matching app settings, in `web.env` and `runner.env`:

```sh
MEDIA_STORAGE=bucket
MEDIA_S3_ENDPOINT=https://s3.example.in
MEDIA_S3_REGION=us-east-1          # MinIO ignores it; the signer requires one
MEDIA_S3_BUCKET=desiauction-media
MEDIA_PUBLIC_BASE=https://s3.example.in/desiauction-media
MEDIA_S3_ACCESS_KEY_ID=...         # MINIO_ROOT_USER, or a scoped MinIO user
MEDIA_S3_SECRET_ACCESS_KEY=...

FINOPS_ARTIFACT_STORE=bucket
FINOPS_S3_ENDPOINT=https://s3.example.in
FINOPS_S3_REGION=us-east-1
FINOPS_S3_BUCKET=desiauction-finops
FINOPS_S3_ACCESS_KEY_ID=...
FINOPS_S3_SECRET_ACCESS_KEY=...
```

The media bucket is anonymously readable and the finops bucket is not — that
single difference is set by `minio-init` and is what makes a photo load in a
browser while a receipt register stays behind a signed URL.

**MinIO is not backed up by pgBackRest.** That sidecar archives Postgres WAL and
nothing else, so `minio_data` needs its own copy off this box. A player photo is
recoverable-ish; a finops artifact is a financial record.

Each app refuses to boot on bad env, so a missing value fails fast and loudly
rather than at a user's login.

## PITR is the only rollback, so prove it works

Migrations are forward-only. There are no down migrations and there never have
been, so the restore point is the only thing that can undo one. Migration 0058
already dropped `NOT NULL` on both `fixtures` side columns — once one lobby
exists, no image rollback recovers that.

pgBackRest archives WAL **off the box**. A backup on the same disk is not a
backup — and that is the one requirement a single-host topology cannot satisfy
by itself, so the archive destination is a decision that has to be made rather
than inherited. MinIO on this box does NOT qualify: it is the same disk.

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
