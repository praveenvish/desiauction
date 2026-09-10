# Known Limitations — Public Beta (RC-1)

Honest, current-state limitations of the platform entering controlled public
beta. None is a defect; each is a deliberate boundary or a founder-external
dependency. Track closure in [PRODUCTION_CHECKLIST](PRODUCTION_CHECKLIST.md).

## Provider dependencies (founder-provisioned)

| Area | State | Impact | Closure |
|------|-------|--------|---------|
| SMS (OTP) | Adapter built (`msg91`); no live account wired locally | **Login is OTP-first — SMS is go-live-critical.** Without it, nobody can sign in. | Founder provisions MSG91 (or equiv); set `OTP_PROVIDER=msg91` + creds; preflight enforces it. |
| Object storage | Local filesystem adapter; S3-compatible store not wired | Finops artifacts (receipts/invoices/exports) persist on the instance disk, not durable object storage. | Founder provisions S3-compatible bucket; set `FINOPS_STORAGE_DIR` to it. |
| Payments | Razorpay adapter built + forgery-tested; never run against the live gateway | Gateway collection unavailable; **manual capture (cash/UPI/bank) works fully** and is the beta path. | Founder provisions Razorpay live keys + webhook secret; one live staging transaction. |
| Email | Not implemented (deliberately out of scope) | No email notifications; in-app inbox + SMS are the channels. | Post-beta; the finops dispatch port already models the channel. |
| WhatsApp | Not implemented | No WhatsApp notifications. | Post-beta; dispatch port models it. |
| Error tracking | Sentry wired (guarded); DSNs not set locally | Missing DSN is a silent no-op — errors are not captured until set. | Founder sets `SENTRY_DSN` in web + engine. |
| Metrics/alerting | Designed (docs/56 SLOs); not provisioned | No dashboards or alerts until deploy-time. | Founder provisions on Fly/Vercel; wire alert-on-silence. |

## Platform boundaries (by design, for beta)

- **Financial-operations governance is not in beta (founder decision D3,
  2026-09-04).** Receipts and invoices work: declare a profile, open a numbering
  series, issue documents, and the follower auto-issues receipts for captured
  payments. What does NOT ship is the governance lifecycle above them — opening
  a fiscal period, daily attestation, exceptions, and the year-end seal.
  Concretely: no surface calls `openPeriod`, so `runDailyOps` returns early on
  every runner tick and no day is attested; `viewer.canClose` is computed and
  rendered nowhere. The code is present and tested — this is a scoping decision,
  not a gap to be discovered. It ships once a real organizer has a real
  financial year to close. Audit PA-1 found this as an unreachable lifecycle
  (§24); it is now a stated boundary.


- **Free tier caps**: 4 teams / 40 players per tournament (paid tiers publish at GA).
- **Single region**: managed Postgres + apps in one region (Mumbai target). No multi-region failover.
- **No self-serve platform-admin grant**: `platform.admin` is seeded by script only (`seed:admin`); there is no UI to issue it. Intentional (PX-9).
- **Competition settings**: lifecycle control lives on the Overview page; there is no separate Settings/branding tab (PX-1 §7.3 — backend for competition edit is frozen).
- **Legal documents are beta drafts**: structure is final; wording is under legal review (each page says so, with a version). Ratify before GA.
- **Help screenshots**: articles are text-complete; per-step screenshots are content debt pending the built shell (PX-1 §13).

## Scale watch (measure before acting — not blockers at beta scale)

- `audit_log` has no index on `actor` or `scope_id` alone; the platform-admin
  audit explorer and org directory filter by these. Sub-10 ms at beta volumes;
  add targeted indexes before large-tenant GA, after measuring on staging.
- Web DB pool `max: 10`; the admin health page fans out one snapshot set per
  finance-declared org in parallel. Fine at beta scale; size against the staging
  perf run.
- **Production perf certification not yet run** on production hardware. Local
  baselines (PVP-1 §4) pass all budgets but do not substitute.

## Verification gaps requiring the deploy target

- **Real cross-browser**: ~~Chromium is green across the full e2e suite~~ —
  **WEBKIT/SAFARI IS NOW GREEN TOO** (2026-09-10). `playwright.config.ts`
  declares `chromium` and, behind `E2E_WEBKIT=1`, `webkit`; the nightly runs
  both. The first WebKit run found **zero product defects** in 101 specs: five
  harness races Chromium had been winning by luck, one Apple keyboard default,
  one Chromium-only WebAuthn API. All fixed or scoped at source.

  **Firefox is green too** (104 passed on its first run; the one failure was a
  test that spoofed a second device as "Firefox on Windows" — what Playwright's
  own Firefox calls itself — so it could not tell the revoked row from the one
  it was sitting on).

  **BUT NEITHER RUNS IN THE NIGHTLY, and that is deliberate.** Across two full
  405-test three-engine runs of the same code they produced DIFFERENT failures
  each time, all in the live-auction path (engine service + WebSockets);
  Chromium had zero failures across all four full runs. An intermittently red
  nightly teaches everyone to ignore it. Both stay opt-in (`E2E_WEBKIT=1`,
  `E2E_FIREFOX=1`) for deliberate use and go back into the nightly when that
  flakiness is understood. **Chromium remains the certified engine.**

  Still open: that live-auction flakiness on non-Chromium engines, **Edge**, and
  **real Safari/Edge WebAuthn**, which needs the founder's devices at staging
  because `passkeys.spec.ts` drives a Chrome DevTools Protocol virtual
  authenticator that has no cross-engine equivalent.
- **Real provider latencies** (SMS delivery time, S3 upload/download, live
  webhook round-trip): measured only against the live accounts.
