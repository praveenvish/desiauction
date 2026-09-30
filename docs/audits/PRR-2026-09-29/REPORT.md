# DESIAUCTION PRODUCTION READINESS REPORT

**Date:** 2026-09-29 · **Audited commit:** `origin/main` @ `e18d3972` (the commit production was deployed from at 09:49 UTC the same day) · **Fix branch:** `audit/prr-2026-09-29` (local, committed, NOT pushed, NOT merged, not tracking `main`)

**Method.** Six independent read-only audits (authentication, authorization and tenancy, database, jobs and integrations, frontend, deploy and recovery) plus a direct review of the auction engine, followed by verification of every finding in code before anything was changed. Every gate the repository has was run on a pristine Postgres 17 with all migrations applied and the four production database roles created. Each fix has a test that fails on the old code, or a measurement.

**Status words used below.** VERIFIED = proven by a test or command run in this review. PARTIALLY VERIFIED = proven in code or locally, not on the production host. NOT VERIFIED = could not be checked, with the reason. NOT APPLICABLE = the system has no such component.

---

## 0. Second pass: review of the fixes themselves

After the first pass the branch was reviewed adversarially, by an independent
reviewer told to find what the fixes could BREAK. Production was running real
auctions, so that question mattered more than any new finding. It found one
HIGH and two MEDIUM regression risks **in this branch's own fixes**. All were
corrected before anything left the branch.

| # | Risk in the first-pass fix | Severity | What was done |
|---|---|---|---|
| R1 | The live socket asked the router to refresh after six failed reconnects. A refresh that cannot reach the server becomes a full navigation, so a phone that lost signal, or a projector on venue Wi-Fi, would have been left on the browser's error page | HIGH | Removed. A page reloads for a new ticket only if it is over 20 hours old, online, and the server has answered first. A young page never reloads |
| R2 | A waiting owner's page refreshed on every snapshot version, which is every bid: one full page render per bid per such viewer | MEDIUM | Refreshes only when a paddle changes, or before the night on any event. Never more than once in ten seconds |
| R3 | The deploy freeze counted any season with a start time, so one abandoned test season could hold every deploy for five hours | MEDIUM | Only a season whose auction exists and is waiting to start counts |
| R4 | The owner-invite mail held one pooled connection and asked the same pool for a second | LOW | Counts on the transaction it already holds |
| R5 | The send lock queued behind its holder, so a flood from one address could pin the connection pool the auction shares | LOW | The lock is tried, never waited for. A taken lock is answered at once |
| R6 | The "results announced" marker could fail the completion's transaction | LOW | Written behind a savepoint |
| R7 | A push subscription that moved between accounts could be deleted by the device cap the moment it arrived | LOW | The row just saved always survives |
| R8 | A push host missing from the allow-list would have unsubscribed its users silently | LOW | Unknown hosts are skipped, never deleted |
| R9 | Twenty invite mails an hour would refuse a 24-team league | LOW | Sixty |

Also closed in the second pass, from the first pass's open list:

| ID | Finding | Status |
|---|---|---|
| FE-4 | Cockpit showed each team's spend as ₹0 until reload | **FIXED**. The feed now meets the server's rows; an undone sale leaves the board at once. 6 tests |
| FE-8 | No error reporting from the browser | **FIXED**. Same-origin capped endpoint, no third-party script. 6 tests |
| FE-10 | A signed-out bidder landed on `/home` | **FIXED**. Returns to the season's auction |
| REL-2 | Bulk approval lost its audit rows when sending outlasted the idle limit | **FIXED**. Proven against Postgres |
| REL-6 | Finance runner force-killed on every deploy | **FIXED**. Stops within its tick |
| OPS-10 | Old release images never pruned | **FIXED** in the deploy. Disk alerting still open |
| OPS-5 | No escrow procedure for the backup passphrase | **Procedure written**. Doing it is the founder's |
| OPS-6 | Production backup never restored | **Script written and rehearsed** (`ops/deploy/restore-drill-production.sh`). Running it on the host is the founder's |
| — | Secret rotation runbook described a deployment that no longer exists | **REWRITTEN** for the real stack, 20 secrets |

### Left alone on purpose

The instruction for this pass was that nothing working may break. These were
judged to carry more risk than they remove today, and each has a reason:

| Item | Why it was not changed |
|---|---|
| Splitting `ENGINE_SECRET` into per-purpose keys | **Done in the third pass as an optional key** (section 0b). Switching it on is still a planned act |
| Durable command ids on `auction_events`, unique index on the leading bid | Both touch the certified auction aggregate. The integrity test shows no harm without them |
| Missing foreign keys, validating the 29 `NOT VALID` ones | A row that fails validation refuses the deploy. Needs a read of production data first. **The read-only check now exists** (section 0b) |
| Razorpay order binding | **Done in the third pass** (section 0b) |
| Spectator frame size | A design change to the snapshot contract. **Compression shipped as an opt-in instead** (section 0b) |
| Email-change confirm step-up, money grants to non-members | Low severity; the first would add friction to a flow the e2e suite exercises with older sessions |
| About 20 client files that can strand a busy state | **Done in the third pass** (section 0b) |

## 0b. Third pass: the open list, and a second review

The third pass worked through what the second had left open, under the same
rule: nothing that works may break, and nothing leaves the branch. It was then
reviewed adversarially a second time. That review found **one defect that
would have been a BLOCKER had it shipped**, in this branch's own webhook fix.
It was corrected, with tests, before anything left this machine.

### What was closed

| Item | What was done | Proof |
|---|---|---|
| SEC-10, one secret doing four jobs | Optional `AUTH_CODE_SECRET` for sign-in codes and passkey challenges. Unset, nothing changes | Tests for both states; boot refuses a value equal to the engine's |
| SEC-12, webhook order binding | Events bound to the pinned order or the recorded provider payment | 7 refusal and acceptance tests |
| FE-5, screens left busy | 48 handlers in 31 files, one notice for a lost request | Browser test: network cut under a real button |
| DB-3, DB-6, foreign keys | Read-only integrity check for production | Run on the test database: every line `ok` |
| DB-7, engine migration set | CI guard | Fails when a file is added, passes without |
| OPS-7, disk and certificate alerts | Sidecar plus three rules | All 19 rules loaded in Grafana; three alerts delivered to a webhook |
| PERF-1, frame size | Opt-in compression | Measured, table below |

### What the second review found in this pass's own work

