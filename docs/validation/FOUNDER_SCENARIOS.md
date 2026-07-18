# Founder Acceptance Scenarios (PVP-1)

Six permanent demonstrations, each executable locally with one command and no
engineering intervention. Prerequisites (once): `docker compose up -d`,
`pnpm install`, migrations applied (`pnpm --filter @desiauction/db db:migrate`,
then `pnpm --filter @desiauction/engine db:migrate`).

All `demo:*` commands run from `apps/web`. The `--headed` demos open real
browser windows and drive the real web server plus the real auction engine
(Playwright boots both automatically; no need to run `pnpm dev` first).
OTP codes appear at `http://localhost:3050/dev/inbox` during headed runs.

| # | Scenario | Command (from `apps/web`) | What the founder sees |
|---|----------|---------------------------|------------------------|
| 1 | Small tournament | `pnpm demo:tournament-small` | Create competition → teams → open intake → player registers → approve → close intake. |
| 2 | Medium tournament | `pnpm demo:tournament-medium` | CSV import of players, operations dashboard (search/filter/bulk/export/audit), fixtures & venues scheduling with conflict checks. |
| 3 | Full auction night | `pnpm demo:auction-night` | Auction created from the closed competition; 1 organizer + 3 bidder browsers: paddle claims, live bidding, last-second anti-snipe extension, gavel, ceremony close-out. |
| 4 | Failed payment recovery | `pnpm demo:payment-recovery` | Scripted (terminal): gateway order → failed webhook → refusal recorded → retry → capture → discharge; forged/stale webhooks rejected. 16 checks. |
| 5 | Fiscal close | `pnpm demo:fiscal-close` | Scripted (terminal): receipts/invoices issued, documents reproduced byte-identical, day attested, period sealed with evidence, supervisor green. 77 checks. |
| 6 | Operational recovery | `pnpm demo:operational-recovery` | Mid-auction the engine process is killed and restarted; every browser reconnects and converges on the identical snapshot. |

Database recovery drill (part of scenario 6, run from repo root; uses the
Postgres 17 tools inside the container — host `pg_dump` may be older):

```sh
docker exec desiauction-next-db-1 sh -c '
  pg_dump -U desiauction -Fc desiauction -f /tmp/drill.dump &&
  psql -U desiauction -d postgres -c "DROP DATABASE IF EXISTS drill_verify" -c "CREATE DATABASE drill_verify" &&
  pg_restore -U desiauction -d drill_verify --no-owner /tmp/drill.dump &&
  echo RESTORE_OK'
```

Verified 2026-07-16: dump 1.6 MB in 0.40 s, restore 0.33 s, 43/43 tables with
exact row counts identical to the source (see PVP-1_REPORT §5).

Certification status: every scenario above ran green during PVP-1 on
2026-07-16 (e2e: 46 passed; scripted demos: 16 + 77 checks). Re-certify by
running the commands; they are the same suites CI runs.
