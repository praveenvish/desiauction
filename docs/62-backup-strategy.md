# 62 — Backup Strategy

> Canon: C-13 · v1.0 · 2026-07-11

> **Implementation status — 2026-08-19.** This document was written as a design
> target and has been read as a statement of fact, including by release
> documentation. It is not one. **Nothing in the "Target state" sections below
> is provisioned.** There is no managed Postgres instance, no PITR window, no
> off-site dump, no pre-event snapshot and no weekly restore-verify job; no
> backup has ever been restored. What exists is one local drill script. The
> sections are now split so the difference is visible on the page
> (audit `docs/audits/FINAL-PRR/REPORT.md`, P2-8).

## What is implemented today

| Thing | Reality |
|---|---|
| `pnpm --filter @desiauction/web db:restore-verify` | Dumps the database it is pointed at, restores that dump into a scratch database, compares **row counts per table**, destroys the scratch (`apps/web/scripts/restore-verify.ts`). Source counts are taken inside a repeatable-read transaction exporting `pg_dump`'s snapshot, so concurrent writes cannot skew the compare — that part is genuinely careful. |
| Nightly execution | Runs in `.github/workflows/nightly-verify.yml` (which needs a git remote to run at all). |
| Last measurement | 43/43 tables exact under concurrent write load, **2026-07-16** — before migrations 0015–0026. Stale; re-drill. |

What it therefore proves: `pg_dump` → `pg_restore` is row-count-lossless on this
schema. What it does **not** prove, despite being cited as the backup evidence in
several release documents: it never reads a stored backup, it does not touch
PITR, it does not replay the audit hash chain, it does not run a
projection-vs-ledger checksum, and **it pages nobody** — the exit code is read by
a CI step and nothing else. Backup *restorability* is unproven.

## Target state (not yet provisioned)

Everything in this section is a founder-held provisioning item
([PRODUCTION_CHECKLIST](operations/PRODUCTION_CHECKLIST.md) §2), not a
description of the running system.

| Layer | Mechanism | Frequency | Retention | Status |
|-------|-----------|-----------|-----------|--------|
| PITR | Managed WAL streaming | Continuous | 14 days | ☐F not provisioned |
| Full logical | `pg_dump -Fc` to versioned object storage (separate account/credentials from prod — ransomware isolation) | Daily 03:00 IST | 35 daily, 12 monthly | ☐F not provisioned |
| Pre-event snapshot | Automatic snapshot when any tournament enters `AuctionReady` (44) | Per event | 90 days | ☐ not built — no code path takes a snapshot on any state transition |
| Cross-region | WAL + daily dump replicated to second Indian region | Continuous/daily | Mirrors above | ☐F not provisioned |
| Config/infra | IaC in git; secrets store versioned | On change | Git history | ☐ partial — config is in git, there is no IaC and no secrets store |

The **pre-event snapshot** is the product-specific move, and it is the one worth
building first: every auction night should start from a known restore point taken
minutes before money moves. It is also the only thing that would give a
destructive migration a rollback path on auction day
([DEPLOYMENT §Rollback](operations/DEPLOYMENT.md#rollback)).

## Verification (backups are only real when restored) — target

Also unbuilt. Stated as the goal, not as a running job:

- **Automated restore-verify job** (53): weekly, restores the latest daily dump into a scratch database, checks row counts on key tables, replays the audit hash chain (48), runs the projection-vs-ledger checksum (56), then destroys the scratch. Failure pages. *(Today: the nightly job does the row-count half against a self-made dump, and failure notifies nobody.)*
- Quarterly **human drill**: full PITR restore to a point mid-simulated-auction on staging, timed against the RTO (61), evidence recorded. *(Never executed — there is no staging and no PITR.)*
- Backup success/failure and restore-verify results are first-class monitors (56) — a silently failing backup is the classic silent failure (C-2). *(No monitoring backend exists; see docs/56.)*

## Rules (policy — apply when the target state is provisioned)

- Backups inherit production's data classification: encrypted at rest, access audited (49), same DPDP obligations; erasure requests propagate to backups by key-scoped crypto-shredding where supported, documented retention override where not (49, publicly stated).
- Exports (user-initiated, invariant 33) are not backups and never treated as such; likewise backups never serve product features (no "restore my deleted thing" support theater from backups — the domain keeps its own history, 38/48).
- Restore authority: two-person rule for production restores; every restore is an audited break-glass event (48).
