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
- `pgbackrest.env` — the WAL archive repo, read by BOTH `db` and `pgbackrest`
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
MEDIA_S3_ACCESS_KEY_ID=...         # MINIO_ROOT_USER, or a scoped MinIO user
MEDIA_S3_SECRET_ACCESS_KEY=...

FINOPS_ARTIFACT_STORE=bucket
FINOPS_S3_REGION=us-east-1
FINOPS_S3_BUCKET=desiauction-finops
FINOPS_S3_ACCESS_KEY_ID=...
FINOPS_S3_SECRET_ACCESS_KEY=...
```

`MEDIA_PUBLIC_BASE` and `FINOPS_S3_ENDPOINT` are NOT in that list on purpose.
They are derived — the public base from the endpoint and the bucket, the finops
endpoint from the media one, because a single-host deployment has one MinIO.
Both stay overridable; setting either wins. See "Values the domain decides".

### Values the domain decides

Four settings used to be `PUBLIC_BASE_URL` and `MEDIA_S3_ENDPOINT` written out
again in a different shape, and a fact typed twice is how two valid values come
to disagree:

| Derived              | From                                    |
| -------------------- | --------------------------------------- |
| `RP_ID`              | the hostname of `PUBLIC_BASE_URL`       |
| `RP_ORIGINS`         | the origin of `PUBLIC_BASE_URL`         |
| `MEDIA_PUBLIC_BASE`  | `MEDIA_S3_ENDPOINT` + `MEDIA_S3_BUCKET` |
| `FINOPS_S3_ENDPOINT` | `MEDIA_S3_ENDPOINT`                     |

`RP_ID` is why this matters more than tidiness. Nothing compared it to the URL
being served — here or in `preflight:production`, where the only test was "not
localhost" — so a domain typo passed every gate, deployed green, and silently
stopped every enrolled passkey from verifying. No error, no log line, no symptom
except people who cannot get in. An override is now checked against the real
host; a parent domain is still allowed, because that is how one credential
covers subdomains.

`ENGINE_ALLOWED_ORIGINS` is NOT derived: it lives in `engine.env`, a different
process that never sees the web tier's settings. Set it to the same origin as
`PUBLIC_BASE_URL` by hand.

The media bucket is anonymously readable and the finops bucket is not — that
single difference is set by `minio-init` and is what makes a photo load in a
browser while a receipt register stays behind a signed URL.

**MinIO is not backed up by pgBackRest.** That sidecar archives Postgres WAL and
nothing else, so `minio_data` needs its own copy off this box. A player photo is
recoverable-ish; a finops artifact is a financial record.

Each app refuses to boot on bad env, so a missing value fails fast and loudly
rather than at a user's login.

## PITR is the only rollback, and it is wired to the box

Migrations are forward-only. There are no down migrations and there never have
been, so the restore point is the only thing that can undo one. Migration 0058
already dropped `NOT NULL` on both `fixtures` side columns — once one lobby
exists, no image rollback recovers that.

Two things had to be fixed before any of this was true, and both were silent:

**`archive_command` runs inside the DATABASE container**, and `postgres:17-alpine`
has no pgbackrest. Every segment failed with exit code 127. Postgres does not
recycle a WAL segment until it is archived, so the symptom was never "backups
are missing" — it was a disk filling until the database stopped accepting
writes. Measured on the real image: 13 segments stuck `.ready`, 224MB of WAL
against a 64MB target, still climbing. The database image is now built from
`ops/deploy/db/Dockerfile` and carries pgbackrest.

**Archive settings cannot be passed on the postgres command line.** The
entrypoint starts a temporary server with those same flags to run initdb, and
with `archive_mode=on` and no stanza yet its shutdown waits forever for WAL it
cannot archive: "server does not shut down", and a first boot never completes.
They live in `postgresql.conf.d/10-archive.conf`, made live by an initdb script
that runs after initdb and before the real server.

### The repo is the MinIO on this box

A single-host deployment has nowhere else free to put it. Be exact about what
that buys:

- It DOES protect a bad migration, a dropped table, a bug that writes nonsense —
  the failure you are most likely to actually have.
- It does NOT protect the loss of the machine. The backups are on the disk they
  are backing up.

Moving `repo1` off the box later is a credentials change in `pgbackrest.env` and
nothing else. Until then, the honest description of this deployment is "one
machine, recoverable from its own mistakes, not from its own death".

pgBackRest needs TLS for an S3 repo — `repo1-storage-verify-tls=n` only skips
verification, it still speaks TLS, and MinIO here serves plain HTTP. So the repo
points at `S3_DOMAIN` through Caddy, which already holds a real certificate:
verification stays ON and there is no second certificate to manage.

```sh
PGBACKREST_STANZA=desiauction
PGBACKREST_PG1_PATH=/var/lib/postgresql/data
PGBACKREST_PG1_SOCKET_PATH=/var/run/postgresql
PGBACKREST_REPO1_TYPE=s3
PGBACKREST_REPO1_PATH=/pgbackrest
PGBACKREST_REPO1_S3_BUCKET=desiauction-backup
PGBACKREST_REPO1_S3_ENDPOINT=s3.example.in
PGBACKREST_REPO1_S3_KEY=...
PGBACKREST_REPO1_S3_KEY_SECRET=...
PGBACKREST_REPO1_S3_REGION=us-east-1
PGBACKREST_REPO1_S3_URI_STYLE=path
PGBACKREST_REPO1_RETENTION_FULL=2
```

`PG1_SOCKET_PATH` is not decoration. pgBackRest is a local tool: it reads PGDATA
directly and talks to the cluster over libpq, so the sidecar needs the socket as
well as the files. Without it, `stanza-create` fails with "unable to find
primary cluster" and the sidecar loops on an error that looks like a repo
problem and is not.

The sidecar runs `stanza-create` on every boot (idempotent), then `check`, then
a weekly full and a daily differential. Creating the stanza automatically is
deliberate: the step most likely to be skipped is the one that makes the rest
real.

### What was verified, and how

Against the real compose data plane, from an empty volume:

- first boot reaches healthy, `archive_mode` reads `on` from conf.d
- `pg_stat_archiver` reports archived 5, failed 0
- the sidecar creates the stanza, passes `check`, and takes a full backup
- with a row written AFTER that backup, the entire PGDATA was deleted and
  `pgbackrest restore` brought the cluster back **with that row** — it existed
  only in WAL, so this is point-in-time recovery and not a file copy

Re-run it on the production stanza before the first real auction and record the
RTO. `pnpm restore:drill` exercises the separate `pg_dump` path, not this one.

## Reading the logs

`docker compose logs` answers "what did this one container say", which is the
wrong question during an incident. An auction breaking at 9pm is web, engine and
runner interleaved, and matching three scrollbacks by eye is how a ten-minute
diagnosis becomes an hour. Everything already emits structured pino JSON;
nothing was collecting it.

**Every container's logs are capped.** Docker's default `json-file` driver has
NO size limit, so container logs grow until the disk is gone — the same ending
as the WAL bug, by a slower road and with no warning either. `x-logs` at the top
of the compose file sets three files of 20MB per service, so the whole stack is
bounded at roughly 500MB. That part is not optional and is not about
convenience.

**Loki holds thirty days**, single binary, local filesystem — no object store,
no clustering, no second database to keep alive during the incident it exists to
explain. Retention is enforced by the compactor; without `retention_enabled` the
`retention_period` is decorative and the disk ends where it would have anyway.

**Grafana is NOT exposed to the internet.** It binds to the host's loopback:

```sh
ssh -L 3001:localhost:3001 <user>@<host>
# then open http://localhost:3001
```

A public Grafana is another login to secure, another thing to patch, and another
way into a box that serves money. For one operator an SSH tunnel is both safer
and less work. The Loki datasource is provisioned from a file rather than
clicked, because a datasource configured by hand lives in `grafana_data` and
disappears the moment that volume is recreated — exactly when somebody is trying
to read logs in a hurry.

The query that earns the whole thing:

```logql
{job="docker", level="error"}          # every error, every service, one timeline
{job="docker", service=~"web|engine"}  # an auction, both sides, interleaved
```

`level` is pino's number named — 50 error, 40 warn, 30 info, 20 debug. Anything
that is not pino JSON (Caddy, Postgres, MinIO log plain text) is `unknown`
rather than a literal `<no value>`, which is what the first version produced.

Three things worth knowing before you rely on it:

- **Alloy reads the Docker socket**, which is how a container id becomes
  `engine`. `:ro` limits the file node, NOT the API — anything that can talk to
  that socket can control Docker. It is pinned by digest, reachable from nothing
  outside, and should be the first thing reconsidered if this box is ever shared
  with something less trusted.
- **It collects EVERY container on the host**, not just this stack. Correct for
  a dedicated box; surprising if you put a second project beside it.
- **These logs are on the box.** Like the backups, they are least available
  exactly when the machine is gone. Shipping them off-box is a Loki endpoint
  change, not a redesign.

## The engine is exactly one process

It claims a Postgres advisory lock at boot and a second instance refuses to
start. `replicas: 1` in the compose file is a statement of fact, not a tuning
choice — scaling it produces a crash loop, by design. Scale the web tier.

The `tcp_keepalives_*` settings on Postgres are load-bearing for the same
reason: a connection severed _without_ a close leaves that lock held by a
backend nobody is using, and every replacement engine refuses to boot. Observed
idle for four hours once. With keepalives a severed holder is reaped in ~60s;
without them, never.
