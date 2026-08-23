# Rehearsal harness

Real-browser tooling written for the **RH-1 production rehearsal**
([docs/audits/RH-1/REPORT.md](../../../docs/audits/RH-1/REPORT.md), 2026-08-22).

This is **not** the e2e suite. The e2e suite proves the product does what it was
built to do, against fixtures it created. These scripts drive the product the way
an auction night will — several independent people on several devices at once,
against a dataset that already exists — and they found nine defects the suite
could not see, because the suite never had two humans in the room at the same
time.

They are kept because the questions they answer come back before every release.

## Running

Point them at a running server. They read OTP codes from the database rather
than from `/dev/inbox`, so they work against a production build:

```sh
# terminal 1 — infra + a production build
pnpm setup:local
pnpm --filter @desiauction/web build
ALLOW_INSECURE_LOCAL_PRODUCTION=1 PORT=3100 \
  pnpm --filter @desiauction/web start

# terminal 2 — the engine
pnpm --filter @desiauction/engine dev

# terminal 3 — a script
cd apps/web
node --env-file-if-exists=../../.env.local node_modules/tsx/dist/cli.mjs \
  rehearsal/responsive-sweep.ts
```

`REHEARSAL_BASE` overrides the target (default `http://127.0.0.1:3100`).

## What each one is for

| Script                         | Question it answers                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `responsive-sweep.ts`          | Does any of 19 screens overflow, error or ship a sub-24px target, at 8 widths? (152 combinations)         |
| `concurrent-bidding.ts`        | Six devices raise within ~30ms of each other — does exactly one bid land, and do all six converge?        |
| `auction-run.ts`               | Drive a whole auction through the cockpit and six live rooms; reports per-lot and bid-propagation latency |
| `authz-probe.ts`               | What can a captain, a signed-in stranger and an anonymous visitor actually reach?                         |
| `cross-surface-consistency.ts` | Does one sold player read the same on all eleven surfaces that mention them?                              |
| `resilience.ts`                | Refresh, back, duplicate tab, offline→online, pause/resume — mid-lot                                      |
| `mobile-action-rows.ts`        | Measures every multi-control row on a phone: equal widths? thumb-sized?                                   |
| `mobile-row-height.ts`         | Registration row height and players-per-screen                                                            |
| `smoke.ts`                     | Every surface, three roles, looking for a 404 or a crash                                                  |

Shared parts: `lib.ts` (sign-in, OTP, observers), `captains.ts` (seats N
independent browser contexts), `register-player.ts` (drives one player through
the public form), `make-roster.ts` / `make-photos.ts` (dataset generators).

## Dataset

The auction and consistency scripts read `artifacts/season.json` and
`artifacts/cup.json`, written by the setup scripts during a rehearsal.
`artifacts/` and `mobile/` hold screenshots and metrics and are **gitignored** —
a rehearsal produces about 40 MB of them.