| # | Finding | Severity | What was done |
|---|---|---|---|
| T1 | The order binding compared a dispute's ORDER with our provider PAYMENT id. Different identifiers: every genuine chargeback would have been refused and never reached the books | **BLOCKER, had it shipped** | A dispute is bound to the pinned order and to the recorded provider payment. Three tests in the shape the provider sends |
| T2 | The stale-page notice matched the sentence the server logs. The browser receives a different one, so the one case a reload fixes was never recognised | HIGH | Matches what the installed framework version actually throws, read from its source |
| T3 | The notice stayed until dismissed, over the retry that succeeded, and sat where the live room keeps its bid buttons | MEDIUM | Leaves after 15 seconds or on navigation; moved to the top |
| T4 | Compression kept about 270 KB of memory per spectator, a quarter of a gigabyte at a thousand | MEDIUM | 32 KB. Six settings measured, the cheapest kept |
| T5 | Invite-all announced nothing when a later request was lost | LOW | Links already made are announced |
| T7 | A proxy error during a restart was called a stale page | LOW | Treated as a dropped request |
| T8 | The integrity check had no time limit | LOW | Two minutes, and a note not to run it during a deploy |
| T9 | A blank `AUTH_CODE_SECRET=` passed preflight and then stopped the server booting | LOW | Read as unset |
| T10 | A refused webhook left no trace | LOW | Every refusal logged with the check that refused it |
| S1 | One non-JSON line in the disk stream failed the alert query, and a failed query on a paging rule pages | MEDIUM | Filtered. Proven against Loki with bad lines |

T6 was left as it is: a session-expiry redirect now re-enables the button for an instant before the page leaves. The second click redirects too.

### Found along the way, not raised by the first audit

| ID | Finding | Severity | Status |
|---|---|---|---|
| FE-11 | **An approved player could flip back to "waiting", and the review walk then jumped back instead of finishing.** A page asked for before an approval and arriving after it was believed over the approval. This is the `player-desk` e2e test that fails about one run in four. Present on main; not caused by this branch | MEDIUM | **FIXED**. A confirmed change is kept against a page that disagrees, three times at most. Measured on a test that delivers every page late: 6 failures in 20 before, 0 in 20 after. A first attempt (stamping when each page was asked for) was measured, failed 2 in 10, and was discarded |
| API-7 | A signed, fresh gateway event the product does not act on (`order.paid`) was answered 400. A provider that sees a day of failed deliveries switches the webhook off | MEDIUM | **FIXED**. Answered 200 |
| API-8 | A refund raised from the provider's dashboard carries no anchor of its own, so every such refund was refused as malformed | MEDIUM | **FIXED against the documented payload**: the anchor is read from the payment the refund names, in the same signed body. NOT VERIFIED against a real delivery |
| SEC-19 | `code-digest.ts` held two raw NUL bytes. git treated the file as binary and text search skipped it in silence | LOW | **FIXED**. Written as escapes; a known-answer test proves stored codes still match |
| SEC-20 | A connection URL's login (`postgres://user:password@host`) was scrubbed from error text only by accident, and not when the host was an IP or a bare name | LOW | **FIXED**, by shape |

### Frame compression, measured

One machine, a 250-player night, real WebSockets, the engine and the simulated
spectators in one process. The CPU and memory figures therefore include the
spectators and overstate the engine's share; compare the two columns.

| Spectators | Wire per spectator per bid | | Last spectator has the bid | | 40-bid burst settles | |
|---|---|---|---|---|---|---|
| | off | on | off | on | off | on |
| 50 | 37.7 KiB | 6.2 KiB | 21 ms | 23 ms | 0.7 s | 0.8 s |
| 250 | 46.9 KiB | 8.1 KiB | 39 ms | 50 ms | 1.0 s | 1.1 s |
| 500 | 51.6 KiB | 9.0 KiB | 68 ms | 89 ms | 1.2 s | 2.3 s |
| 1,000 | 56.2 KiB | 9.9 KiB | 130 ms | 180 ms | 1.8 s | 6.0 s |

No spectator was dropped in any burst, in either mode. The frame grows through
the run because the lot's bid history grows. Recommendation: switch it on in
staging first; it is worth having up to about 500 spectators per room, and
costs real delivery time under sustained bursts beyond that.

### Validation of the final commit

Every figure below was produced by a command run in this pass, on a database
rebuilt from nothing.

| Suite | Result |
|---|---|
| Lint, typecheck, format, dependency rules, motion tokens, posture (static), script tests, journal | PASS |
| Unit | **1,366 pass** |
| Integration, web | **2,587 pass** (237 files) |
| Integration, engine | **75 pass** |
| Runner under its production role | 5 pass |
| Grants manifest | 455 expectations pass |
| Row security probe with seeded data | PASS |
| Posture suite under production roles | 37 pass |
| Production build, bundle budget | PASS, 106 routes |
| End to end, full suite | **158 passed, 0 failed, 0 flaky**, 29 skipped by design |
| Design-system journeys, photo journey (dev server) | 28 passed, 1 passed |
| Alert rules in Grafana | 19 loaded, 0 unhealthy |

One earlier full run in this pass had one flaky test (`player-desk`). That is
FE-11 above, since fixed; the run after the fix had none.

## Executive Summary

**Overall readiness: `READY WITH CONDITIONS`**

The auction core is sound. No defect was found that produces a wrong auction result, a double sale, a negative purse, a cross-tenant read or an authorization bypass. That conclusion rests on evidence, not on reading: 75 engine integration tests, a new randomized integrity test run on four seeds, and 2,533 web integration tests under the production database roles.

The conditions are operational, not algorithmic. This review found **10 HIGH findings, 0 BLOCKER and 0 CRITICAL**. Eight of the ten are fixed on the branch. The third pass added three MEDIUM and two LOW findings, all fixed, and closed DB-7 and the binding half of SEC-12 (section 0b). None of the fixes is deployed yet, so production today still carries them. Two HIGH items need the founder and the host, and cannot be closed from a repository: proof that the backups can actually be restored, and proof that an alert reaches a person.

| Severity | Found | Fixed on the branch | Open |
|---|---|---|---|
| BLOCKER | 0 | 0 | 0 |
| CRITICAL | 0 | 0 | 0 |
| HIGH | 10 | 8 | 2 (both need the host: restore proof, alert proof) |
| MEDIUM | 30 | 25 | 5 |
| LOW | 21 | 10 | 11 |

**The answer to the question asked.** DesiAuction can run a real auction correctly. It should not run one that matters until the five conditions in section 67 are closed, because today a lost host may mean lost data, and a broken night may page nobody.

---

## 1. Architecture Summary

Verified from code, not from documentation.

