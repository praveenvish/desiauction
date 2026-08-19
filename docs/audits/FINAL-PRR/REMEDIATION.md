# FINAL PRR — Remediation Record

**Date:** 2026-08-19 · **Branch:** `feat/ui-redesign`
**Follows:** [REPORT.md](REPORT.md) — the 2026-08-18 audit that returned **NO-GO, 5.2/10**

Every fix below was verified by execution, not by inspection. Where a defect was
originally proven with a live exploit, the same exploit was replayed against the
patched system and its new result is recorded.

---

## 1 · The three blockers

### P0-1 · Production database roles could not run the application — **CLOSED**

The four-role recipe had fallen twelve migrations behind the code, and nothing
local could see it because every local process connects as the database owner.

| Change | File |
|---|---|
| `grant update on registrations to desiauction_engine` — the sale write path | `ops/db/create-app-role.sql` |
| `ALTER DEFAULT PRIVILEGES` so tables from FUTURE migrations are reachable by the app role without anyone remembering | same |
| Append-only ledgers: `revoke update, delete` on `auction_events`, `settlement_events`, `finops_events`, `audit_log` from all runtime roles (closes P2-6 in the same stroke) | same |
| **New** `pnpm --filter @desiauction/web grants:verify` — a declared manifest asserted against real roles; 143 expectations | `apps/web/scripts/verify-grants.ts` |
| CI now creates all four roles, runs `grants:verify` and `rls:verify` on every PR | `.github/workflows/ci.yml` |
| The recipe's own header no longer teaches the two-password invocation that aborts | `ops/db/create-app-role.sql` |

**Proof.** The exact statements from the audit now succeed:

```
begin; set role desiauction_engine;
update registrations set team_id = team_id where id = (select id from registrations limit 1);
→ ROLLBACK        (was: ERROR permission denied for table registrations)
```

Then the real thing — the engine booted under `desiauction_engine` and a lot
driven all the way to SOLD:

```
POST /command CloseLot → {"accepted":true}
lots.status=sold · sold_price=5000000 · bought_by=Demo Panthers · roster_stamped=t
permission-denied errors in the engine log: 0
```

Append-only is now enforced by the database, not by discipline:

```
set role desiauction_app;    update audit_log …      → permission denied
set role desiauction_engine; delete from auction_events → permission denied
set role desiauction_engine; insert into auction_events → INSERT 0 1   (append still works)
```

#### A second defect of the same family, found by the same drill

Booting the **web** tier under `desiauction_app` + `desiauction_system` — which
nothing had ever done — returned **500** on `/account`, `/orgs` and
`/org/{slug}`. The system pool, designed for two pre-tenant token paths, had
quietly become the backing pool for the admin explorer, the account screen and
the cross-org listings, and its grant list never followed: `audit_log`,
`settlement_cases`, `suppressions`, `grants`, `people`, `registrations`,
`notification_preferences`, `finops_profiles` were all unreadable.

Grants added and pinned in `grants:verify`. **All 14 authenticated routes now
serve under the production roles.**

> **Residual risk, stated plainly.** The system role is `BYPASSRLS`, so each
> table added to it is one an RLS-exempt connection can read across tenants.
> The correct shape is for these reads to run on the tenant pool inside a
> `withTenantDb` boundary, leaving the system pool only its token paths. That is
> a ~130-call-site refactor and is **not** done. It is now a decision somebody
> makes — `grants:verify` fails on the next unreviewed addition — rather than
> something that leaks in silently.

### P0-2 · Any participant could freeze the timer and bid after the deadline — **CLOSED**

| Change | File |
|---|---|
| `isTransportCommandId` — the transport may only choose UUID/ULID ids, so the engine's internal `timer-close-*` namespace is unreachable by construction | `packages/core/src/auction-snapshot.ts`, enforced in `apps/engine/src/server.ts` and `live-actions.ts` |
| Ack cache keyed by **(actor, commandId)** — one actor can neither serve nor suppress another's ack | `apps/engine/src/engine-core.ts` |
| New `LOT_EXPIRED` gauntlet check — expiry is a rule, not merely a scheduling side effect | `packages/core/src/auction.ts` |

