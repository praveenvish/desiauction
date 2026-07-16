# IP-6 — FINANCIAL OPERATIONS · REVIEW PACKAGE

## DesiAuction NEXT · v1.0 · 2026-07-16 · CTO · the reviewer's index

Every claim the freeze makes, paired with the command that re-derives it.
Prerequisites: Docker Postgres up (`docker compose up -d db`), `pnpm install`.
Nothing below trusts a cached result.

## 1 · Static gates

```
pnpm verify                      # typecheck + lint + unit + format + depcruise
pnpm turbo run test --force --concurrency=1
pnpm build --force
```

## 2 · The hostile suites (77 permanent regressions, live PG17)

```
pnpm --filter @desiauction/web test:integration
```

Runs all four finops suites WITH the frozen identity/competition/auction/
settlement suites (261 total). Read the suites as the certification script:

| Suite | What it attacks |
|---|---|
| `financial-operations-foundation` | catalog closure · duplicate commands · follower rewind/byte-identity · tamper→halt→heal · unhealable logs · runner retries/leases/dead letters · schedule idempotency · three-way capability partition · RLS on all ten tables · the settlement boundary meter |
| `financial-operations-documents` | quotes off frozen folds · dense numbering · fiscal legality · watermark coverage · one-cause-one-document · posture gate · auto-receipt derived ids · corrections (linkage, no chaining) · competent forgery unmasked by reproduction · register rebuild byte-identity |
| `financial-operations-delivery` | duplicate dispatch · duplicate/late/out-of-order callbacks · retry storms (exactly-one send) · exhaustion → terminal event · unknown provider → dead letter → gated requeue · unreproducible documents never delivered/exported · artifact tamper/delete → heal · daily export idempotency |
| `financial-operations-governance` | false health · watermark corruption · stale-payment sweep supervision · the 8-check day · evidence v2 seal + reproduction across reopen/new-documents/re-close · forged evidence row · duplicate & forged certification · year-end replay |

## 3 · Determinism, evidence and certification reproduction

Inside the suites (assertions, not demos): every stream folds twice to
identical bytes; every document re-renders to its sealed digest; every fiscal
seal re-derives from pinned prefixes (including historical seals after
reopens); `certifyOperations` derives twice to one digest and its register
exposes planted claims.

## 4 · Migration replay from an empty database

```
createdb ip6_replay && DATABASE_URL=postgres://…/ip6_replay \
  pnpm --filter @desiauction/db db:migrate
# expect: 15 migrations · 42 tables · 35 RLS policies
```

## 5 · Performance (measured, self-cleaning)

```
pnpm --filter @desiauction/web perf:finops
```

Reproduces the [IP-6_FREEZE](IP-6_FREEZE.md) §4 table on your hardware.

## 6 · Runner boot

```
pnpm --filter @desiauction/finops-runner build
DATABASE_URL=… node apps/finops-runner/dist/index.mjs   # SIGTERM to stop
```

## 7 · Zero-diff audit

```
git diff ip5-frozen -- packages/core packages/auction packages/settlement \
  packages/ui apps/engine apps/web/src/server/auction \
  apps/web/src/server/settlement apps/web/src/server/orgs \
  apps/web/src/server/auth apps/web/src/server/competition   # → empty
for f in 0000…0013; do git diff ip5-frozen -- packages/db/migrations/$f.sql; done  # → empty ×14
git diff ip5-frozen -- packages/core/src/capabilities.ts packages/settlement/src/events.ts  # → empty
```

## 8 · Where to read

[IP-6_ARCHITECTURE](IP-6_ARCHITECTURE.md) (+§30 reconciliation) ·
[EVENT_CATALOG](EVENT_CATALOG.md) · [ADRS](ADRS.md) (the 14 constraints a
thaw must answer) · [SECURITY](SECURITY.md) (the attacker model) ·
[RUNBOOKS](RUNBOOKS.md) (operations + the five pre-deploy items) ·
[IP-6_FREEZE](IP-6_FREEZE.md) (evidence) ·
[IP-6_CLOSURE_REPORT](IP-6_CLOSURE_REPORT.md) (judgments) · milestone reports
M-IP6-1…4.

## 9 · The reviewer's brief (the D-3 mandate)

Do not admire; re-attack the conclusions. The named soft spots to probe
first: the ADR-14 seal/certificate split · the quoted (non-re-derivable)
dispatch telemetry inside evidence v2 · the sealed-digest export-verification
semantics (ADR-9) · supervisor thresholds as constants · the deferred
doc-impact attention policy. Each is a recorded decision, not an accident —
prove one wrong and it is a defect; agree, and freeze stands.
