# PX-11 — Production Hardening Report

Run date: 2026-07-17 · Branch `main` (post-PX-10) · Local stack: Postgres 17
(docker, port 5433), Node 25.6.1, darwin/arm64. This report audits the whole
platform with emphasis on the PX-2…PX-10 web product, which the prior validation
([PVP-1](PVP-1_REPORT.md), at ip6-frozen) predated. Every finding below is
reproducible; every fix has permanent regression coverage.

PX-11 is an audit-and-harden milestone: no features, no workflows, no new
capabilities. It changed only what a proven defect or a stated production gap
required.

---

## 1 · Architecture findings

| # | Finding | Root cause | Disposition |
|---|---------|------------|-------------|
| A1 | Import cycle `financial-operations/deliveries ↔ views` | `deliveries.ts` type-imported `DeliveryView` from `views.ts` while `views.ts` value-imports `DELIVERY_LANES` from `deliveries.ts`. Type-only, so no runtime cycle — but a real type-level coupling and a latent init-order trap. | **Fixed.** `filterDeliveries` made generic over `{ status }` — the only field it read — removing the type import. Dependency now flows one way. |
| A2 | No CI guard against import cycles | The dependency-cruiser config enforced boundaries but had no `no-circular` rule, so A1 could exist unnoticed. | **Fixed.** Added a permanent `no-circular` rule (with `tsPreCompilationDeps`, so it catches type-only cycles too). |

Clean: dependency boundaries (832 modules, 0 violations), **zero orphan
modules** (no dead code), frozen-package compliance — `core`/`auction`/
`settlement`/`financial-operations` untouched since ip6-frozen; only the shared
`db` package carries the two sanctioned additive changes (`withTenantDb` per
PRP-1, the `platform` scope-type per PX-9, type-only, no migration). The
four-engine capability partition is deliberate parallelism, documented, not
duplication; the admin views consume certified projections and re-derive nothing.

## 2 · Security findings