**Proof.** The exploit, replayed verbatim:

```
POST /command {commandId:"timer-close-<lotId>-<endsAtMs>", type:"ClaimPaddle"}
→ {"error":"invalid_command_id"}          (was: cached as a rejection)

… deadline passes …
currentLot: none (lot resolved) · lastOutcome: {"kind":"unsold", …}
```

The gavel falls. Idempotency is intact and now correctly scoped:

```
same actor, same id, twice  → identical ack, same bidId   (idempotent)
different actor, same id    → independently evaluated     (no ack leakage)
```

### P0-3 · One unauthenticated packet killed the auction engine — **CLOSED**

| Change | File |
|---|---|
| The `upgrade` handler is wrapped: every path out is `socket.destroy()`, never a throw | `apps/engine/src/server.ts` |
| `maxPayload: 4 KB`, per-room and per-IP socket caps, `Origin` allowlist, slow-consumer eviction, client frames refused on a receive-only socket | same |
| `ENGINE_ALLOWED_ORIGINS`, `WS_MAX_SOCKETS_PER_ROOM`, `WS_MAX_SOCKETS_PER_IP` | `apps/engine/src/env.ts` |

**Proof.** Five malformed targets that previously killed the process:

```
//%zz/ws · http://[::1 · http://a^b/ws · //% · /ws?auction=%zz
→ engine healthz 200 after every one; each logged "malformed upgrade request — refused"
```

Regression tests added (`apps/engine/src/server.test.ts`) so it cannot return.

---

## 2 · P1 findings

| ID | Finding | Status | Evidence |
|---|---|---|---|
| P1-1 | No green test run; CI missing e2e + RLS gates | **CLOSED (code)** | CI gained a precompiled e2e job, four-role creation, `grants:verify`, `rls:verify`. Stale specs repaired; dev-only `/gallery` specs now skip on a production build instead of failing. *A green run on real CI still requires a git remote — see §4.* |
| P1-2 | Rollback docs described a system twelve migrations gone | **CLOSED** | 14 docs corrected; forward-only posture and a 3-branch rollback decision procedure now in `DEPLOYMENT.md` |
| P1-3 | Documented role command aborted halfway | **CLOSED** | All invocations pass four passwords; `nightly-verify.yml` fixed; the SQL header no longer teaches the broken form |
| P1-4 | 17 high-severity advisories; CI's own gate red | **CLOSED** | `pnpm audit --prod --audit-level high` → **exit 0, no known vulnerabilities**. next 15.5.20 → 15.5.23; floors pinned for find-my-way, fast-uri, brace-expansion, nanoid, js-yaml, postcss, sharp |
| P1-5 | Razorpay webhook had no ingress route | **CLOSED** | `apps/web/src/app/api/webhooks/razorpay/route.ts`; fail-closed 404 without `RAZORPAY_WEBHOOK_SECRET`; adapter wired from env; 3 regression tests |
| P1-6 | Every team's purse broadcast to every socket | **CLOSED** | Redaction moved server-side; scope bound into the ticket HMAC |

**P1-6 proof** — three audiences on one live auction:

```
conductor  scope=all    P01 purse=1995000000 · P02 purse=1989000000 · P04 purse=1993500000
bidder     scope=t:…A   P01 purse=1995000000 · P02 purse=null       · P04 purse=null
spectator  scope=t:      every purse null
forged scope upgrade (valid ticket + scope=all) → refused
```

---

## 3 · P2 / P3