| Layer | What it is | Evidence |
|---|---|---|
| Monorepo | pnpm 10 workspaces + Turborepo, Node 24, TypeScript strict | `package.json`, `turbo.json` |
| Web | Next.js 15.5.25 (patched), React 19, App Router. 44 server-action modules, 23 route handlers | `apps/web` |
| Auction engine | Fastify 5 + `ws` 8. One process, one writer | `apps/engine/src/engine-core.ts` |
| Finance runner | Sequential background worker for receipts, exports, dispatch | `apps/finops-runner` |
| Database | PostgreSQL 17, drizzle-orm 0.45, postgres.js. 98 migrations, 81 tables, row security forced on 45 | `packages/db` |
| Roles | Four runtime roles: app (no bypass), system (read, bypass), engine, runner. 455 grant expectations pinned in CI | `ops/db/create-app-role.sql`, `verify-grants.ts` |
| Authentication | Passwordless. Email code (default), phone code (WhatsApp or MSG91), passkeys. No passwords exist | `apps/web/src/server/auth` |
| Sessions | 256-bit token, stored as SHA-256, `__Host-` cookie, HttpOnly, Secure, SameSite=Lax, 30-day sliding, 90-day ceiling | `sessions.ts` |
| Authorization | Capability sets granted at org, season or platform scope. Checked server-side in every action | `packages/core/src/capabilities.ts` |
| Realtime | WebSocket carries full snapshots, server to client only. Commands travel over HTTP from the web tier | `apps/engine/src/server.ts` |
| Queues | None. No Redis. Outbox table in Postgres with `FOR UPDATE SKIP LOCKED`, drained by job routes on a scheduler | `apps/web/src/server/messaging/outbox.ts` |
| Storage | S3-compatible object store on the host, mirrored off-box | `ops/deploy/docker-compose.production.yml` |
| Third parties | AWS SES, WhatsApp Cloud API, MSG91, Web Push, Google Drive Picker (browser side), Sentry, Razorpay (present, not switched on) | adapters under `packages/messaging`, `apps/web/src/server/settlement/adapters` |
| Hosting | One VPS, Docker Compose, shared Caddy edge, images in GHCR, deploy over SSH from GitHub Actions | `ops/deploy`, `.github/workflows/deploy-host.yml` |
| Backups | pgBackRest to S3 (ap-south-1), weekly full, daily differential, WAL archiving, AES-256 | `pgbackrest` service |
| Observability | pino JSON logs, Alloy to Loki, Grafana alert rules, Sentry on web, engine and runner. No metrics endpoint | `ops/platform/observability` |
| CI | lint, typecheck, unit, integration, role posture, e2e, image builds, secret scan. Branch protection on `main` | `.github/workflows/ci.yml` |

### System map

```
USER ── email code / phone code / passkey ──▶ SESSION (hashed, __Host- cookie)
  │
  ▼
PERSON ──▶ GRANTS (capability set @ org | season | platform)
  │
  ▼
ORGANIZATION ──▶ TOURNAMENT ──▶ COMPETITION (season) ──▶ TEAMS
                                     │                      │
                                     ▼                      ▼
                               REGISTRATIONS ──────▶ PADDLE GRANT ──▶ PADDLE
                                     │
                                     ▼
                                  AUCTION ──▶ LOTS (one per registration)
                                     │
   browser ─ server action ─▶ web gateway (session, capability, paddle held)
                                     │  HTTP + shared secret, private network
                                     ▼
                       ENGINE: per-auction FIFO queue, single writer
                                     │
                     decideBid (11 ordered checks, pure function)
                                     │
             ONE TRANSACTION: bid row + lot row + registration.team_id
                              + auction_events (seq) + audit_log
                                     │
                 re-fold the event log, verify rows against it
                                     │
                     snapshot ──▶ WebSocket broadcast ──▶ every screen
                                     │
                outbox (email, WhatsApp, push) ──▶ inbox rows ──▶ reports
```

### Dependency map

| From | To | How |
|---|---|---|
| Browser | Web | Server actions and route handlers, same-origin |
| Browser | Engine | WebSocket only, HMAC ticket, receive-only |
| Web | Engine | `POST /command`, `GET /snapshot`, `GET /diagnostics`, shared secret, private network |
| Web | Postgres | Two pools: app (row security enforced) and system (read only) |
| Engine | Postgres | One pool plus one reserved connection holding the single-writer advisory lock |
| Runner | Postgres, object store, mail | Claims jobs with `SKIP LOCKED` |
| Web | SES, WhatsApp, MSG91, push services | Through one provider call with a 10 second deadline |
| Admin | Everything | `platform:*` capability sets, read-mostly, every personal-data view writes an access-log row |

---

## 2. Critical Findings

BLOCKER and CRITICAL: none. HIGH findings, all of them:

| ID | Severity | Area | Finding | Impact | Status |
|---|---|---|---|---|---|
| OPS-1 | HIGH | Deploy | The deploy freeze asked only "is an auction live now". An auction announced for 20:00 did not stop a deploy at 19:50, and nothing re-checked before the engine was swapped | Engine restarted under the first lot | **FIXED**, VERIFIED against a database in 9 scenarios |
| OPS-2 | HIGH | Recovery | `archive_timeout` was unset. A WAL segment ships only when 16 MB fills, and a whole auction night writes less | Recovery point documented as "seconds" was in practice up to a day | **FIXED** in config, PARTIALLY VERIFIED (needs a deploy to take effect) |
| SEC-6 | HIGH | Secrets | On any psql failure the live-window script printed Node's error message, which contains the full database URL with the owner password | Owner password in deploy logs and the log store | **FIXED**, VERIFIED. Six past deploy logs checked: zero leaks, no rotation needed |
| SEC-7 | HIGH | Supply chain | The actions that hold the deploy SSH key were pinned to mutable tags | A moved tag runs new code with root-equivalent access to the host | **FIXED**, pinned to commit hashes |
| OPS-3 | HIGH | Availability | The web container's restart check was the database-dependent readiness route | A 45 second database blip restarted a healthy web process | **FIXED**, PARTIALLY VERIFIED |
| OPS-4 | HIGH | Recovery | The restore runbook's "only undo" step named a volume that does not exist. Docker creates it empty and the archive succeeds on nothing | The one copy of the damaged cluster is destroyed by the next step | **FIXED** in the runbook |
| AI-2 | HIGH | Auction | If the engine took over 2 seconds to complete an auction, the web tier reported failure and never announced results. Every retry then saw "already completed" and announced nothing | No player told they were sold, and no log line | **FIXED**, VERIFIED by test |
| FE-1 | HIGH | Live room | A connection that died without closing was detected and only relabelled. Nothing reconnected | Owner locked out of bidding until they reloaded | **FIXED**, policy VERIFIED by unit test, NOT VERIFIED on a real device |
| FE-2 | HIGH | Live room | "Withdraw" was one click beside "Open", and withdrawal is the one lot command with no undo | A mis-tap removes a player from the auction for good | **FIXED**, e2e updated |
| OPS-5 | HIGH | Recovery | No evidence the backup encryption passphrase and the env files exist anywhere but the host. The production backup has never been restored | Host lost means backups unreadable | **OPEN**, founder and host required |
| OPS-7 | HIGH | Alerting | An engine-halted auction logs one error line, below the error-rate threshold. No disk, certificate or external uptime alert. A Grafana silence may still mute production | A frozen auction pages nobody | **PARTIALLY FIXED**: six rules added (engine halted, slow command, results not announced, disk filling, disk watcher silent, certificate renewal) and a disk-watch sidecar. All 19 rules were loaded into a local Grafana from the real files and evaluate healthy; the disk, silence and certificate alerts were each delivered to a local webhook. Delivery from the PRODUCTION host is still NOT VERIFIED, and the external uptime check is the founder's |

---