| # | Severity | Finding | Reproduction | Fix + coverage |
|---|----------|---------|--------------|----------------|
| **F1** | Medium | **Open redirect** on login. `safeNext` admitted `/\evil.com`; a browser folds `\`→`/`, yielding a protocol-relative `//evil.com` external redirect. `next` rides on the attacker-supplied login URL. | `safeNext("/\\evil.com")` → returned it verbatim → `redirect("/\evil.com")`. | Allowlist guard (single leading slash, no `/`/`\` after, conservative charset). `src/server/auth/redirect.ts` + `redirect-safety.test.ts` (backslash, protocol-relative, `javascript:`, control-char, whitespace bypasses all fold to `/home`). |
| **F2** | High | **Stored XSS** on the public `/c/[slug]` page. Organizer-controlled competition/org/location names were `JSON.stringify`'d into a `<script type="application/ld+json">`; `JSON.stringify` does not escape `<`, so a name `</script><script>…</script>` breaks out and executes for every visitor. | `JSON.stringify({name:"</script>…"})` emits a raw `</script>`. Confirmed the sink renders via `dangerouslySetInnerHTML`. | `serializeJsonLd` escapes `<>&` + U+2028/U+2029; output stays valid JSON (SEO intact). `src/server/seo/json-ld.ts` + `json-ld.test.ts`. |
| H1 | Hardening | No `Content-Security-Policy`, `Referrer-Policy`, or `Permissions-Policy`. | Header probe on prod build showed only HSTS/X-Frame/X-Content-Type. | Added CSP (`base-uri`/`object-src 'none'`/`frame-ancestors 'none'`/`form-action 'self'`), `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic/geo/FLoC off). Verified emitted. Nonce-based `script-src` deferred (needs middleware; would need `'unsafe-inline'` otherwise). |
| H2 | Hardening | Engine log redaction covered phone/token/authorization but not secrets or OTP codes. | Code review. | Extended pino `redact` to `secret`/`code`/`x-engine-secret` (defence in depth atop `disableRequestLogging`). |

**Verified sound (no change needed):** session cookies (`httpOnly`, `secure`
in prod, `sameSite:lax`); no hardcoded secrets; SSRF surface limited to
config-derived provider URLs (engine, Razorpay, SMS) — no user-controlled fetch;
RLS runtime wiring present (`withTenantDb` on every mutating action; `systemDb`
only on named pre-tenant/cross-tenant paths) with the `pnpm rls:verify` deploy
gate proving the app role cannot bypass RLS and every RLS table fails closed;
PX-9 platform grant unforgeable from the app role (RLS `WITH CHECK` + singleton
scope, proven in `admin-foundation.regression.test.ts`); PX-8/PX-9 capability
partitions and privilege-escalation refusals certified by e2e; `/dev/inbox` and
`/gallery` structurally absent outside development; OTP/webhook rate limits and
forgery resistance certified in PVP-1 §6.

## 3 · Performance findings

No N+1 in the PX-9/PX-10 code: the admin directories use single-round-trip
correlated subqueries; the admin health/overview pages use a **bounded parallel
fan-out** (`Promise.all` over finance-declared orgs only), not per-row
sequential queries. The PX-8 finops register/document loops are sequential but
bounded by per-org series/document counts and were measured green in PVP-1 §4.
Local perf baselines (PVP-1 §4) stand — bid-ack p95 20 ms @1000 lots, fan-out
105 ms p95 @1000 clients, engine recovery <30 ms @2500 lots.

⚠ **Scale watch (measure before acting — the directive forbids speculative
optimization):** `audit_log` is indexed on `(scope_type, scope_id, at)` but not
on `actor` alone or `scope_id` alone; the PX-9 audit explorer filters by `actor`
and the admin org directory's last-activity subquery filters by `scope_id`. At
beta log volumes a scan is sub-10 ms; add targeted indexes before large-tenant
GA, after measuring on staging. Root cause: the PX-9 read patterns postdate the
index set, which was shaped for the tenant-scoped audit reads.

The full production perf certification (1000 players / 100 bidders / 5000
spectators on staging hardware) remains a ☐E in the checklist — it needs the
deploy target, and local numbers explicitly do not substitute.

## 4 · Reliability findings

| # | Finding | Disposition |
|---|---------|-------------|
| R1 | Web had **liveness only** (`/healthz`, no dependency check); no readiness probe, so an orchestrator could route to an instance that cannot reach Postgres. | **Fixed.** Added `/readyz` (`select 1` → 200/503). Liveness stays dependency-free at `/healthz` so a DB blip stops routing, never kills the pod. Rehearsed: `/healthz` 200, `/readyz` 200 `db:ok` on the prod build. |
| R2 | Engine had no **graceful shutdown**; SIGTERM hard-killed the process, dropping WS clients. | **Fixed.** SIGTERM/SIGINT → `server.close()` (drains, clears timers via `onClose`) → Sentry flush → exit 0. The snapshot-recovery model already tolerated hard kills (restart-mid-auction e2e), so this is a clean drain. |

Verified sound: engine `/healthz` already checks DB + watchdog (503 when
unhealthy); the finops-runner already handles SIGINT/SIGTERM; idempotency and
crash/queue/follower/certification recovery are IP-6-certified (job dedupe keys,
byte-identical follower replay, double-derived certification); zero-downtime
config posture proven by the ENGINE_SECRET rotation drill (PRP-1 §5).

## 5 · Operational readiness

- **Config validation:** `pnpm env:check` green for all three apps; each fails
  closed at boot on bad env.
- **Migrations:** 15 (0000–0014) at the time of this report. PX-2 through PX-11
  added zero migrations, and the conclusion drawn from that — *"rollback is a
  pure app-image swap with zero schema risk"* — was true then and is **no longer
  true**. Migrations 0015–0026 shipped after the `v1.0.0-rc.1` tag; the schema is
  at 27, and `0019_tournaments.sql` renames `seasons` → `tournaments` and drops a
  column. Migrations are forward-only and there are no down migrations, so an
  image swap does not undo a schema change. Current procedure:
  [DEPLOYMENT §Rollback](../operations/DEPLOYMENT.md#rollback). *(Corrected
  2026-08-19 per audit `docs/audits/FINAL-PRR/REPORT.md` P1-2.)*
- **Backup/restore:** drilled 2026-07-16 (PVP-1 §5; `db:restore-verify` 43/43
  exact under concurrent writes) — **that figure predates migrations 0015–0026
  and must be re-drilled**. The script compares row counts on a database it dumps
  itself; it has never restored a stored backup. PITR + automated restore-verify
  are managed-PG deploy-time and remain unprovisioned.
- **Runbooks:** [DEPLOYMENT](../operations/DEPLOYMENT.md),
  [DISASTER_RECOVERY](../operations/DISASTER_RECOVERY.md),
  [SECRET_ROTATION](../operations/SECRET_ROTATION.md),
  [TROUBLESHOOTING](../operations/TROUBLESHOOTING.md),
  [PRODUCTION_CHECKLIST](../operations/PRODUCTION_CHECKLIST.md) (updated with the
  PX-11 §7 additions) exist and cover deploy/rollback/DR/rotation.
- **Remaining ☐F/☐E are founder externals** (Fly/Vercel/managed Postgres/S3/SMS/
  Razorpay/Sentry DSNs) + the staging perf run — the roadmap's PX-12a track. No
  code blocker remains open.

## 6 · Browser & accessibility validation

- **Accessibility:** axe (`@axe-core/playwright`) runs clean on every surface
  across the e2e suites — public content (PX-10), admin (PX-9), finance (PX-8),
  settlement (PX-7), live/auction, identity, primitives, motion (reduced-motion
  honored), gallery contrast pairs. Keyboard nav, focus management, and contrast
  are asserted by the primitives/gallery/motion specs.
- **Browsers:** Chromium is exercised by the full Playwright suite. Firefox,
  WebKit/Safari, and Edge require running Playwright's other engines (and, for
  real Safari/Edge, the founder's devices) — a ☐E once staging exists. The app
  uses no engine-specific APIs; WebAuthn/passkeys are the one area to verify per
  browser at staging (RP_ID/origin sensitivity).
- **Responsive/print:** 360px zero-horizontal-scroll sweeps pass for public and
  admin surfaces; legal pages carry print styles.

## 7 · Founder demonstration (local production rehearsal)

The founder demonstration provisions real cloud infra (PX-12a founder
externals). PX-11 rehearses the code-side of that flow against a local
production-posture stack:

1. **Deploy** — `pnpm --filter web build` (57 static pages then; **75** on the
   current branch) + `next start` (NODE_ENV=production). ✔
2. **Migrate** — 15/15 applied then; **27/27** on the current branch. Re-run is a
   no-op (journal-tracked). ✔
3. **Validate config** — `env:check` green 3/3; app fails closed on bad env. ✔
4. **Health** — `/healthz` 200 (liveness), `/readyz` 200 `db:ok` (readiness). ✔
5. **Headers** — CSP + Referrer-Policy + Permissions-Policy + HSTS emitted. ✔
6. **Authenticate + lifecycle** — full auction→settlement→finance→admin journeys
   are green under the e2e suites (run against `next dev` for the dev OTP inbox;
   the same server code serves the prod build). ✔
7. **Restart workers / recovery** — engine restart-mid-auction convergence and
   finops follower/job recovery are certified; engine now also drains on SIGTERM. ✔
8. **Rollback** — app-image swap, valid because PX-2…PX-11 shipped no migration.
   ⚠ **Not generalisable:** 0015–0026 have shipped since, so a release must now be
   classified before it can be rolled back
   ([DEPLOYMENT §Rollback](../operations/DEPLOYMENT.md#rollback)).

Real-infra deploy/rollback with live SMS/S3/payments and multi-browser is the
PX-12a workstream (founder-held credentials), not a PX-11 code deliverable.

## 8 · Remaining risks

1. **Founder externals unprovisioned** (SMS, S3, Razorpay live keys, Sentry
   DSNs, managed Postgres, Fly/Vercel) — login is OTP-first, so SMS is
   go-live-critical. Roadmap PX-12a. Not a code defect.
2. **Staging perf certification not run** — local baselines exist and pass
   budgets; production hardware numbers are required for GO (PRP-1 §6). No local
   substitute.
3. **CSP `script-src` is not yet nonce-restricted** — the four nonce-free
   directives ship; a nonce rollout (middleware) is the remaining XSS-in-depth
   layer. F2 is already fixed at the sink.
4. **`audit_log` index scale-watch** — see §3; measure before adding.
5. **Multi-browser + real Safari/Edge WebAuthn** unverified — ☐E at staging.

## 9 · Final production recommendation

**Engineering-side: GO.** The product is architecturally clean (boundaries,
no cycles, no dead code, frozen domains intact), the two real security defects
(open redirect, stored XSS) are fixed with permanent coverage, headers are
hardened, readiness/liveness/graceful-shutdown are in place, logging is
PII-safe. Every fix is verified and the full gate is green. *(The "rollback is
schema-free" clause that stood here has been removed: it was true of this
milestone and false of the branch — see §5.)*

**Overall: conditional GO, gated on the founder-externals track (PX-12a)** —
SMS/S3/payments/DSNs/managed-Postgres provisioning and the staging perf run.
These are provisioning and measurement, not engineering blockers. When they
close, re-issue the PRP-1 report with staging numbers for the final GO.