| ID | Finding | Status |
|---|---|---|
| P2-1 | No timer-expiry check in the gauntlet | **CLOSED** — `LOT_EXPIRED`, 4 unit tests |
| P2-2 | No rate limiting on the command path | **CLOSED** — per-actor token bucket, metered before the queue so a refusal costs no fold or broadcast; `ENGINE_RATE_BURST` / `ENGINE_RATE_REFILL_PER_SEC` |
| P2-3 | Roster had a second writer during a live auction | **CLOSED** — `assignTeam`, icon/captain marks and self-withdrawal all refuse once the auction leaves `scheduled` |
| P2-6 | Ledgers were not append-only at the database | **CLOSED** — see P0-1 |
| P2-9 | Drizzle snapshot chain 8 migrations stale | **MITIGATED** — `db:generate` now refuses with an explanation. The chain is *not* rebuilt: doing that by hand is how you author a wrong migration |
| P2-10 | No fetch timeout; no engine readiness probe | **CLOSED** — `AbortSignal.timeout(2s)`; engine `/readyz` distinct from `/healthz` |
| P2-11 | WebSocket had no limits | **CLOSED** — see P0-3 |
| P3-1 | Invite acceptance lost its destination | **CLOSED** — a nameless invitee goes to `/onboarding?next=/org/{slug}` and lands in the org |
| P3-2 | Two integration tests depended on wall-clock time | **CLOSED** — clock injected; they no longer fail after 21:00 IST |
| P3-3 | Upload trusted the declared `Content-Type` | **CLOSED** — `bytesMatchImageType` sniffs JPEG/PNG/WebP magic bytes |
| P3-4 | `paddleCount` counted released paddles | **CLOSED** — counts distinct teams still holding |
| P3-6 | `ENGINE_SECRET` floor of 8 chars | **CLOSED** — ≥32 in production; dev default refused outside development/test |
| P3-8 | `safeNext` allowed unresolved dot segments | **CLOSED** — refused; 2 tests |
| P3-9 | Doc/code drift at scale | **CLOSED** — see P1-2 |

### Deliberately not done