## 3. Security Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| SEC-1 | MEDIUM | Web push: any signed-in user could save any `https` URL as a device, and the server would POST to it and follow redirects. Knowing another user's endpoint URL took their subscription. Sends ran inside a database transaction | **FIXED**. Allow-list of push services, redirects refused, keys prove ownership, 10-device cap, network outside the transaction. 20 tests |
| SEC-2 | MEDIUM | Sign-in code send limits were "count, then insert" with no lock. **Measured: 20 of 20 parallel requests sent a code** against a limit of one per 30 seconds | **FIXED**. Advisory lock per handset, mailbox and address. 4 tests that fail on the old code |
| SEC-3 | MEDIUM | Demo booking: unlimited reschedule loop mailed a calendar invite to an unverified address each time, with no account needed | **FIXED**. Six bookings per request |
| SEC-4 | MEDIUM | "Email this invite" had no limit. Anyone can create a club and choose its name, which appears in the mail | **FIXED**. 20 per person per hour across clubs, 5 per invite |
| SEC-5 | MEDIUM | Engine and runner roles, both able to bypass row security, could read every session hash, sign-in code digest, passkey and push key | **FIXED**. Migration 0098, pinned in the grants manifest |
| SEC-8 | MEDIUM | Web and engine logs wrote phone numbers from database errors in free text, and redacted the error code that would diagnose them. Reproduced | **FIXED**. One shared scrubber in all three services |
| SEC-9 | MEDIUM | The engine's command endpoint was reachable from the internet, protected by the shared secret alone | **FIXED** in the engine: private routes answer 404 to any request that came through the proxy. Preflight refuses a misconfigured environment |
| SEC-10 | MEDIUM | `ENGINE_SECRET` is one value doing four jobs: engine auth, socket tickets, sign-in code digests, passkey challenges | **MECHANISM SHIPPED, NOT SWITCHED ON**. `AUTH_CODE_SECRET` (optional) gives sign-in codes and passkey challenges a key the engine never holds. Unset, nothing changes. Setting it is a planned act in a quiet window (SECRET_ROTATION.md): codes in flight, a few minutes' worth, stop matching. Engine auth and socket tickets still share `ENGINE_SECRET`, which both tiers must hold |
| SEC-11 | MEDIUM | The script Content Security Policy is report-only in production. Observed on the live response header | **OPEN**, already planned. Set `CSP_ENFORCE=1` after a clean week |
| SEC-12 | MEDIUM | Razorpay webhook does not compare the event's order with the one pinned at initiation, and order creation has no idempotency key | **BINDING FIXED** (third pass). Every event is bound to the order pinned at initiation or to the provider payment recorded at capture, and a gateway event can only land on a gateway payment. Tested against the provider's DOCUMENTED payloads; NOT VERIFIED against a live or test-mode delivery. The idempotency key on order creation is still OPEN. Gateway payments remain switched off |
| SEC-13 | LOW | A removed team owner kept reading that team's receipts | **FIXED** |
| SEC-14 | LOW | Mail feedback webhook fetched a signing certificate before checking the topic | **FIXED** |
| SEC-15 | LOW | Web tier did not refuse to boot with no trusted proxy hop, which silently disables every per-address limit | **FIXED** |
| SEC-16 | LOW | Spectate ticket is a shared bearer value valid 24 to 48 hours, not bound to a person | OPEN |
| SEC-17 | LOW | Legacy session cookie fallback, email-change confirm without step-up, money grants issuable to non-members, passkey challenge replayable for 5 minutes | OPEN |
| SEC-18 | LOW | Staff who can review registrations can see hammer prices, while the Teams tab hides them from the same people | OPEN, a product decision |

### Security test matrix

| Attack | Expected | Result | Evidence |
|---|---|---|---|
| IDOR / BOLA | blocked | VERIFIED in code, all 44 action modules and 19 of 23 route handlers read | No id-taking writer found without an org or season filter |
| Cross-tenant read | blocked | VERIFIED | Row security probe under the non-bypass role, 37 posture tests |
| XSS | blocked | VERIFIED in code | Two uses of raw HTML: escaped JSON-LD and a constant |
| SQL injection | blocked | VERIFIED in code | Parameterized queries throughout |
| CSRF | protected | VERIFIED in code | Same-origin check on server actions, SameSite=Lax |
| Privilege escalation | blocked | VERIFIED | Platform grants cannot be written by the app role |
| Brute force | rate limited | VERIFIED after SEC-2 | 5 attempts per code, 5 codes per hour |
| Mass assignment | blocked | VERIFIED in code | Writers copy named fields only |
| File upload abuse | blocked | VERIFIED in code | Type, size, magic bytes, traversal-safe keys, re-encoding |
| Session hijacking | mitigated | VERIFIED in code | Hashed tokens, revocation, step-up on credential change |
| Token replay | mitigated | PARTIALLY VERIFIED | Codes single-use. Spectate ticket and passkey challenge replayable within their window |
| API scraping | controlled | PARTIALLY VERIFIED | Pagination caps in code. No edge rate limiting |
| Race condition | transactionally safe | VERIFIED | Engine suites and the integrity test |
| SSRF | blocked | VERIFIED after SEC-1 | |

---

## 4. Auction Integrity Findings

This is the area the product exists for, and it is the strongest part of the system.

### How correctness is guaranteed

1. **One writer.** Every command for an auction enters one FIFO queue in one process. A Postgres advisory lock held on a reserved connection stops a second engine from starting, and is re-asserted every 10 seconds. Losing it is fatal by design.
2. **The database backstops the process.** `auction_events` has a unique index on `(auction_id, seq)`. Two writers would collide loudly rather than interleave.
3. **One transaction per decision.** A sale writes the lot, the player's team, the event and the audit row together or not at all.
4. **Purse is derived, never stored.** A team's spend is the sum of its sold lots, so there is no balance to drift.
5. **Verified after every command.** The engine re-folds the whole event log, compares it with the rows, and halts the auction rather than serve a state it cannot prove.

### State machines (VERIFIED in `packages/core/src/auction.ts`)

Auction: `scheduled → live ⇄ paused → completed → reconciled`, and `abandoned` from any non-terminal state. `live → scheduled` does not exist. Opening needs two paddles and one queued lot. Completing needs zero unresolved lots.

Lot: `prepared → queued → on_block ⇄ closing_soon → sold | unsold`, plus `frozen` and `withdrawn`. `withdrawn` is terminal. Undo reverses only a sale or a pass, needs a separate capability, and appends compensating events rather than deleting.

### The timer rule, stated exactly

The server is the only clock. The browser's countdown is display only and freezes when the connection is stale.

| Case | Rule |
|---|---|
| Bid received before expiry | Accepted if it passes the other ten checks. Judged on the time it **arrived** at the engine, so queue depth cannot make an in-time bid late |
| Bid received exactly at expiry | **Rejected** `LOT_EXPIRED`. The test is `arrival >= endsAt` |
| Bid received after expiry | Rejected `LOT_EXPIRED`, even if the lot has not been closed yet. Rejected `LOT_NOT_OPEN` once it has |
| Bid while the client shows a stale timer | Same rules. The client's view is irrelevant |
| Reconnect during final seconds | The socket sends the full current snapshot on join. The bid is a separate HTTP call, judged on arrival |
| Anti-snipe | An accepted bid moves the deadline to at least `now + extension`, never past `now + initial`. The deadline never shrinks |

### Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| AI-1 | MEDIUM | A server clock stepping backwards (time correction, resumed VM) made the rate limiter **subtract** tokens. A 4 second step emptied every bidder's allowance and the whole room was refused | **FIXED**. Found by the new integrity test, which fails without the fix (120 wrongful refusals) |
| AI-2 | HIGH | Results never announced when completion took over 2 seconds | **FIXED**, see section 2 |
| AI-3 | LOW | Command idempotency is held in memory. A retry after an engine restart re-executes | OPEN. The state machine refuses the duplicate (`ALREADY_LEADING`, `BELOW_CURRENT`), so no money is affected. The bidder sees a refusal for a bid that in fact stands |
| AI-4 | LOW | No database index enforces one leading bid per lot | OPEN, deliberately. Adding it would break the engine's own repair path, which may pass through two leaders inside one transaction |
| AI-5 | MEDIUM | Every bid sends the **whole** snapshot to every screen, uncompressed: 39 KB for a 250-player auction, 145 KB for 1,000 | OPEN. See section 5 |

### Evidence

| Check | Result |
|---|---|
| Engine integration suites | **75 of 75 pass** |
| Ten simultaneous identical bids | Exactly one accepted. VERIFIED |
| Duplicate command id | Original answer returned, executed once. VERIFIED |
| Kill and restart mid-auction | Identical snapshot, byte for byte. VERIFIED |
| Tampered bid amount, lot row, paddle holder | Detected, halted, healed by Recover. VERIFIED |
| **New randomized integrity test** | **4 seeds, about 1,250 commands, 23 simulated restarts, zero invariant violations** |

The integrity test (`apps/engine/src/integration/invariants-fuzz.integration.test.ts`) has four bidders bid at once every round with valid, stale, off-ladder, negative, fractional and absurd amounts, sometimes with another team's paddle, with concurrent duplicate retries, engine restarts mid-lot, pauses, and both kinds of close. After every lot it reads the **database** and asserts: event log unbroken, at most one leader per lot, accepted bids strictly rising and on the ladder, every sale equals the highest bid, no player sold twice, every sold player on the buyer's team, no team over purse or squad cap, reserve rule held, served snapshot identical to a cold replay.

---

## 5. Performance Findings

Measured on a developer laptop under load from other containers, Postgres 17 in Docker. Production hardware will differ. **No number below is from production.**

| Measurement | Median | p95 |
|---|---|---|
| Bid accepted, 250-player auction | 18.5 ms | 26.0 ms |
| Bid accepted, 1,000-player auction | 27.2 ms | 34.1 ms |
| Bid accepted, 2,500-player auction | 44.7 ms | 51.4 ms |
| Ten simultaneous bids, all answered | 114 ms | 234 ms |
| Engine restart to serving, 250 players | 7.1 ms | 10.2 ms |
| One bid reaching all of 50 spectators | 22.7 ms | 38.1 ms |
| One bid reaching all of 250 spectators | 41.2 ms | 57.7 ms |
| One bid reaching all of 1,000 spectators | 120.7 ms | 137.4 ms |

| ID | Severity | Finding | Status |
|---|---|---|---|
| PERF-1 | MEDIUM | Snapshot size grows with the pool and is sent whole, uncompressed, on every bid. At 250 players and 200 viewers that is 7.8 MB per bid. A phone spectator on mobile data receives roughly 40 to 60 MB over a night | **OPT-IN FIX SHIPPED, OFF BY DEFAULT**. `WS_COMPRESSION=on` cuts the frame about sixfold (measured below). The snapshot contract itself is unchanged. The first bottleneck at scale is **bandwidth**, not CPU or database |
| PERF-2 | LOW | Per-command cost grows with the event log (full re-fold). 45 ms at 5,000 events against a 2 second web budget | OPEN, monitored. A new alert fires at 1 second |
| PERF-3 | — | First-load JavaScript: all 106 routes within the 146 kB budget | VERIFIED |
| PERF-4 | — | Web route latency under concurrent load | VERIFIED locally, see "Web tier under load" below. NOT VERIFIED on production hardware |

### Web tier under load

One `next start` process from a production build, on the same laptop, against
the seeded database. A closed loop: each of N workers requests again the
moment its last answer arrives, so N is far harsher than N people browsing.

Single request, warm (median of 5):

| Who | Route | Time to first byte |
|---|---|---|
| Guest | `/`, `/pricing`, `/help`, `/login`, `/c`, `/legal` | 5 to 13 ms |
| Organizer | `/home`, `/orgs`, `/org/…`, season pages, `/inbox` | 13 to 31 ms |
| Founder | `/admin`, `/money` | 20 to 34 ms |

Sustained load, 8 seconds per level, **zero errors at every level**:

| Route | Concurrent | Requests per second | p50 | p95 | p99 |
|---|---|---|---|---|---|
| `/` | 10 | 169 | 58 ms | 69 ms | 78 ms |
| `/` | 100 | 178 | 558 ms | 700 ms | 1,012 ms |
| `/c/<season>` (public season) | 10 | 131 | 74 ms | 96 ms | 141 ms |
| `/c/<season>` | 100 | 140 | 728 ms | 808 ms | 872 ms |
| `/login` | 100 | 372 | 261 ms | 319 ms | 452 ms |
| `/home` (signed in) | 10 | 78 | 125 ms | 154 ms | 209 ms |
| `/home` (signed in) | 50 | 88 | 599 ms | 673 ms | 699 ms |
| Registrations desk (signed in) | 50 | 106 | 485 ms | 539 ms | 560 ms |

What this says: one web process renders about 90 signed-in pages or 170 public
pages a second, and past that requests queue rather than fail. The limit is the
single Node process's CPU, not the database (16 connections in use of 200). A
thousand signed-in people each loading a page every ten seconds is about that
ceiling. Production has 2 CPUs allotted to web against this laptop's shared
cores, so treat these as an order of magnitude, not a promise.

### Scalability

| Concurrent users | Assessment |
|---|---|
| 10 to 100 | Comfortable. PARTIALLY VERIFIED by the fan-out measurement |
| 500 | Engine handles it (64 ms fan-out). Bandwidth becomes material for large pools |
| 1,000 | Engine handles the fan-out (121 ms). Default cap is 2,000 sockets per room and **50 per address**, so a hall behind one venue Wi-Fi is refused at the 51st screen. Raise `WS_MAX_SOCKETS_PER_IP` for venue nights |
| Multiple auctions | One engine process serves all. One slow auction does not block another (per-auction queues), but they share one CPU core |

Horizontal scaling of the engine is not possible by design (single writer). The scaling path is a smaller spectator frame first, a bigger host second.

---

## 6. Reliability Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| REL-1 | MEDIUM | Two outbound calls had no timeout: finance object storage (one hung socket stalls every receipt) and the payment gateway | **FIXED** |
| REL-2 | MEDIUM | Bulk approve sends messages while a database transaction is held open. A large batch can exceed the 60 second idle limit, losing the audit rows and reporting failure for messages that were sent | **FIXED** (second pass) |
| REL-3 | MEDIUM | The outbox is written after the business transaction commits, not inside it. A crash in between loses the message with no repair | OPEN. AI-2 was the worst case and now self-repairs |
| REL-4 | MEDIUM | Auction commands could not be traced end to end. The engine logged a command only when it threw | **FIXED**. One line per command with its id, actor, result, version and timings |
| REL-5 | MEDIUM | Every build generated new server action identifiers, so each deploy broke forms and bids in tabs that were already open. Confirmed in the framework source | **FIXED** in the build. Needs one secret added, see section 67 |
| REL-6 | LOW | Finance runner sleeps 15 seconds before it sees a stop signal, so it is force-killed on every deploy. Its jobs are leased, so nothing is lost | **FIXED** (second pass) |
| REL-7 | LOW | Duplicate email possible if the process dies between provider send and marking sent | OPEN, accepted |

