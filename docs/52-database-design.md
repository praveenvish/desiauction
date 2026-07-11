# 52 — Database Design

> Canon: C-13 · v1.0 · 2026-07-11

## Platform

PostgreSQL 16+ (managed, Mumbai region — Neon primary candidate, decision at Phase 2 with exit-cost analysis), **Drizzle ORM** (typed SQL-first, explicit migrations), one database, schema-per-concern namespacing (`app`, `ledger`, `audit`, `jobs`).

## Conventions

- **IDs:** ULID (sortable, unguessable, URL-safe) as `text` PKs; no serial IDs on anything user-visible.
- **Tenancy:** `org_id` NOT NULL on every tenant row (invariant 1); composite indexes lead with `org_id`; **RLS enabled on all tenant tables** with session-set `app.org_id` — defense-in-depth under the application checks (C-13, 49).
- **Money:** `bigint` paise (C-7); no numeric/float money anywhere; CHECK ≥ 0 where signed values are illegal.
- **Time:** `timestamptz` UTC everywhere; `created_at`/`updated_at` standard; no client-supplied times on money paths (41).
- **Soft delete: no.** The domain either keeps facts forever (ledger, audit, invoices) or deletes cleanly (pre-money drafts, 44). `deleted_at` ambiguity is refused; archival is a state, not a flag hack (39).
- Naming: snake_case, singular tables (`tournament`), `_id` suffixes, enum types as Postgres enums generated from `packages/core` machines (one source, 39).

## Immutability with teeth (the signature move)

`ledger.auction_events`, `audit.audit_events`, `app.invoices`: the runtime database role has **INSERT + SELECT only** — no UPDATE/DELETE privilege exists to be exploited (invariants 10, 24, 28). Compaction/archival runs under a separate maintenance role with change control (63).

Ledger table core:

```sql
create table ledger.auction_events (
  auction_id text not null,
  seq bigint not null,
  id text not null unique,        -- ulid
  org_id text not null,
  type text not null,
  actor jsonb not null,
  payload jsonb not null,
  schema_version int not null default 1,
  occurred_at timestamptz not null default now(),
  prev_hash bytea, hash bytea not null,   -- 48 chain
  primary key (auction_id, seq)
);
```

## Projections

Read-model tables (`lot`, `bid`, `purchase`, `team_purse`, `notification_feed`…) are rebuildable from the ledger (61); updated in the same transaction as their source event within an auction (51). A `projection_checkpoints` table tracks rebuild positions. **Nothing joins the ledger at request time** — requests hit projections; the ledger serves append, audit, replay, and export.

## Structural invariant enforcement (40 mapping)

- Invariant 18: `unique (tournament_id, owner_person_id)` on ownerships.
- Invariant 2: org owner count enforced by trigger-guarded revocation (the last `org:manage-full` grant cannot revoke).
- Invariant 3: `unique (verified_mobile)` on persons; registrations unique `(tournament_id, person_id)`.
- Invariant 24: payments FK NOT NULL to invoices.
- Readiness facts (invariant 15) are queries over real state, never cached booleans.

## Migrations

- Drizzle SQL migrations, linear, in-repo, reviewed like code; **expand → migrate → contract** for anything touching live data; destructive migrations require an explicit `-- destructive:` acknowledgment token the CI gate checks (59).
- Every migration runs against a production-shaped fixture DB in CI (58); rollback scripts required for schema (not data) changes.
- Migrations never run during live windows (C-22, 60).

## Scale posture (honest sizing)

A big tournament: ~400 players, ~2,000 bids, ~10k events — *tiny* data, spiky reads. Design for **read fan-out** (Stage: thousands of viewers), not write volume: projections + engine memory + CDN on public reads (54). Partitioning `auction_events` by auction_id hash is a someday-lever, documented, not built (03 §11 simplicity).