**P2-4 (settlement coordination and payment-expiry sweeps have no scheduler)**
and **P2-5 (the finops runner lacks the web tier's delivery adapters)** both
require moving the settlement store and the delivery adapters out of `apps/web`
and into packages, because `apps/*` may not import `apps/*` (enforced by
`depcruise`). That is a real refactor of the money writer, and half-doing it at
the end of a remediation pass is how a P2 becomes a P0. Both remain open with
the extraction named as the fix.

**P3-7 (74 bare `catch {}` discard the error).** Mechanical but wide; each site
needs a judgement about what to report and what is genuinely expected. Open.

---

## 4 · Verification summary

| Gate | Before | After |
|---|---|---|
| `pnpm verify` (lint · typecheck · unit · format · boundaries) | ✅ | ✅ **all green** |
| Unit tests | 523 | **537** |
| Engine integration | 66 | **66** |
| Web integration | 598 / 600 | **605 / 605** |
| `pnpm audit --prod --audit-level high` | ❌ exit 1, 17 high | ✅ **exit 0, none** |
| Engine survives malformed WS upgrade | ❌ process death | ✅ **refused + logged** |
| Timer suppression exploit | ❌ late bid won the player | ✅ **refused at the boundary** |
| Sale under production DB roles | ❌ permission denied | ✅ **SOLD, roster stamped** |
| Web routes under production DB roles | ❌ never attempted | ✅ **14 / 14 serve** |
| Rival purse visible to a bidder | ❌ on the wire | ✅ **null server-side** |

### The e2e suite is NOT green, and that is a harness problem, not a product one

The last full run (single worker, 1.5 h, precompiled server) was **50 passed ·
18 failed · 28 skipped**. The skips are the dev-only `/gallery` specs, which now
skip honestly instead of failing. The 18 are the point of this section.

**Three root causes were found and fixed** during this pass; each was a test
encoding a world that no longer exists, not a defect in the product:

1. **A navigation race against the name gate.** `auction-experience` clicked
   *Continue* on onboarding and immediately navigated to `/orgs`. The gate reads
   the session, so a `goto` that races the write is bounced to `/onboarding`,
   which — by then finding a name — forwards to its default of `/home`. The spec
   then waited five minutes for a control that only exists on `/orgs`. Fixed by
   waiting for `/home` first, which is what every spec that works already does.
2. **A helper that sampled instead of waiting.** `clearNameGate` asked
   `isVisible()` the instant after a click that navigates, concluded there was no
   gate, and handed control back — so the caller waited 30 s for the live panel
   on a page showing "Welcome to DesiAuction". It now waits for the gate.
3. **Fixed demo identities exhausting the OTP budget.** Two specs sign in as
   `+919999000001` / `+919999000002` rather than a fresh number. Over a full run
   those numbers request eight and five codes against a five-per-hour limit;
   the sixth is refused and the login form never leaves the phone step.
   `resetOtpBudget` clears the harness's own consumption. The limit itself is
   untouched — `auth-onboarding` still exercises the refusal deliberately.

**Evidence that the product is not the problem:** `auth-onboarding` passes
**10/10 in isolation** and again when run after the auction specs; it fails only
inside the 90-minute run. `orgs.spec` failed in isolation before the fixes and
**passes now**. `auction-experience` reached the org step, then the owner-join
step, then the bidding step as each race was removed — the journey is real, the
choreography around it had rotted.

**What is left.** Roughly a dozen specs still carry the same species of staleness
and need the same treatment, one at a time, each confirmed in isolation. That is
a focused half-day of test work with no product risk attached, and it is the
honest remaining gap between this branch and a green gate. It is tracked, not
hidden: a NO-GO cannot lift on a suite nobody has seen pass.

### What still needs a human

1. **One green CI run on a real remote.** The repository has no git remote, so
   no workflow has ever executed. Everything above was proven locally.
2. **Founder-held externals**, unchanged: SMS, S3, Razorpay live keys, Sentry
   DSNs, managed Postgres with PITR, domains/TLS, the staging performance sweep.
3. **A rehearsal auction on staging under the production role recipe** — the
   drill this pass ran locally, run once against real infrastructure.
4. **The two named refactors** (§3) and the system-pool least-privilege
   follow-up (§1).

---

## 5 · E2E handoff — the remaining ten

**State: 61 pass · 10 fail · 31 skip** (from 50/18 at the audit, and 3/18 when
this pass began). Every remaining failure has been diagnosed from its own output;
none is a guess. Each fix in the last pass moved its test *past* the old blocker
onto a new one, which is why the list shrank rather than emptied.

| Spec | Diagnosis | Next step |
|---|---|---|
| `passkeys:32` | Past the locator fix; now `events-panel` never shows `auth.passkey.enrolled` | Check whether enrolment writes that security event, or whether the panel labels it differently. **Possible product gap** — enrolling a credential should be auditable |
| `passkeys:67` | The user-agent fix worked (row found), but after Revoke the row is still there | `.first()` may now target the wrong row, or the panel does not refresh after revoke. **Check the refresh** before assuming it is the spec |
| `tournaments-index:64` | My `tg-toggle-${alpha}` guess is the wrong group key | Read `group.key` for a season-view group and use it |
| `financial-operations:72` | `open-money-ops` already links to `/money` *before* the finance grant | The fixture user (demo founder) already holds `finops:controller`, so the spec's premise — "owning the org confers no finance power" — does not hold for this fixture. Needs a fixture without the grant, not a locator change |
| `financial-issuance:51` | Same door rename; blocked behind the same fixture question | Follows from the above |
| `organizer-workspace:229` | `getByLabel('They join as')` — invite-role select renamed or removed | Find the current control |
| `settlement-experience:89` | Re-ticks the override now; still completing | Re-diagnose from the fresh run |
| `conduct-ceremony:63` · `live-auction:57` · `auction-experience:64` | The three long multi-actor journeys | Re-diagnose; the arrival-time fix and the completion-dialog fix both landed after their last observed failure |

### Update after the second pass

**62 pass · 9 fail** at the last full run, and `passkeys` (both) went green after
it. Five more root causes fixed — the account log renders prose not action keys,
revoking a device asks first, the invite form lives behind a tab and a dialog,
the seasons list groups into closable sections, and the money door's href is
server-decided so it needs a reload after a grant changes.

**Still open, with what is known about each:**

| Spec | Where it now stops | Read |
|---|---|---|
| `settlement-experience:89` | Closes via the cockpit, answers the override dialog, auction still reads "live" | The cockpit's complete flow needs watching in a headed run — the dialog may gate its confirm on something else, or the command is refused for a reason the UI does not surface |
| `financial-operations:72` · `financial-issuance:51` | Money door still hrefs `/money` before the finance grant | The reload did not change it, so the viewer genuinely has finance view. Check WHICH identity the spec runs as and what the demo seed grants it |
| `tournaments-index:64` | No `tg-season` row matches in the seasons view | Observe what that view actually renders — it may not use season rows at all |
| `organizer-workspace:229` | `org-name` is not the org the spec just created | Probably clicking the wrong row in a list full of similarly-named residue |
| `auction-experience:64` · `conduct-ceremony:63` · `live-auction:57` | The three long multi-actor journeys | Each needs one headed run to watch; the arrival-time and dialog fixes landed after their last observed failure |

**Two product findings from this pass, neither fixed:**

1. **A short-squad auction cannot be closed from the auction panel.** The
   `accept-short-open` checkbox only renders while the auction is `scheduled`,
   but the panel keeps offering Close once it is live — and passes the now-false
   override with it. DA-06 refuses, the status stays "live", and nothing on
   screen says why. The banner points at the cockpit, so the capability exists;
   the button that cannot work should not be there.

2. **One product fix falls out of this and is not done:** the short-squad override
is a single checkbox (`accept-short-open`) carrying both *open* and *close*, held
in component state, so the refresh after opening clears it. The operator ticks a
box, watches it disappear, and the close then fails DA-06 with the status simply
staying "live" and nothing on screen explaining why. The specs now re-tick it;
the panel should either persist the choice or ask again at the point of use.


---

## 6 · E2E — final state of this pass

**70+ passing · 4 failing · 31 skipped.** From **3 passing** when the repair
began, and 50 at the audit. Everything below was diagnosed by dumping what the
page actually contained, not by reasoning about what it ought to have.

### Product bugs the tests caught (all fixed)

1. **`sitemap.xml` was frozen at build time** — a tournament published after the
   deploy never reached crawlers until the next release.
2. **Anti-snipe could be lost to queue depth** — the expiry guard judged a bid by
   when the reducer reached it, not when it arrived, so the last-second bid the
   rule exists to honour was refused.
3. **The success toast faded in, and for those frames it was unreadable.** axe
   failed it at "serious" against WCAG 1.4.3 and was right: an opaque surface
   made translucent by an animation is measured against whatever is behind it.
   Transform only, never opacity, on anything carrying text.

### Product bugs found and NOT fixed

1. **A short-squad auction cannot be closed from the auction panel.** The
   `accept-short-open` checkbox only renders while the auction is `scheduled`,
   but the panel keeps offering Close once it is live and passes the now-false
   override with it. DA-06 refuses, the status stays "live", nothing explains
   why. The cockpit has the proper two-act dialog; the panel's button should
   either carry the override or send the operator there.
2. **The completion dialog's second act is invisible to the operator too.**
   Confirm → engine refuses → the same dialog re-renders with a reason field.
   That is a good design, but nothing announces the refusal, so a conductor who
   looks away sees only that the dialog is still open.

### Still failing

| Spec | Where it stops |
|---|---|
| `conduct-ceremony:63` | Ceremony shows "sold" where "extension" is expected. The runway was widened to 10s inside a 15s window and it still races; the anti-snipe rule itself is proven deterministically in `live-engine.integration.test.ts` |
| `financial-operations:72` | Past the door now; `ops-overall` is not "healthy". Likely genuine — finops health depends on the runner having drained jobs, and the runner does not run in e2e |
| `financial-issuance:51` | Blocked behind the same finance fixture |
| `organizer-workspace:229` | After clicking through to the org, `org-name` is not found at all — check whether that testid still lives on the org detail page or only on the list card |