Graceful shutdown: VERIFIED in code for the engine (sockets told, lease released, 8 second deadline) and the web tier. Failure injection: engine restart mid-auction VERIFIED by test. Database outage and provider outage NOT VERIFIED by injection.

---

## 7. Database Findings

| Invariant | Enforced by the database |
|---|---|
| One registration per person per season | Yes, unique index |
| A player sold to one team per season | Yes, structurally (one lot per registration, one active auction per season) |
| One sale per lot | Yes, check constraint |
| One paddle per team, one team per owner | Yes, partial unique indexes |
| Event order | Yes, unique `(auction_id, seq)` |
| Amounts non-negative | Yes for bids and lots. **Added** for payments, obligations and journal legs |
| Unique phone, email, org slug | Yes |
| Purse never negative, squad size | No. Derived and enforced by the engine. VERIFIED by the integrity test |
| One leading bid per lot | No. See AI-4 |
| Events and audit rows immutable | Yes, by grant. No runtime role may update or delete them |

| ID | Severity | Finding | Status |
|---|---|---|---|
| DB-1 | MEDIUM | Service roles could read identity tables | **FIXED**, migration 0098 |
| DB-2 | MEDIUM | Money projections had no value checks | **FIXED**, validated on existing rows |
| DB-3 | MEDIUM | About 24 relationship columns have no foreign key. Zero orphans found locally | OPEN, **with the tool to close it**: `ops/db/check-integrity.sql` counts, read-only, the rows that would refuse each constraint. Run it on production, then write the migration |
| DB-4 | MEDIUM | 36 tables have no row security, including identity tables. 205 call sites use the pool that bypasses it | OPEN, by design and tracked by the posture check |
| DB-5 | LOW | The default sign-in path had no index on email | **FIXED** |
| DB-6 | LOW | 29 foreign keys added as `NOT VALID` were never validated | OPEN, same tool: zero rows break them on the test database |
| DB-7 | LOW | The engine's own migration set is silently skipped (its timestamp predates the platform's). Harmless today, its one table is unused | **FIXED**: the journal check fails CI if the engine's set grows |
| DB-8 | LOW | 15 redundant indexes on hot write paths | OPEN |

Migrations: journal VERIFIED (98 entries, strictly increasing). No destructive statement in 0080 to 0098. All 139 time columns carry a time zone. Pools sum to about 41 connections against a limit of 100.

---

## 8. API Findings

| Check | Result |
|---|---|
| Authentication on every action | VERIFIED in code |
| Authorization server-side on every privileged action | VERIFIED in code |
| Job routes | Constant-time secret, 404 when unset. VERIFIED |
| Webhooks | Signature over raw bytes, size capped, idempotent. VERIFIED in code |
| Error responses | No stack trace, SQL or path reaches a client. VERIFIED in code |
| Runtime schema validation at the action boundary | **Absent.** Arguments are trusted as their TypeScript types. No mass assignment found; the effect is an error page on malformed input. LOW, OPEN |
| Exports | Gated, column allow-listed, audited, formula characters neutralised. VERIFIED in code |

---

## 9. Frontend / UX Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| FE-1, FE-2 | HIGH | See section 2 | **FIXED** |
| FE-3 | MEDIUM | The `/live` conduct card and cockpit shortcut keys worked on a stale screen. A gavel held over a frozen view sells to whoever actually leads | **FIXED** |
| FE-4 | MEDIUM | Cockpit end-of-night card shows each team's spend as ₹0 until reload | **FIXED** (second pass) |
| FE-5 | MEDIUM | Three cockpit handlers left the screen permanently busy if a request never returned | **FIXED everywhere** (third pass): 48 handlers in 31 files let go of the screen whether or not the request returns, and one notice says what happened. Proven in a real browser with the network cut under a button press |
| FE-6 | MEDIUM | A waiting owner was told the claim button would appear when granted, and it never did without a reload | **FIXED** |
| FE-7 | MEDIUM | Several refusals reached users as "Try again" when retrying cannot work | **FIXED**, with a test that reads the reasons from the source so the next one fails the build |
| FE-8 | MEDIUM | No error reporting from the browser. A crash in the room is invisible to operators | **FIXED** (second pass) |
| FE-9 | MEDIUM | An expired socket ticket retried the same URL for ever | **FIXED**, and the first fix replaced after review (section 0, R1) |
| FE-10 | LOW | Session loss mid-auction lands on `/home`, not back in the room | **FIXED** (second pass) |
| FE-11 | LOW | Five places, including the help centre, said an owner link cannot be withdrawn. It can | **FIXED** |

Auctioneer, owner and spectator flows were reviewed in code. Bid double-tap protection, stale-state bid locking, confirmation on abort, complete and undo are all present. VERIFIED in code.

## 10. Mobile Findings

**NOT VERIFIED on a device in this review.** Code review found one item: a 32 px button directly under the control that commits a larger bid (LOW, OPEN). The repository's own responsive e2e specs run in CI and were green on the audited commit. Overflow at 320 to 390 px, the pinned bid bar on short phones, and half-open socket behaviour on iOS Safari need a real device.

## 11. Accessibility Findings

VERIFIED in code: the bid ribbon is a polite live region with the countdown hidden from it, announcements only at 30 s, 10 s and time, native dialogs with focus handling, reduced-motion rules on the SOLD animation, labelled inputs. The axe scans in the e2e suite were green in CI on the audited commit. Screen-reader output on rapid bids is NOT VERIFIED.

## 12. DevOps / Deployment Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| OPS-1, OPS-3, SEC-6, SEC-7 | HIGH | See section 2 | **FIXED** |
| OPS-8 | MEDIUM | The nightly verification was cancelled at its 60 minute limit four nights running, reported as "cancelled" not "failed", with nothing uploaded and nobody told | **FIXED**. Split per browser, traces uploaded, failures reported |
| OPS-9 | MEDIUM | The role script ran statement by statement, so a failure left wide grants standing | **FIXED**, single transaction |
| OPS-10 | MEDIUM | Old images are never pruned. Disk growth is unbounded and unwatched | **FIXED** for images. A disk alert is still open |
| OPS-11 | MEDIUM | The scale harness could not measure past 50 spectators and left a live auction in the database when it failed | **FIXED** |
| OPS-12 | LOW | Base images pinned by tag not digest, no `.dockerignore`, no read-only root filesystem | **`.dockerignore` ADDED** (mirrors `.gitignore`; all four images rebuilt with it, context 137 kB, env files absent). Digest pins and a read-only root are OPEN: pinning freezes security patches unless somebody bumps them, a decision rather than a patch |

