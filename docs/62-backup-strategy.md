# 62 — Backup Strategy

> Canon: C-13 · v1.0 · 2026-07-11

## Layers

| Layer | Mechanism | Frequency | Retention |
|-------|-----------|-----------|-----------|
| PITR | Managed WAL streaming | Continuous | 14 days |
| Full logical | `pg_dump -Fc` to versioned object storage (separate account/credentials from prod — ransomware isolation) | Daily 03:00 IST | 35 daily, 12 monthly |
| Pre-event snapshot | Automatic snapshot when any tournament enters `AuctionReady` (44) | Per event | 90 days |
| Cross-region | WAL + daily dump replicated to second Indian region | Continuous/daily | Mirrors above |
| Config/infra | IaC in git; secrets store versioned | On change | Git history |

The **pre-event snapshot** is the product-specific move: every auction night starts from a known restore point taken minutes before money moves.

## Verification (backups are only real when restored)

- **Automated restore-verify job** (53): weekly, restores the latest daily dump into a scratch database, checks row counts on key tables, replays the audit hash chain (48), runs the projection-vs-ledger checksum (56), then destroys the scratch. Failure pages.
- Quarterly **human drill**: full PITR restore to a point mid-simulated-auction on staging, timed against the RTO (61), evidence recorded. (The reference program proved this exact rehearsal — `pg_dump → pg_restore → 7/7 row-count match` — as its recoverability milestone; here it's a standing job, not a milestone.)
- Backup success/failure and restore-verify results are first-class monitors (56) — a silently failing backup is the classic silent failure (C-2).

## Rules

- Backups inherit production's data classification: encrypted at rest, access audited (49), same DPDP obligations; erasure requests propagate to backups by key-scoped crypto-shredding where supported, documented retention override where not (49, publicly stated).
- Exports (user-initiated, invariant 33) are not backups and never treated as such; likewise backups never serve product features (no "restore my deleted thing" support theater from backups — the domain keeps its own history, 38/48).
- Restore authority: two-person rule for production restores; every restore is an audited break-glass event (48).