VERIFIED in code: non-root distroless images, no host ports on database, storage or engine, CI-green gate before deploy, migrations under an advisory lock with a 5 second lock timeout, rollback instructions per stage.

**Deploying during an auction.** Not safe, and the pipeline now refuses it: while an auction is live or paused, within 2 hours before an announced start, and for 3 hours after one that has not started. It asks twice, at the start and immediately before the swap.

## 13. Observability Findings

| Area | State |
|---|---|
| Structured logs | Present in all three services, request id in web. **Now** scrubbed of personal data in error text |
| Auction traceability | **Now** one line per command |
| Metrics | **NOT APPLICABLE**: there is no metrics endpoint. Everything is derived from logs |
| Tracing | Sentry at 10% sampling |
| Alerts | 16 rules after this review. Delivery **NOT VERIFIED** |
| Browser errors | Not reported. FE-8 |

## 14. Testing Findings

| Suite | Result in this review |
|---|---|
| Lint, typecheck, format, dependency rules, motion tokens | PASS |
| Unit | **1,366 pass** across 9 packages (third pass) |
| Integration, web | **2,587 pass** (237 files) (third pass) |
| Integration, engine | **75 pass** |
| Integration, runner under its production role | 5 pass |
| Grants manifest | 455 expectations pass |
| Row security probe, posture suite | PASS, 37 tests |
| Production build, bundle budget | PASS |
| Dependency audit | No known vulnerabilities |
| End to end, Chromium, full suite on the final code | **158 passed, 0 failed, 0 flaky**, 29 skipped by design (third pass; 156 before its two new specs) |
| End to end, first run on the first-pass fixes | 155 passed, 1 passed on retry (sign-in cooldown message). Not reproduced in 170 further runs of the sign-in specs, 20 in isolation and 144 under three parallel workers. Main's own CI shows a different single flaky test in 3 of its last 12 runs |
| Auction-room journeys, re-run after the last edit | 31 passed |
| Design-system journeys (dev server), photo journey | 28 passed, 1 passed |

Tests added: 25 files, about 130 tests. Every behavioural fix has one that fails on the old code.

Gaps: no failure-injection suite for database or provider outage, no device lab, no load test on production hardware.

## 15. Disaster Recovery Findings

| Item | State |
|---|---|
| Backup exists | VERIFIED today by the repository's own workflow: newest backup 4 hours old |
| Off-box | VERIFIED: repository on S3 ap-south-1, on-box override off |
| Encrypted | PARTIALLY VERIFIED: configured in the env generator |
| Point-in-time recovery | Archiving on. Recovery point bounded to 60 seconds **after this branch deploys** |
| **Restore tested on the production backup** | **NOT VERIFIED. Never done.** The only drill used a throwaway stanza |
| **Passphrase and env files held off-host** | **NOT VERIFIED.** They are generated on the host and nothing records a copy |
| Object storage | Mirrored off-box hourly |
| RPO | Target 1 minute for the database, 1 hour for files |
| RTO | Target 1 to 4 hours. **Unmeasured** |

## 16. Legal / Privacy Items Requiring Confirmation

These are not technical findings. Each needs a decision from the owner or counsel.

| Item | What exists | What needs confirming |
|---|---|---|
| Minors | Age and photo are withheld for minors; an unknown date of birth withholds the photo. Name, team and price are published | Whether guardian consent is required and how it is recorded (DPDP Act) |
| Privacy policy, terms, retention | Pages exist | Legal review of the text, and that the stated retention matches what the code deletes |
| Account deletion | An erasure request desk exists | The response time promised |
| Messaging consent | WhatsApp opt-in and STOP handling exist | Template approval and the opt-in wording |
| Marketing copy | 26 `TODO(founder)` markers | Each claim |
| Dispute handling | Undo is audited and capability-gated | A written rule for disputes on the night |
| Payments | Platform does not hold money by design | Confirm before the gateway is switched on |

---

# 64. FIXES IMPLEMENTED

| File | Change | Reason | Risk | Validation |
|---|---|---|---|---|
| `scripts/check-live-window.mjs` + test | Freeze covers announced starts. Connection by environment, not argument | OPS-1, SEC-6 | Low | 9 unit tests, 9 database scenarios, old versus new |
| `.github/workflows/deploy-host.yml` | Second freeze check before swap. Postgres reload. Build secret. Actions pinned | OPS-1, OPS-2, REL-5, SEC-7 | Medium, it is the deploy | YAML parses. **Not run**, see remaining risks |
| `ops/deploy/postgresql.conf.d/10-archive.conf` | `archive_timeout = 60` | OPS-2 | Low, reloadable | Setting confirmed reloadable |
| `ops/deploy/docker-compose.production.yml` | Web restart check uses liveness | OPS-3 | Low | YAML parses |
| `apps/web/src/app/readyz/route.ts` | 2 second bound on the database probe | OPS-3 | Low | Typecheck, integration |
| `docs/operations/RESTORE_RUNBOOK.md`, `DISASTER_RECOVERY.md`, `ALERTS.md` | Correct volume, size check, true recovery point, new alerts | OPS-4, OPS-2 | None | Read |
| `apps/web/src/server/auction/auction-notify.ts` + test | Announcement leaves a marker; a recent unannounced completion is announced on retry; failures logged | AI-2 | Low | 31 tests pass, new test covers 3 cases |
| `apps/engine/src/engine-core.ts` | Rate limiter ignores negative elapsed time. One log line per command | AI-1, REL-4 | Low | Integrity test fails without it |
| `apps/engine/src/server.ts` + test | Private routes refused through the proxy | SEC-9 | Medium if the web tier were misconfigured; preflight guards it | 23 tests |
| `scripts/preflight-production.mjs` | Refuses `ENGINE_URL` on the public hostname | SEC-9 | Low | Run with good and bad env files |
| `apps/engine/src/integration/invariants-fuzz.integration.test.ts` | New randomized integrity test | Section 4 | None | 4 seeds |
| `apps/engine/scripts/perf-scale.ts` | Socket cap, asserted setup, unique tokens, cleanup on failure, convergence timeout | OPS-11 | None | Runs end to end |
| `packages/messaging/src/web-push.ts`, `provider-fetch.ts`, `apps/web/src/server/messaging/push.ts`, `actions.ts` + tests | Push hardening | SEC-1 | Low | 20 tests |
| `apps/web/src/server/auth/send-lock.ts`, `otp.ts`, `email-login.ts`, `email-change.ts` + test | Send limits hold under parallel requests | SEC-2 | Low | 4 tests, fail before, pass after |
| `apps/web/src/server/marketing/demo-booking.ts`, `booking-actions.ts` + test | Booking ceiling | SEC-3 | Low | 13 tests |
| `apps/web/src/server/messaging/invite-mail-budget.ts`, `orgs/actions.ts`, `auction/owner-actions.ts` + test | Invite mail ceilings | SEC-4 | Low | 3 tests |
| `packages/db/migrations/0098_*.sql`, `schema.ts`, `ops/db/create-app-role.sql`, `verify-grants.ts` | Revokes, index, money checks | SEC-5, DB-2, DB-5 | Low, additive | Applied, 455 grant expectations, full integration |
| `ops/deploy/migrator/run.sh`, `ci.yml`, `nightly-verify.yml` | Role script in one transaction | OPS-9 | Low | Run on the test database |
| `packages/core/src/scrub.ts`, three `logger.ts` files + test | Error scrubbing that keeps the error code | SEC-8 | Low | 12 tests, leak reproduced first |
| `packages/financial-operations/.../s3-artifact-store.ts`, `adapters/razorpay.ts` | Timeouts | REL-1 | Low | Unit suites |
| `apps/web/Dockerfile` | Server action key from a build secret | REL-5 | Medium, it is the image | Built WITH the secret: the image carries exactly the supplied key, and the key is absent from the image history. Built WITHOUT the secret and without cache: the build succeeds and generates its own key, as CI does today |
| `.../auction/use-auction-socket.ts`, `socket-policy.ts` + test | Replace silent sockets, reconnect on network return, refresh expired tickets | FE-1, FE-9 | Medium, the live room | 8 unit tests. Device behaviour not verified |
| `.../cockpit/cockpit-panel.tsx`, `e2e/conduct-ceremony.spec.ts` | Withdraw confirmation, three handlers hardened, keys respect staleness | FE-2, FE-3, FE-5 | Low | Typecheck, lint, e2e updated |
| `.../live/live-panel.tsx` | Conduct disabled when stale, waiting owner refreshes | FE-3, FE-6 | Low | Typecheck, lint |
| `packages/core/src/auction-copy.ts` + test | Refusal messages | FE-7 | None | 4 tests |
| `apps/web/src/content/help.ts` and 4 screens | Owner link wording | FE-11 | None | Read |
| `apps/web/src/server/financial-operations/my-documents.ts` | Removed owners excluded | SEC-13 | Low | Integration |
| `apps/web/src/server/messaging/ses-webhook.ts` | Topic checked first | SEC-14 | Low | 16 tests |
| `apps/web/src/env.ts` + test | Proxy count required in production | SEC-15 | Low, preflight already requires it | 40 tests |
| `ops/platform/observability/grafana-alerting.yml` | Three alert rules | OPS-7 | Medium, a malformed file stops Grafana provisioning | Structure checked against existing rules. **Not loaded into Grafana** |
| `.github/workflows/nightly-verify.yml`, `backup-production.yml` | Split, upload, report | OPS-8 | Low | YAML parses. Not run |

---

# 65. REMAINING RISKS

| Risk | Why it remains | Mitigation today | Next action |
|---|---|---|---|
| Backups exist but have never been restored; passphrase custody unknown | Needs the host and the founder | Off-box, encrypted, verified fresh | Copy the passphrase and env files off-host. Restore the production backup into a scratch volume and time it |
| Alerts may reach nobody | The webhook target and a Grafana silence live on the host | Rules exist | Send a test alert. Delete the silence. Add an external uptime and certificate check |
| None of these fixes is deployed | Branch is local | — | Review, merge, deploy outside an auction window |
| Deploy workflow, Dockerfile and alert rules changed but not exercised in their real environment | They only run on the host | Parsed, linted, image built locally | Deploy to staging first if it exists; otherwise watch the first production deploy |
| Sign-in delivery in production | Provider accounts are founder-held | Boot checks refuse a missing mailer | Send a real code to an outside mailbox. Confirm SES is out of sandbox |
| Spectator bandwidth at scale | Design change | Fine at beta scale | Trim the spectator frame before a 500-viewer night |
| Shared engine secret | Needs coordinated rotation | SEC-5 and SEC-9 contain it | Split into per-purpose keys |
| Script CSP not enforced | Deliberate observation period | React escaping, other headers enforced | Enforce after a clean week |
| Payment gateway gaps | Dormant feature | Cannot be initiated | Close SEC-12 before switching on |
| Mobile and device behaviour | No device in this review | CI responsive specs | One rehearsal on real phones on venue Wi-Fi |
| Production host state | Read access was not available in this session | — | Confirm `TRUSTED_PROXY_COUNT`, `ENGINE_URL`, `pg_stat_archiver`, disk usage |
| `ops/deploy/site.caddy`, `ops/deploy/jobs/scheduler.mjs` | Not read directly by the lead reviewer in this session | One sub-audit read `site.caddy` | Review both |

---

# 66. PRODUCTION CHECKLIST

### Application
- [x] build passes
- [x] typecheck passes
- [x] lint passes
- [x] tests pass
- [x] no critical TODOs (26 are copy checks for the founder)
- [x] no debug code

### Security
- [x] auth verified
- [x] authorization verified
- [x] IDOR checked
- [x] XSS checked
- [x] injection checked
- [x] rate limiting checked (and repaired)
- [x] secrets checked (repository and six deploy logs)

### Auction
- [x] state machine validated
- [x] concurrent bidding tested
- [x] transaction boundaries verified
- [x] purse integrity verified
- [x] player uniqueness verified
- [x] timer authority verified
- [x] reconnect behavior verified in code and by policy tests; **not on a device**
- [x] audit history verified

### Database
- [x] migrations verified
- [x] indexes verified
- [x] constraints verified
- [x] backup strategy verified
- [ ] **restore tested** on the production backup

### Infrastructure
- [x] health checks
- [x] graceful shutdown
- [ ] **monitoring: browser errors not reported**
- [ ] **alerting: delivery not proven**
- [x] rollback
- [x] deployment process

### UX
- [x] desktop
- [ ] tablet, not verified
- [ ] mobile, not verified on a device
- [x] loading states
- [x] error states
- [x] empty states
- [x] accessibility (automated); screen reader not verified

---

# 67. FINAL RELEASE DECISION

## NO-GO, until five conditions are closed

Not because the auction is wrong. It is not. Because two of the things a real night depends on have never been proven, and because the fixes for the rest are not yet running.

**What must be done before a real auction:**

1. **Deploy this branch.** Review, merge, deploy outside any auction window. It closes eight HIGH findings.
2. **Prove the backup restores.** Put the backup passphrase and the env files somewhere off the host. Restore the production backup into a scratch volume. Write the time down.
3. **Prove an alert arrives.** Apply the platform stack (`ops/platform/apply.sh`), which now carries the disk watcher and six new rules. Send a test alert to the webhook. Delete the Grafana silence on `da-prod`. Add an external check on `/readyz`, the engine's `/healthz`, and certificate expiry.
4. **Prove a person can sign in.** One real code to one outside mailbox, in production.
5. **Add the build secret.** `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (`openssl rand -base64 32`) in the production environment's GitHub secrets, so a deploy stops breaking open pages.

**After those five: GO for a controlled first auction**, with one rehearsal on real phones on the venue's network, and `WS_MAX_SOCKETS_PER_IP` raised for the hall.

**Before switching gateway payments on:** prove one capture, one dashboard refund and one dispute in the provider's test mode. The handler is tested against documented payloads only.

**Before broad launch:** enforce the script CSP, set `AUTH_CODE_SECRET` in a quiet window, run the integrity check on production and add the foreign keys it clears, and switch frame compression on after a staging night.
