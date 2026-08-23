# RH-1 — Full production rehearsal

> 2026-08-22 · Principal QA / Product Engineering / UX / Auction Operations
> Question asked: **"If we run a real cricket auction tomorrow — 6 teams, 6 captains, 80 registered players, 78 sold — will DesiAuction hold?"**
> Method: a real Chromium browser driving the real product. Not the e2e suite.

---

## 1 · Executive summary

**Verdict: GO WITH CONDITIONS.**

The auction engine is the strongest part of this product and it held under everything
I could throw at it. Six independent devices firing near-simultaneous raises produced
exactly one accepted bid per round, every time, with all six converging on an identical
snapshot version. A full 78-player auction ran to completion in 4½ minutes and every
downstream surface — squads, purses, the public player pages, and settlement dues —
reconciled to the rupee, *including* a mid-auction undo and re-sale.

What is not ready is the layer around it. Eight real defects were found and fixed during
this rehearsal. Their common shape matters more than any one of them: **the server was
right and the interface was wrong.** Authorization never leaked, money was never
overspent, the ledger never disagreed with itself. But the product repeatedly *offered*
actions it knew would be refused, and displayed confident numbers where it had no data.
On auction night that is not a cosmetic problem — it is the difference between a captain
who knows they are out of money and one who hammers a gold button that does nothing.

Two conditions stand between this and an unqualified GO, and neither is engineering:
a real SMS provider and a real object store must be configured and exercised. Until
`OTP_PROVIDER=msg91` and `MEDIA_STORAGE=bucket` have sent one real code and stored one
real photo in a deployed environment, the two things every player touches first have
never run in anger.

### What was actually exercised

| | |
|---|---|
| Real browser sessions driven | 7 concurrent (1 conductor + 6 captains), independent cookie jars |
| Players registered | **80** (8 self-registered through the mobile UI, 72 by CSV import) |
| Players sold | **78** — 13 to each of 6 teams, 2 left unsold, verified in the database |
| Bids placed through the UI | 258 (230 in the main auction, 28 in the concurrency cup) |
| Auction events written | 599 |
| Screens × viewports audited | 152 combinations across 8 widths (375 → 1440px) |
| Defects found | 12 (8 fixed here, 4 reported) |

---

## 2 · Application understanding

DesiAuction is a five-noun system, and the nouns are unusually well separated.

```
Person ──grant──> Org ──> Competition (season) ──> Team ──paddle──> Auction ──lot──> Registration
                                                                        │
                                                                        └──> Settlement case ──> Finance
```

**Identity** is a phone number, verified by OTP. There are no passwords and no team
logins — a "captain" is a person holding a `team:bid` paddle, which is the end of a
four-step chain of explicit acts: organizer *invites* → owner *accepts* → organizer
*grants* → owner *claims*. Nothing about that chain can be short-circuited, and I could
not find a way to bid without completing all four.

**Capabilities are partitioned, deliberately.** `org:owner` confers zero settlement
power and a settlement grant confers zero auction power. Two engines, neither able to
expand the other's vocabulary. This is correct and it is also the single most surprising
thing in the product (§7).

**The auction is a single-writer event-sourced engine** (`apps/engine`, Fastify + ws).
The web tier authenticates and submits commands; the engine decides, appends to an
append-only log, rebuilds projections, verifies them against the rows, and broadcasts.
When the rows and the log disagree it **halts** rather than serve state it cannot prove —
I triggered this accidentally with a hand-edit and it caught me immediately (§9).

**Money is paise integers throughout.** Purse is a projection (`purse − Σ purchases`),
never a stored balance. I found no floating-point arithmetic anywhere on the money path.

**The bid gauntlet** is eleven ordered checks in `packages/core` — lot open, authorized,
not already leading, valid amount, ≥ base, > current, on the increment ladder, within
purse, reserve rule, squad not full, role quota. Every one of them is enforced
server-side. The defects I found are all cases where the *client* did not mirror one.

---

## 3 · Test environment

| | |
|---|---|
| Build | **Production** (`next build` + `next start`), not `next dev` |
| Web | `http://127.0.0.1:3100` |
| Engine | `http://127.0.0.1:4000` (Fastify + WebSocket) |
| Database | Postgres 17, docker-compose `:5433` |
| Storage | MinIO `:9000`, `MEDIA_STORAGE=local` |
| Browser | Real Chromium via Playwright — 7 independent `BrowserContext`s |
| Harness | `apps/web/rehearsal/` — see its README |
| Artifacts | ~90 screenshots and JSON metrics, gitignored (≈40 MB) |

I moved from `next dev` to a production build early: the dev server restarted twice
under memory pressure and produced a fake "Something broke on our side" that I nearly
logged as a P0. **That was the harness, not the product**, and it is recorded here so
nobody re-discovers it. Under `next start` the server was stable for the entire run.

**Honesty note.** An unrelated container from another project on this machine occupies
`:3000`. I moved DesiAuction to `:3100` rather than stop somebody else's service. This
means absolute URLs in the product (invite links, share links) render as `127.0.0.1:3100`
in the screenshots. Nothing else was affected.

---

## 4 · Test dataset

**Season:** "Sunrise Premier League 2026", Andheri Mumbai, created through the UI.
**Teams (created through the UI, with short names and colours):**
Sunrise Titans · Warriors · Strikers · Chargers · Royals · Rangers.

**Captains — six real accounts, six phone numbers, six browser contexts:**

| Captain | Phone | Team | Paddle |
|---|---|---|---|
| Kartik Raje | +91 88040 00001 | Sunrise Chargers | P01 |
| Aniruddh Bose | +91 88040 00002 | Sunrise Rangers | P02 |
| Mohsin Qureshi | +91 88040 00003 | Sunrise Royals | P03 |
| Devansh Trivedi | +91 88040 00004 | Sunrise Strikers | P04 |
| Sunil Gaonkar | +91 88040 00005 | Sunrise Titans | P05 |
| Rehan Merchant | +91 88040 00006 | Sunrise Warriors | P06 |

**Players:** 80 — realistic Indian names across four roles, three base-price bands
(₹50k / ₹25k / ₹10k), dates of birth, batting and bowling styles. 14 carry photos.
All synthetic; no real person's data was used.

**Rules of the night:** purse ₹20,00,000 per team · squad 13–13 · 30s lot timer ·
15s anti-snipe · slabs +₹5k below ₹1L, +₹10k below ₹5L, +₹25k above.

A second season, **"Sunrise Concurrency Cup"** (6 teams, 20 players, purse ₹1,00,000,
squad 2–4), was built purely to force money and squad limits to bite — the main auction's
generous purse never approached them.

---

## 5 · Registration results

### Self-registration through the mobile UI — **PASS**

Eight players registered on 375/390/412px viewports, cold, from a shared link, exactly as
a WhatsApp recipient would. The flow is genuinely good:

- A signed-out visitor to a **public** season sees what the season is, when it is, and
  **what they will be asked**, before any sign-in wall. Verification happens at submit,
  not at look.
- Three derived steps (name → how you play → review). State is derived from server truth,
  so the wizard cannot desync.
- **Draft recovery works.** I filled name + role + date of birth, hard-refreshed, and the
  page came back at the review step saying *"We brought back the answers you had already
  given"* with the date of birth intact.
- The consent gate is real: submit is refused until the player ticks a box that names,
  in plain sentences, exactly what becomes public and what does not.
- **No horizontal overflow at any width. Zero console errors.**

### Validation — **PASS**

| Probe | Result |
|---|---|
| Empty required name | Continue disabled / server-refused |
| 80-character name | *"That's a bit long — 60 characters or fewer."* |
| Special characters, apostrophes, double spaces | Accepted and normalised |
| Invalid phone (`12345`) | *"That doesn't look like an Indian mobile number — 10 digits starting 6–9."* |
| Duplicate registration (same phone, same season) | Existing status shown; **no second submit control exists** |
| 6 MB photo | *"Image must be 5 MB or smaller."* |
| Text file renamed `.png` | Server magic-byte check → 400, message shown |
| `text/plain` upload | Refused client-side; `accept` attribute correct |

### Photo upload — **was broken; fixed** (D-002)

A player uploading their own photo got **HTTP 403** and *"Upload failed. Please try
again."* — forever. See §17.

### Bulk import (CSV) — **PASS, with one operational caveat**

72 players imported in one commit. Per-row validation is excellent:

```
3 valid row(s) · 4 error(s)
Line 3: invalid phone "12345"
Line 4: invalid role ""
Line 6: invalid role "keeper"; duplicate phone in file (also line 2)
Line 7: name must be at least 3 characters
[Fix 4 errors to import]
```

**Caveat:** it is all-or-nothing. One typo in an 80-row sheet blocks all 80. For a
Google-Sheets-shaped world this is the wrong default (§6).

### Bulk photo import — **PASS, and better than expected**

14 files matched by three rules — registration number, phone, then full name — reviewed
in a table *before* a byte was uploaded, with 2 unmatched files clearly skipped. Zero
failures. This is the single most important existing capability for the Google Forms
question.

---

## 6 · Registration integration assessment

### The real problem

An organizer's players are in a WhatsApp group. They need to submit a name, a number, a
role and a photo, on a cheap Android phone, with no account. The organizer needs those
rows inside DesiAuction, deduplicated and approved, without retyping.

### What already exists (and it is most of the way there)

DesiAuction already ships a working ingestion layer:

```
CSV paste/upload → parse + per-row validation → preview → commit (one transaction)
                                                              ↓
                                     person stubs by phone · status = submitted
                                                              ↓
                                      organizer triage → approved → auction pool
Photos: folder of images → matched by reg-number / phone / name → reviewed → uploaded
```

That is exactly the "controlled ingestion, never direct mutation" architecture the brief
asks for, and it is already built, already transactional, already audited, and already
deduplicating on verified phone.

### Recommendation

```
Recommended approach:  Google Form → Google Sheet → organizer exports CSV + downloads
                       the Drive photo folder → DesiAuction CSV import + photo import.
                       Manual export, NOT an automated Apps Script sync — for now.

Why:                   • Every piece already exists and is tested. Net new code: a column
                         mapper and a header-tolerant parser (small).
                       • Google Forms is free, mobile-first, needs no account, and every
                         Indian club organizer has already used one.
                       • Photo upload to Drive is the one thing Forms does well and
                         DesiAuction's own public form does not do for signed-out users.
                       • A manual export keeps the human approval gate honest and avoids
                         a background sync that fails silently at 11pm the night before
                         an auction — the worst possible failure mode.

Architecture:          Player → Google Form (name, phone, role, band, photo)
                              → Google Sheet (rows) + Drive folder (images)
                              → organizer: File ▸ Download ▸ CSV, and download the folder
                              → DesiAuction Import dialog: CSV tab, then Photos tab
                              → validation → preview → commit → triage → approve → pool

Complexity:            Implementation LOW. Three changes, all in the parser:
                       1. Tolerate Google Forms' header row ("Timestamp", "What is your
                          name?") via a column-mapping step in the dialog.
                       2. Allow a PARTIAL import: "import the 76 good rows, show me the 4"
                          (today one bad row blocks the file — see D-009).
                       3. Accept a Drive-shared image URL column as an alternative to the
                          filename matcher, so photos ride the same CSV.

Operational:           LOW. Two downloads and two pastes. ~10 minutes for 80 players.
Cost:                  ₹0. No API keys, no OAuth consent screen, no Google Cloud project.

Main risks:            • Phone formatting from a free-text Form field ("98765 43210",
                         "+91-98765-43210"). Mitigated: `normalizePhone` already handles
                         these, and the preview shows exactly what will be imported.
                       • Photo filenames from Drive are `IMG_20260812.jpg`, which match
                         nothing. Mitigated by the URL-column option above; without it the
                         organizer must rename files, which is the current reality.
                       • Duplicate submissions in the Form. Already handled: duplicate
                         phone in file is reported per-line, and duplicate against an
                         existing registration is skipped, not corrupted.

Fallback:              The product's own registration link, which is better than the Form
                       in every respect except signed-out photo upload, and which already
                       works on a phone.
```

**Do NOT build the Apps Script / webhook / scheduled-sync pipeline yet.** It adds an OAuth
surface, a token to rotate, a background job to monitor, and a class of silent failure
("the sync stopped on Tuesday") in exchange for saving one organizer two clicks. Revisit
it only when a customer runs multiple seasons a month.

**Do NOT adopt Tally or Typeform.** Both are better forms than Google's; neither gives you
a Drive folder of photos you can bulk-match, and both introduce a paid tier at exactly the
volume a real tournament hits.

---

## 7 · Admin / organizer workflow

**PASS with friction.** Everything an organizer needs exists and works: create season →
teams → open registration → publish → triage → close → rules of the night → create auction
→ invite owners → grant paddles → conduct → complete → settle.

Genuinely strong:

- The **readiness gates** are excellent. Every precondition is named with its current
  value: *"80 players for 6 squads of at least 13 (78 needed) — 2 to spare."* That single
  line is the whole brief's arithmetic, stated by the product before I asked.
- **Triage at volume works.** 55 registrations approved in one action via
  "Select all 55 matching", 13 seconds end to end.
- **Decline requires a reason** — the confirm button is disabled until one is chosen
  (invariant 6 holds).
- Refusals carry their fix: *"This season still needs dates before registration can open.
  [Add dates]"*.

Friction found (all logged in §17):

- The create-season affordance is inconsistent across `/home`, `/seasons` and `/tournaments`
  (D-005), and `/seasons` — the page whose entire subject is seasons — cannot create one.
- The end-of-night CTA led to a bare 404 (D-001, fixed).
- Accepted owners rendered as "No owner yet" (D-003, fixed).

---

## 8 · Six-captain multi-browser simulation

Six independent `BrowserContext`s — separate cookie jars, separate storage, phone-sized
viewports. Each captain went through the full cold journey: WhatsApp link → sign-in →
owner-join preview → accept → name gate → live room → claim paddle.

**The owner-join preview is the best screen in the product.** Before accepting, a captain
is told: the team, the tournament, *"₹20,00,000 purse to bid with — you owe what you
spend"*, *"A squad of up to 13 players"*, that they also become a club member, who invited
them, that the link works once, when it expires, and — unprompted — *"Anyone holding this
link can accept it, so don't forward it"*. It then says plainly that accepting does **not**
give them a paddle.

**Isolation held completely.**

| Check | Result |
|---|---|
| Correct team shown | ✅ each captain's claim selector offered exactly one team — their own |
| Correct purse | ✅ own purse in rupees; every rival shows **"purse sealed"** |
| Correct squad | ✅ own squad only |
| Cross-team leakage in the RSC payload | ✅ none — `committed` appears once (their own) |
| Rival team detail page | ✅ 200 with *"The squad is not yours to see"* — no phones, no money |
| Registrations tab | ✅ *"You don't have permission to review registrations"* |
| Cockpit / ledger / replay / engine / money | ✅ 404 |
| `/admin` | ✅ 404 |

The seal is enforced **server-side, before the payload leaves** — not hidden in markup.
I checked view-source.

---

## 9 · 78-player auction simulation

Run through the real cockpit and six real live rooms. No API shortcuts.

```
80 lots queued → opened one at a time → 2–3 rival raises per lot → gavel (600ms hold)
```

**Result — verified in the database, not the UI:**

```
Sunrise Chargers  13    ₹4,55,000        Registered  80
Sunrise Rangers   13    ₹5,05,000        Sold        78
Sunrise Royals    13    ₹4,85,000        Unsold       2
Sunrise Strikers  13    ₹4,60,000        Allocated   78  (registrations.team_id)
Sunrise Titans    13    ₹4,65,000        Total     ₹28,40,000
Sunrise Warriors  13    ₹4,70,000
```

**Exactly the brief's arithmetic, produced by the product.**

Wall-clock: **267 seconds** for 78 lots. Median 2.6s per lot including my scripted
deliberation — a real room is slower, which only helps.

### Undo, freeze and requeue — **PASS, and impressive**

I undid the last sale mid-run. The confirmation is the best-written destructive dialog I
have seen in this codebase:

> *"This reverses the sale of Kartik Yadav for ₹25,000 to Sunrise Warriors. The money goes
> back to their purse and the player leaves their squad. Nothing is deleted — the reversal
> is appended to the ledger and stays visible. The lot comes back frozen, with the clock
> stopped."*

It did exactly that. I then requeued the frozen lot, re-opened it, re-sold it at a
different price — and **settlement dues later matched the new price to the rupee**
(₹4,85,000 → ₹4,70,000 for Warriors, total ₹28,55,000 → ₹28,40,000). Compensating events
flow correctly all the way to the money.

Undo is correctly allowed only until the next lot opens.

### Projection-mismatch halt — **PASS (found by accident)**

I hand-edited two lot rows in SQL to repair state. The engine detected it within one
command:

```
ERROR: PROJECTION MISMATCH — auction halted
  divergences: ["lot …EDV: rows=unsold events=queued", "lot …5P9: rows=unsold events=queued"]
```

It refused every further command rather than serve a state it could not prove from the
log. This is exactly right and is a genuine strength. **But the auctioneer was told
"That didn't go through. Try again."** — see D-006 (fixed).

---

## 10 · 80-player registration scenario

Covered in §5. Split: **8 self-registered through the real mobile UI**, **72 via CSV
import**, both through the browser. Total 80, all approved, auction pool 80.

I did not drive 80 individual OTP logins; the product's own bulk path is the realistic
route for a WhatsApp-organized club and testing it was more valuable.

---

## 11 · Concurrent bidding — the headline result

**PASS, unreservedly.** This was the highest-priority test and the product's best answer.

Six devices, one lot, `Promise.all` over six `click()` calls landing within **15–33 ms** of
each other. Four consecutive rounds.

```
BURST 1  eligible=6  clicked=6  → all six devices: ₹25,000 · Leading Cup Alpha (P01) · v73
BURST 2  eligible=5  clicked=6  → all six devices: ₹35,000 · Leading Cup Alpha (P01) · v79
BURST 3  eligible=5  clicked=6  → all six devices: ₹45,000 · Leading Cup Alpha (P01) · v85
BURST 4  eligible=5  clicked=6  → all six devices: ₹55,000 · Leading Cup Alpha (P01) · v91

distinct states across six devices: 1  → CONVERGED  (every round)
```

24 near-simultaneous clicks produced **7 accepted bids** in a strictly increasing,
correctly-laddered sequence (₹25k → ₹30k → ₹35k → ₹40k → ₹45k → ₹50k → ₹55k). The other 17
were refused — self-outbidding, or racing an amount that had already moved.

| Requirement | Result |
|---|---|
| Only valid bids accepted | ✅ |
| Bid ordering correct | ✅ single-writer `seq` is the proof |
| No duplicate bids | ✅ |
| No race condition | ✅ |
| No negative budget | ✅ |
| No incorrect winner | ✅ |
| No stale UI | ✅ all six on identical snapshot version |
| No double allocation | ✅ |
| All browsers converge | ✅ **every round, within ~2s** |

**Bid propagation to a *different* device** (n=229): p50 **78 ms**, p90 886 ms,
p95 892 ms, max 942 ms. Sub-second to another phone in the room, at the median well under
a tenth of a second.

---

## 12 · Mobile UX results

**PASS.** 375 / 390 / 412px, real mobile emulation with touch.

- **Zero horizontal overflow on every screen at every width** (152 combinations).
- **The live auction room — the screen that matters — scored perfectly**: zero overflow,
  zero sub-24px targets, zero console errors, at all eight widths.
- The room is laid out for the fold: the player, the price, the clock and the raise button
  are all above it on a 390×844 screen. Comments in the code show this was measured and
  deliberately fixed.
- Registration, login, owner-join and the public player page are all clean on a phone.

Found (§17): breadcrumb links in the console shell are 15–16px tall (below WCAG 2.2
SC 2.5.8's 24px floor) on every console page, and `/account` has three 20×20 checkboxes.
Neither is on the auction path.

---

## 13 · Tablet and desktop results

**PASS.** 768 / 820 / 1024 / 1280 / 1440px. No overflow, no layout breakage, no console
errors on any screen. The cockpit and the projector board were checked at 1920×1080.

---

## 14 · Security and authorization

**PASS.** This is the second-strongest area after the engine.

| Probe | Result |
|---|---|
| Captain → cockpit / ledger / replay / engine / money | **404** |
| Captain → `/org/…`, `/admin`, `/admin/users` | **404** |
| Captain → rival team detail | 200, *"The squad is not yours to see"* — no data |
| Captain → registrations | 200, *"You don't have permission"* — no phones |
| Unauthenticated → live / cockpit / registrations / money | redirect to `/login` |
| Unauthenticated → `/dev/inbox` | **404 in a production build** — OTP codes cannot leak |
| Signed-in stranger → season / live / teams / registrations | **404** |
| Rival purse in the RSC payload | absent — `"purse sealed"` |
| Org-staff creating a tournament | server refuses: *"You can't create tournaments in this organization"* |

Independently re-verified with the repo's own gates:

- `rls:verify` → **PASSED** — policies load-bearing under the non-BYPASSRLS app role,
  cross-tenant rows invisible.
- `grants:verify` → **218 expectations across 49 tables and 4 roles** verified.
- Webhooks (Razorpay, SMS-inbound, delivery-status): HMAC over raw bytes, `timingSafeEqual`,
  **fail-closed 404 when the secret is unset**.
- Open-redirect guard: allowlist, backslash and dot-segment bypasses both closed, tested.
- JSON-LD: `<`, `>`, `&`, U+2028/9 escaped, with breakout tests.
- OTP: 5/hour per phone **and 20/hour per IP**.

One real gap was found — **the web tier had no production environment checks at all**
(D-007, fixed). See §17.

---

## 15 · Performance observations

Measured, not estimated. Production build, local machine, single Postgres.

| Measure | Value |
|---|---|
| Bid → visible on another device | **p50 78 ms**, p90 886 ms, p95 892 ms, max 942 ms (n=229) |
| Full 78-lot auction, 7 live sessions | **267 s** wall clock |
| Per-lot cycle (open → bids → gavel) | p50 2.6 s |
| CSV import, 73 rows | < 2 s |
| Bulk approve, 55 registrations | 13 s |
| Photo import, 14 files | ~12 s |
| Server start (production) | 198 ms |
| Page loads across 152 screen×width combinations | no timeouts, no 5xx |
| JavaScript / React / hydration errors | **0** across the sweep (one non-reproducible instance, §17 D-012) |
| 4xx during the sweep | 8, all the same correct 404 |

**Not measured:** behaviour on real 3G/4G, on a low-end Android, with 200 spectators on
the WebSocket, or against a managed Postgres with network latency. The engine ships
per-room and per-IP socket ceilings and a token-bucket command limiter, but none of them
have met real load.

---

## 16 · Data consistency

I picked one sold player and chased the fact across every surface:

> **Shubham Pawar (R3DT3P2) → Sunrise Rangers for ₹60,000**

| Surface | Player | Team | Price |
|---|---|---|---|
| Cockpit | ✅ | ✅ | ✅ |
| Auction ledger | ✅ | ✅ | base price (by design) |
| Team detail (organizer) | ✅ | ✅ | ✅ |
| Registrations table | ✅ | ✅ | n/a |
| Winning captain's live room | ✅ | ✅ | ✅ |
| Public season page `/c/…` | ✅ | ✅ | not published (by design) |
| Public player page | ✅ | "SOLD TO SUNRISE RANGERS" | not published |
| Spectate | ✅ | ✅ | ✅ |
| Venue board | ✅ | ✅ | ✅ |
| Broadcast overlay | ✅ | ✅ | ✅ |
| Settlement dues | ✅ | ✅ | ✅ (rolled into ₹5,05,000) |

**One mismatch found** — the venue board reported `TOTAL SPEND ₹0` next to a correct
`PLAYERS SOLD 78` and a correct `MOST EXPENSIVE ₹60,000` (D-004, fixed).

**Settlement reconciliation was exact:**

```
settlement dues                auction ledger (SQL)
Titans     ₹4,65,000     ==    ₹4,65,000
Warriors   ₹4,70,000     ==    ₹4,70,000   ← after an undo and a re-sale
Strikers   ₹4,60,000     ==    ₹4,60,000
Chargers   ₹4,55,000     ==    ₹4,55,000
Royals     ₹4,85,000     ==    ₹4,85,000
Rangers    ₹5,05,000     ==    ₹5,05,000
Total     ₹28,40,000     ==   ₹28,40,000
```

---

## 17 · Defect log

### D-001 · Settlement CTA leads to a 404 — **P1 · FIXED**

| | |
|---|---|
| Area / role | Season overview / organizer (`org:owner`, `competition.manage`) |
| Steps | Complete an auction → open the season overview → click the ladder's primary action, **"Open settlement"** |
| Expected | The settlement desk, or an explanation |
| Actual | `/seasons/{slug}/money` → **"LOST BALL · This page doesn't exist"** |
| Repro | 100% |
| Cause | The ladder gated the CTA on `canSeeMoney` (`competition.manage \|\| settlement.view`); the destination requires `settlement.view` alone. The capability partition is deliberate; the affordance did not honour it. |
| Fix | `nextDestination` now takes `canSettle`. Where the door is locked the ladder names who holds the key: *"Settling it needs money authority for {club} — a separate grant from running the season. Ask an owner to give you one under Money & roles."* |
| Blocking | Yes — this is the last screen of auction night |

### D-002 · A player can never upload their own photo — **P1 · FIXED**

| | |
|---|---|
| Area / role | Registration / self-registering player, mobile |
| Steps | Register from a shared link → review step → "Upload image" |
| Expected | Photo attached |
| Actual | `PUT /api/media/upload` → **403**, *"Upload failed. Please try again."* — permanently |
| Repro | 100% under `MEDIA_STORAGE=local` (the default, and what `.env.example` ships) |
| Cause | The two ends of one certified path asked different questions. `requestOwnPhotoUpload` correctly resolves the season **publicly** and mints a key whose subject is the caller; the local upload route demanded **org membership**, which a player will never have. The e2e suite covers the *organizer's* photo import — whose actor is a member — so nothing went red. |
| Fix | The route now accepts a key that names the caller (`org/{org}/player/{personId}/…`), which is exactly the binding `attachOwnPhoto` re-checks. Verified: 403 → 200, `people.photo_url` written. |
| Blocking | Yes for any self-hosted or demo deployment; masked in production by S3 presigning — which means **this path has never been exercised end to end against real storage** |

### D-003 · An accepted team owner renders as "No owner yet" — **P2 · FIXED**

| | |
|---|---|
| Area / role | Teams tab / organizer |
| Steps | Invite six owners → all six accept → open the Teams tab before they clear the name gate |
| Expected | Six owners |
| Actual | All six cards read **"No owner yet"** while the cockpit correctly showed "ACCEPTED" with the phone |
| Repro | 100% |
| Cause | `team-workspace.ts` dropped any owner row with a null name. The name gate fires **after** acceptance (the accept redirects into `/onboarding`), so the nameless window is real — and permanent for anyone who closes the tab there. |
| Fix | Falls back to the formatted phone, as the cockpit already did. Verified: *"Owner · +91 88040 00001"*. |
| Blocking | No — but it will make an organizer re-issue owner links on auction night |

### D-004 · The venue board prints a confident ₹0 — **P2 · FIXED**

| | |
|---|---|
| Area / role | `/seasons/{slug}/auction/board` / anonymous, projector |
| Steps | Project the board for a published season after an auction |
| Expected | The spend, or an honest "sealed" |
| Actual | **`TOTAL SPEND ₹0`** and `SPENT ₹0` per team, beside a correct `PLAYERS SOLD 78` and `MOST EXPENSIVE ₹60,000`. Truth: ₹28,40,000. |
| Repro | 100% |
| Cause | `purseRemaining` models redaction as `null` and renders "sealed"; `committed` started at `0` and stayed there, so the sum of an entirely-redacted board was a confident zero. The code comment beside it already said *"A total over a redacted board would be a wrong number presented confidently"* — the intent was right and `committed` was never made nullable. |
| Fix | `committed` is now `number \| null`; the board renders "sealed". A team with no paddle keeps a knowable `0`. Four regression tests added. |
| Blocking | No — but it is wrong on the largest screen in the room |

### D-005 · Create affordances disagree across three surfaces — **P3 · reported**

`/home` offers **"+ New tournament"** to an `org:staff` organizer; submitting it returns
*"You can't create tournaments in this organization."* `/tournaments` correctly hides every
create control for the same person (it gates on `creatableOrgs`). `/seasons` — the page
whose entire subject is seasons — has **no create control at all, for anyone**; the only
door to "+ New season" is `/tournaments` after switching its view mode.

Authorization holds (the server refuses). This is a false-affordance and a discoverability
gap. Fix: gate `/home`'s ladder on `creatableOrgs` like `/tournaments` does, and put a
create control on `/seasons`.

### D-006 · A halted engine tells the auctioneer "Try again" — **P2 · FIXED**

| | |
|---|---|
| Area / role | Cockpit / conductor |
| Steps | Cause a projection mismatch → issue any command |
| Expected | The auctioneer learns the engine has stopped and needs Recover |
| Actual | *"That didn't go through. Try again."* — advice that is not merely generic but exactly wrong; every retry is refused identically |
| Cause | The engine's ack reason `engine_halted` had no entry in `COMMAND_REFUSAL_COPY`, so it fell through to the default sentence. The same file already complains about this exact failure mode for `engine_unreachable`. |
| Fix | *"The auction service has stopped itself because its record and its live state disagreed. Nothing more will be accepted until an organizer runs Recover engine from the cockpit."* |
| Blocking | No, but it is the one message that decides whether auction night recovers in 30 seconds or 30 minutes |

### D-007 · The web tier has no production environment checks — **P1 · FIXED**

| | |
|---|---|
| Area | `apps/web/src/env.ts` |
| Expected | Refuse to boot on dev-only defaults, as `apps/engine/src/env.ts` already does |
| Actual | One cross-field check and **no production refinement of any kind**. A production web tier would start, report healthy on `/healthz` and `/readyz`, serve traffic, and be silently broken five ways: |

- `OTP_PROVIDER=dev` → codes written to a table, no SMS sent, `/dev/inbox` 404s in a
  production build → **nobody can log in, including the founder**
- `MEDIA_STORAGE=local` → uploads written to the app host's `public/`, which a built
  server does not serve and a redeploy discards → **every player photo lost**
- `ENGINE_SECRET` default → the published constant authenticating every conduct command
- `PUBLIC_BASE_URL=http://localhost:3000` → every canonical URL, OG card, sitemap entry
  and shared registration link points at localhost
- `RP_ID=localhost` → passkeys silently fail

`pnpm preflight:production` checks most of this, but it is a separate script a human has to
remember; the boot check cannot be skipped.

**Fix:** seven refinements gated on `NEXT_PHASE !== "phase-production-build"` (so
`next build`, which runs with `NODE_ENV=production` and none of the deployment's variables,
is unaffected). Each names the variable and the fix. One explicit escape,
`ALLOW_INSECURE_LOCAL_PRODUCTION`, exists so `PRODUCTION_CHECKLIST` §8's local rehearsal
stays runnable — it prints a three-line warning to stderr at boot and
`preflight:production` **fails** if it is set. 13 regression tests; checklist updated.

### D-008 · The raise button ignores the bidder's purse — **P2 · FIXED**

| | |
|---|---|
| Area / role | Live room / bidder, mobile |
| Steps | Cup Alpha holds **₹45,000**. Open a lot with base ₹50,000. |
| Expected | The control reflects what the engine will accept |
| Actual | **"RAISE TO ₹50,000"** — gold, enabled — and three jump rungs at ₹55,000 / ₹60,000 / ₹65,000. Rounds later it offered ₹95,000. Every press returned *"That would take you past your remaining purse."* |
| Repro | 100% |
| Cause | The control's own comment (DA-12) says the raise buttons must not *"invite the rejection instead of preventing it"*, and lists paused, already-leading and squad-full. **Money — the refusal that actually happens late in a real auction — was the one it could predict best and did not.** |
| Fix | New pure `maxAffordableBid()` in `packages/core` mirrors gauntlet checks 8 and 9 read backwards, so client and engine cannot drift. The raise disables with *"Beyond your purse. The most you can bid is ₹10,000."*; each jump rung answers for itself. 4 core tests, one of which asserts the ceiling passes the real gauntlet and one rung more does not. |
| Blocking | No — the engine always refused correctly — but it is the defect most likely to be *felt* by a captain |

### D-009 · A completed auction accepts lot commands — **P1 · FIXED**

| | |
|---|---|
| Area / role | Cockpit "Needs resolution" / conductor |
| Steps | Complete an auction that has unsold lots → click **Requeue** |
| Expected | Refused — the panel above says *"This auction is completed. Nothing here can be opened, undone or recovered."* |
| Actual | Accepted. Both unsold lots moved back to `queued` on a `completed` auction — leaving it carrying **unresolved lots**, which is exactly the state `complete` refuses to be entered with. The card then read *"Auction complete. 79 of 80 lots resolved"* above *"78/80 LOTS RESOLVED"* — two numbers for one night. There is no in-product way back. |
| Repro | 100% |
| Cause | `transitionLot` asked about the auction's status **only for `open`**. `issuePaddle`, `grantPaddle`, `inviteOwner` and `acceptOwnerInvite` all refuse a terminal auction; the lots had no such fence. |
| Fix | All lot commands refuse `completed` / `reconciled` / `abandoned` with `terminal_auction` (which already had copy: *"The auction has finished."*). Placed **after** the lot lookup so a foreign lot id stays `not_found`. Regression test covers all six commands plus the isolation property. Verified in the browser: Requeue on a completed auction now says *"The auction has finished."* and the record is unchanged. |
| Blocking | **Yes.** It silently changes who owns whom after everyone has gone home. |

### D-010 · Diagnostics claim "Live" while the device is offline — **P3 · FIXED**

Fifteen seconds offline: the ribbon correctly read **OFFLINE**, the timer correctly froze,
the raise button correctly disabled — and the "Feed diagnostics" strip still read
*"Live · clock ±20ms"*. A WebSocket `readyState` of `open` survives the network dying.
It is the line somebody opens when bidding stops working, and it was the one thing on the
page still claiming everything was fine. Now reads *"Offline — this device has no
network"*, from the same `stale`/`offline` signals the ribbon uses.

### D-011 · Sub-24px targets in the console shell — **P3 · reported**

The breadcrumb links (`"Zeta Synthetic Club 26"` 64×15, `"Sunrise Premier League 2026"`
90×15) fall below WCAG 2.2 SC 2.5.8's 24×24 floor and appear on **every** console page.
`/account` has three 20×20 checkboxes. Everything else flagged by the sweep is a link
inline in a sentence, which SC 2.5.8 exempts. **The live room, cockpit and spectate have
none.** Fix: give breadcrumb links vertical padding; give the checkboxes a 24px target.

### D-012 · One non-reproducible hydration mismatch — **P4 · reported**

React error #418 (hydration) fired once on an organizer page during the final smoke.
I could not reproduce it across 3 passes over 21 screens. Recorded because it is real and
unexplained, not because it is understood. Likely a time-dependent render
(relative timestamps).

### D-013 · `pnpm setup:local` has been broken since 24 July — **P1 · FIXED**

The documented one-command bootstrap failed at step 6/7:

```
Error: complete: squad_below_minimum
```

Commit `4f1eb3b` added the short-squad guard on `complete` and updated eleven regression
fixtures to pass the override — and missed `apps/web/scripts/seed-demo.ts`. The demo's
"settled exemplar" is deliberately tiny (3 lots, 2 teams), so every team finishes below
`squadMin`. **A new engineer or a founder demo could not get the product running at all.**
Fixed by passing the documented override with a reason. Nothing in CI runs `seed:demo`.

### D-014 · Bulk import is all-or-nothing — **P3 · reported**

One invalid row blocks the entire file. For an 80-row Google Sheet export from real
humans, this will be the normal case. See §6.

---

## 18 · Priority summary

### P0 — none found
No defect prevented the auction from running or corrupted money or authorization.

### P1 — must fix before launch (all four now fixed)
- **D-009** completed auction accepts lot commands — corrupts the final record
- **D-007** web tier has no production env checks — five silent production failures
- **D-002** players can never upload a photo (local storage; never exercised against S3)
- **D-001** end-of-auction settlement CTA leads to a 404
- **D-013** `pnpm setup:local` broken for a month

### P2 — should fix before launch (all three now fixed)
- **D-008** raise button ignores the purse
- **D-004** venue board prints ₹0 for ₹28,40,000
- **D-003** accepted owners read "No owner yet"
- **D-006** a halted engine says "Try again"

### P3 / P4 — polish (reported, not fixed)
- **D-005** create affordances disagree across `/home`, `/seasons`, `/tournaments`
- **D-011** sub-24px breadcrumb targets (SC 2.5.8)
- **D-014** all-or-nothing CSV import
- **D-012** one unexplained hydration warning
- The Teams tab shows 5 of 6 teams on the overview card with no "+1 more"
- *"Setup begun. Add your teams next."* fires even when teams already exist
- Teams tab says an owner link *"cannot be withdrawn once sent"*; the cockpit says a
  pending link *"can be withdrawn below"*. Both cannot be true.
- The claim-paddle selector requires choosing from a list of exactly one option
- Settlement shows `₹0 Total dues` before computation, where "—" would be honest
  (the same confident-zero pattern as D-004)
- Registration preview renders raw ISO dates (`2026-09-01 to 2026-11-30`) where every
  other surface renders `1 Sept 2026 – 30 Nov 2026`
- Team roster shows raw E.164 phones (`+918802010000`) instead of the grouped format

---

## 19 · Top 10 risks for auction day

1. **SMS has never been sent by this product.** `OTP_PROVIDER=dev` is the default and the
   only provider ever exercised. If MSG91 credentials or the DLT template are wrong on the
   night, **nobody can log in** — not the captains, not the organizer. *Mitigation: send
   one real code to one real phone, in the deployed environment, a week before.*
2. **Photo storage has never been exercised against a real bucket.** The self-upload path
   was 403-ing until today; the S3 presign path has no end-to-end test. *Mitigation: one
   real upload from a real phone against the real bucket.*
3. **No load has ever touched this system.** 7 sessions, one Postgres, one machine. A real
   night is 6 bidders plus a hall of spectators on the WebSocket, on hotel Wi-Fi.
   *Mitigation: run the staging perf pass that PRODUCTION_CHECKLIST §6 already requires.*
4. **The venue's internet.** The product degrades honestly (ribbon flips to OFFLINE, timer
   freezes, bids disable, state resyncs on reconnect — all verified), but the auction stops
   while the engine is unreachable. *Mitigation: a phone hotspot as failover, and know that
   manual conduct mode exists.*
5. **Nobody may hold settlement authority.** It is a separate grant that `org:owner` does
   **not** confer. Discover this at 11pm and the money desk is closed. *Mitigation: grant
   it during setup, from Money & roles.*
6. **A captain arrives without having claimed a paddle.** Four explicit steps stand between
   an invite and a bid. *Mitigation: verify all six paddles are claimed before the first
   lot — the cockpit shows this.*
7. **The projector board shows no money for a published season.** The seal is audience-based
   and an anonymous viewer gets nothing, so a public season's board now correctly reads
   "sealed" everywhere. If the room expects to see spend on the wall, that is a product
   decision to make **before** the night, not during it.
8. **Squad-minimum equals squad-maximum leaves no slack.** 13–13 with 80 players and 78
   places worked here because bidding was controlled. A real room that overpays early can
   strand a team. *Mitigation: set `squadMin` below `squadMax`, and know the conductor can
   close short on the record.*
9. **Owner invite links cannot be withdrawn once sent** and anyone holding one can accept.
   A link forwarded into the wrong WhatsApp group hands away a ₹20L purse. *Mitigation:
   send one-to-one; the product says so on the screen.*
10. **There is no in-product repair for a corrupted terminal auction.** D-009 is now
    unreachable, but if the engine ever halts on a completed auction the Recover control is
    not rendered. *Mitigation: know that the ledger is the record and support has SQL.*

---

## 20 · Recommended registration architecture

See §6. In short:

```
PLAYER
  └─ Google Form (mobile, no account, photo to Drive)
       └─ Google Sheet + Drive folder
            └─ organizer downloads CSV + images          ← the only manual step
                 └─ DesiAuction Import: CSV tab → parse → per-row errors → preview
                      └─ commit (one transaction, person stubs by phone, status=submitted)
                           └─ Import: Photos tab → match by number/phone/name → review → upload
                                └─ organizer triage → approve
                                     └─ PLAYER MASTER → AUCTION POOL
```

The principle the brief asks for — *external registration must never directly mutate the
production player record* — is already how this product works. Imported rows land in
`submitted` and pass the same human approval gate as a self-registration. Do not weaken
that to save a click.

---

## 21 · Recommended integrations

| Integration | Recommendation |
|---|---|
| Google Forms → Sheets → CSV | **Adopt now.** Zero cost, zero new surface, works today. |
| Google Drive photo folder | **Adopt now** via the existing filename matcher; add a URL column later. |
| Google Apps Script auto-sync | **Defer.** OAuth surface + a token to rotate + silent failure, to save two clicks. |
| Tally / Typeform | **No.** Better forms, no bulk photo story, paid at tournament volume. |
| Native DesiAuction registration | **Keep and prefer.** Better than the Form in every respect except signed-out photo upload. |
| Hybrid (Form for stragglers, native for the rest) | **This is the real answer.** Publish the native link; use the Form only for players who will not click a link. |
| WhatsApp Business API | Out of scope here; already tracked as a founder-held external. |

---

## 22 · Fixes implemented

All in this working tree, all verified in a real browser after the fix.

| # | File(s) | Change |
|---|---|---|
| D-013 | `apps/web/scripts/seed-demo.ts` | Pass the documented short-squad override so `setup:local` completes |
| D-002 | `apps/web/src/app/api/media/upload/route.ts` | Accept a key that names the caller as its own subject |
| D-003 | `apps/web/src/server/competition/team-workspace.ts` | Fall back to the phone for a nameless accepted owner |
| D-004 | `apps/web/src/app/seasons/[slug]/auction/purse-board.tsx`, `…/board/board-panel.tsx` | `committed` becomes nullable; the board says "sealed", never ₹0 |
| D-009 | `packages/auction/src/aggregate.ts` | Every lot command refuses a terminal auction |
| D-006 | `packages/core/src/auction-copy.ts` | A real sentence for `engine_halted` |
| D-008 | `packages/core/src/auction.ts`, `…/index.ts`, `apps/web/src/server/auction/live-summary.ts`, `…/actions.ts`, `…/auction/paddle-control.tsx` | `maxAffordableBid()`; the raise and each jump rung gate on the purse |
| D-010 | `apps/web/src/app/seasons/[slug]/auction/live-experience.tsx`, `…/live/live-panel.tsx` | Diagnostics tell the truth when offline or stale |
| D-001 | `apps/web/src/server/competition/actions.ts`, `apps/web/src/app/seasons/[slug]/overview-panel.tsx` | The ladder gates on `settlement.view` and explains the lock |
| D-007 | `apps/web/src/env.ts`, `scripts/preflight-production.mjs`, `docs/operations/PRODUCTION_CHECKLIST.md` | Seven production boot checks + one audited escape |

**Tests added (21):**
`packages/core/src/auction.test.ts` (+4, `maxAffordableBid` incl. agreement with the
gauntlet) · `apps/web/src/env.regression.test.ts` (+13, new file) ·
`apps/web/src/components/auction/purse-fold.regression.test.ts` (+4, new file) ·
`apps/web/src/server/auction/auction-foundation.regression.test.ts` (+1, terminal state).

**Also fixed:** `apps/web/package.json`'s `test:integration` ran
`vitest run src/server src/components src/content` — a test file anywhere else in `src`
**never ran**. Broadened to `vitest run src`.

---

## 23 · Regression results

```
pnpm verify   (lint + typecheck + test + format:check + depcruise)   11/11 tasks ✅
  depcruise      ✔ no dependency violations (1331 modules, 5376 dependencies)
  format:check   ✔ all matched files
package tests                                                        541 passed ✅
  core 246 · ui 107 · settlement 89 · financial-operations 84 · engine 13 · contracts 2
apps/web integration                          43 files, 627 tests passed ✅
rls:verify        PASSED — policies load-bearing under the app role  ✅
grants:verify     218 expectations, 49 tables, 4 roles               ✅
production build  succeeded                                          ✅
final browser smoke   16 surfaces, organizer + anonymous + bidder — 0 broken ✅
```

**Not run:** the Playwright e2e suite. It targets `:3050` with its own dev server, and
running a second `next dev` against the same `.next` corrupts the build cache (a known
trap in this repo). The rehearsal exercised the same journeys against a production build
instead. **This is a gap in this report** — the e2e suite should be run in CI on an
ephemeral database before release.

---

## 24 · Coverage summary

```
Registration              PASS      80 registered; validation, duplicates, drafts, photos
Admin onboarding          PASS      season → teams → registration → auction → settle
Captain onboarding        PASS      6 cold journeys, invite → accept → grant → claim
Player onboarding         PASS      8 self-registrations on 3 phone widths
6-captain simulation      PASS      6 independent contexts, no leakage, no contamination
78-player simulation      PASS      78 sold, 13×6, 2 unsold — verified in SQL
80-player registration    PASS      8 via UI + 72 via CSV import
Auction lifecycle         PASS      create → open → conduct → undo → requeue → complete
Concurrent bidding        PASS      24 clicks in <35ms → 7 correct bids, always converged
Team limits               PASS      squad-full disables the control; engine refuses
Budget rules              PASS      engine exact; client gate was missing (D-008, fixed)
Unsold players            PASS      timer expiry and no-bid gavel both → unsold
Mobile                    PASS      375/390/412 — zero overflow, live room flawless
Tablet                    PASS      768/820/1024 — zero overflow
Desktop                   PASS      1280/1440/1920 — zero overflow
Refresh / reconnect       PASS      refresh, back, duplicate tab, offline→online, pause/resume
Authorization             PASS      captain, stranger, anonymous — all correctly refused
Data consistency          PASS      11 surfaces agree; settlement exact to the rupee
Performance               PARTIAL   p50 78ms bid propagation; NO load or network testing
Settlement                PASS      open → verify → compute → record payment; dues exact
Google Forms integration  ASSESSED  recommendation in §6; no code written
E2E suite                 NOT RUN   see §23
Real SMS delivery         NOT TESTED   no provider configured — founder-held
Real object storage       NOT TESTED   no bucket configured — founder-held
Load / stress             NOT TESTED   7 sessions is not a hall
Slow-network (3G)         NOT TESTED   offline/online was tested; throttled was not
```

---

## Verdict

# GO WITH CONDITIONS

**The engine is ready.** Concurrency, ordering, money arithmetic, the append-only ledger,
undo-and-reconcile, tenant isolation and the capability partition all held under
deliberate pressure. I tried to break the auction and the auction won.

**The product around it needed work, and it got it.** Nine defects fixed, twenty-one
regression tests added, every gate green. The pattern in those defects is worth stating
plainly to whoever owns this next: *the server was right and the interface was wrong, in
the same way, nine times.* The code is full of comments that state a rule correctly —
"don't invite a refusal you can predict", "a total over a redacted board would be a wrong
number presented confidently" — where the implementation covered three cases out of five.
**A rule stated in a comment and enforced in three of five places is a rule with a test
missing, not a rule.**

### Conditions, in order

1. **Send one real OTP.** In the deployed environment, to a real phone, with the real DLT
   template. Until then the front door has never opened.
2. **Store one real photo.** `MEDIA_STORAGE=bucket` against the real S3/R2, from a real
   phone. The self-upload path was broken until today and has never met real storage.
3. **Run `pnpm preflight:production` against the real environment and get a PASS.**
   It now also refuses the rehearsal escape.
4. **Run the e2e suite in CI on an ephemeral database.** Not run here (§23).
5. **Run one load pass** — 6 bidders plus 50 spectator sockets — before a paying customer's
   night.

Conditions 1, 2 and 5 are founder-held externals, not engineering. Nothing in this report
suggests the code is not ready; it suggests the **deployment** has never been proven.

Run condition 1 and 2 tomorrow morning. If both pass, I would run the auction.

---

# Addendum RH-1b · Mobile design pass (2026-08-23)

The §12 result — *"zero horizontal overflow on every screen at every width"* —
was true and was not the question. Overflow is a floor: it proves nothing spills
off the screen. It says nothing about whether two buttons beside each other look
like they were placed on purpose. Looked at rather than measured, several console
screens did not.

## What was actually wrong

Every action group in the product is `display: flex; flex-wrap: wrap; gap`, and
lets each control size itself to its own label. On a 1440px desktop that is
invisible. On a 390px phone it is the first thing you see. Measured:

| Group | Before |
|---|---|
| `.season-hero-actions` | `Season details` **133×40**, borderless · `Fixtures` **89×58**, bordered — two species, two heights, one row |
| `.season-stepper-actions` | 121 / 112 / 145px, wrapping 2 + 1 with a hole beside the orphan |
| `.reg-toolbar` | `Export CSV` 97×**32** · `Import (CSV / photos)` 160×**32** |
| `.reg-table .reg-actions` | `Icon` 52×32 at x=183, then `Captain` 74×32 and `Details` 70×32 dropped to x=74/160 — a 1 + 2 stagger, ×25 rows |
| `.live-exits` | 3-up at 81 / 80 / 79, then 2-up at 94 / 74 |
| `.public-cta-row` (public season page) | `See the squads` 186px filled, `All tournaments` a bare ghost link below it |
| `.showcase-filters` | 70 / 101 / 81 / 101, wrapping 3 + 1 and orphaning "Retained" |
| `.public-share-row` (a player's own card) | `Copy` 58×**32** · `Share` 62×**32** |

Two root causes, both specific:

1. **A max-width capping a flex-basis.** `.reg-table .reg-actions::before` sets
   `flex-basis: 100%` so the "ACTIONS" label takes its own line and the buttons
   start clean beneath it. It never did: `.reg-table td::before` sets
   `max-width: 40%` for the ordinary label/value cells, and a max-width caps a
   flex-basis. The label rendered **96.8px** wide and the first button tucked in
   beside it. This is the 1 + 2 stagger.
2. **No rule at all for what an action group should look like on a phone.**
   Each site was left to `flex-wrap`, which is a fallback, not a decision.

## The decision, stated once

> **Below 640px an action group is a grid of equal cells, not a row of
> content-sized chips.** A pair splits the row 50/50. A lone control takes the
> row whole. An odd one out spans rather than sitting beside a hole. Every child
> gets the same 44px box, the same centring and the same horizontal padding — so
> a plain link and a filled button stop looking like a mistake next to each other.

`--action-min` is the single knob deciding how many fit per row: 150px for the
auction exits (2-up), 140px for the season groups, three shrinkable columns for
the table's one-word actions.

## After

| Group | After |
|---|---|
| `.season-hero-actions` | `Season details` **151×44** · `Fixtures` **151×44** — a matched pair |
| `.reg-toolbar` | `Export CSV` **151×46** · `Import (CSV / photos)` **151×46** |
| `.reg-table .reg-actions` | `Icon` · `Captain` · `Details` — **75×44 each, one row**, each with a visible edge |
| `.live-exits` | `Ledger`\|`Replay`, `Engine`\|`Spectate`, `Setup` full-width — **109×44 / 2-up / 2-up / 1** |
| `.public-cta-row` | `See the squads` full-width **52px**, `All tournaments` full-width beneath |
| `.showcase-filters` | **108×44 ×3**, equal cells |
| `.public-share-row` | `Copy` **149×44** · `Share` **149×44** |

Also fixed along the way: the registrations table's ghost action buttons are
`variant="ghost"` — transparent border and background, which is right on a
desktop where hover reveals them and wrong on a phone, where there is no hover
and three tappable controls read as bare gold words in a grey block. They get a
border and a surface below 640px. **The edge is the affordance.**

## Two things I got wrong, and corrected

- I first reported the season overview's **"₹28.40 L"** as broken letter-spacing.
  It is not: `letter-spacing: normal`, and the visible gaps are Geist Mono
  rendering a `.` and a space. **Withdrawn — not a defect.**
- I then reported the season tab strip as cutting off "Table" and "Auction" with
  no scroller. It has `overflow-x: auto` and scrolls correctly. The
  `scrollWidth: 496` I measured came from **my own regression**: the shared rule
  used `> *`, which set `display: inline-flex` on the *closed* `<dialog>` that
  the FormDialog leaves in the DOM, un-hiding it and pushing its footer to
  x=496. Scoped to `> :is(a, button, [role="button"])`. **Withdrawn — mine, not
  the product's.**

That regression is worth naming: my first pass **introduced** a horizontal
overflow on `/registrations` at 375/390/412px, and a second cause — a hard
`minmax(72px, 1fr)` column floor that could not shrink — made it worse. Both
were caught by re-running the same 152-combination sweep, which is why the sweep
exists.

## Verification

```
152 screen×width combinations, 8 widths (375 → 1920)
  horizontal overflow   0   (regressed to 3, fixed, re-verified)
  JavaScript errors     0   (the 4 "console errors" are aborted RSC prefetches)
  4xx / 5xx             0
pnpm verify (lint + typecheck + test + format + depcruise)   11/11 ✅
package tests 541 ✅ · web integration 43 files / 627 tests ✅
```

New guard: `e2e/responsive.spec.ts` — *"action groups are equal-width,
thumb-sized rows on a phone"*. It asserts the property (controls sharing a row
share a width; every control ≥44px) rather than pixels, and fails if it finds
nothing to assert on. **I could not execute it** (§23: the e2e suite needs its
own server on `:3050`), so its logic was replicated against the running app and
confirmed passing — 1 group, three equal 111px controls.

## What I deliberately did not change

The registrations row is still a tall label/value card — roughly 360px per
player, so 80 players is a long scroll. Compressing it into a real mobile row
(photo + name + status on one line, actions revealed on tap) is a redesign of
the screen, not a spacing fix, and it deserves a designer's decision about what
an organizer needs to see at a glance. Logged, not attempted.

## Files changed

`apps/web/src/app/seasons/seasons.css` · `apps/web/src/app/seasons/[slug]/auction/auction.css`
· `apps/web/src/app/c/directory.css` · `apps/web/e2e/responsive.spec.ts`

All rules are inside `@media (max-width: 640px)`. **Nothing above 640px changed**,
which the 8-width sweep confirms.

---

# Addendum RH-1c · The registration row card (2026-08-23)

RH-1b left this one explicitly untouched, calling it "a redesign of the screen,
not a spacing fix". It is, and here it is.

## The problem, measured

Below 1100px each table row becomes a card and every cell carries its own label
— a correct, honest responsive-table transform, and on a phone a literal one.
Seven label/value lines stacked vertically, `SELECT` and `ACTIONS` among them:

```
SELECT                        ☐
NUMBER                  RV5DBZK
PLAYER    (photo) Aditya Sharma
                +91 88020 10000
ROLE           batter    34 yrs
STATUS                 APPROVED
TEAM            Sunrise Rangers
ACTIONS
        [Icon] [Captain] [Details]
```

**363 px per player.** 2.33 players fit a 390×844 screen. Triaging eighty of them
meant scrolling roughly thirty thousand pixels. The screen an organizer spends
the most time in was the one that made them work hardest.

## The design

The same seven cells, re-ordered into the three bands a person actually reads —
**who**, **enough to decide**, **what to do**:

```
┌──────────────────────────────────────────────┐
│ ☐  (photo)  Aditya Sharma                    │   WHO
│             +91 88020 10000                  │
│ APPROVED   NUMBER RV5DBZK                    │   ENOUGH TO DECIDE
│ ROLE batter 34 yrs                           │
│ TEAM Sunrise Rangers                         │
│ [   Icon   ][  Captain  ][  Details  ]       │   WHAT TO DO
└──────────────────────────────────────────────┘
```

**205 px per player — a 44% reduction.** 4.12 players per screen, and the table
for one page of 25 falls from 9,407px to 5,457px.

A row awaiting triage carries six actions and still behaves: they fall as two
tidy rows of three (`Approve · Waitlist · Decline` / `Icon · Captain · Details`),
75×44 each, in 233px.

## Three decisions worth naming

**A name must not wrap, and that decided the layout.** Flexbox breaks lines on
base sizes before it shrinks anything, so an `auto` basis on the identity cell
measures it at its full natural width and pushes the status badge onto its own
line. A zero basis keeps the badge up on line 1 — and leaves the name ~156px,
which broke "Aditya Sharma" into "Aditya / Sharma" on every row. Between a badge
one line higher and eighty player names each folded in half, the names win: they
are what an organizer is reading. The badge therefore **leads band 2**, hard
left, where the status of eighty players still reads as one column down the page
rather than drifting with each name's length.

**A phone number is one word.** It is dialled, read aloud and searched for as a
single run of digits. An intermediate version squeezed the identity cell hard
enough to break `+91 88020 10000` across three lines; `white-space: nowrap` on
the phone is what makes the rest of the layout safe.

**Which labels earn their place.** `thead` is `display:none` here, so each cell's
`::before` is the only thing naming its column. `NUMBER`, `ROLE` and `TEAM` keep
theirs — a bare "RV5DBZK" or "Sunrise Rangers" is ambiguous out of context. The
other three are dropped deliberately: the checkbox already carries
`aria-label="Select {name}"`, a person's name and phone need no field called
PLAYER, and a badge reading "approved" needs no field called STATUS.

## Also fixed on the same screen

The filter card's four controls were four different widths — `q` 220px,
`status` 135, `team` 174, `sort` 198 — four ragged left-aligned boxes down the
card, with a search field too short to show its own placeholder
("name, phone, number or te…"). Stacked controls should be one width, and that
width is the card's. All four are now 268px and the placeholder reads in full.

## Verification

```
row height          363px → 205px   (-44%)   ·  6-action row 233px
players per screen  2.33  → 4.12
page of 25 rows     9,407px → 5,457px
152 screen×width combinations, 375 → 1920
  horizontal overflow  0 · JavaScript errors 0 · 4xx/5xx 0
desktop at 1280px   display:table-row · thead:table-header-group · 67px rows — UNCHANGED
pnpm verify 11/11 ✅ · package tests 541 ✅ · web integration 43 files / 627 tests ✅
```

Every rule is inside `@media (max-width: 640px)`, and the 1280px probe confirms
the desktop table is still a table with its header row intact.

## What is still true

This is a layout change, not an information-architecture one: the same seven
facts are shown, none hidden behind a tap. If a future pass wants fewer — role
and styles behind "Details", say — that is a product decision about what an
organizer needs at a glance, and it is not made here.

**File changed:** `apps/web/src/app/seasons/seasons.css`.

---

# Addendum RH-1d · Role and styles behind Details (2026-08-23)

Requested after RH-1c: move role and the playing styles off the phone's row card
and into the Details panel.

## What it needed first

The Details panel showed **name, registration number, decline reason, a photo
uploader and the timeline**. It carried no role, no age and no styles. Hiding the
Role cell on its own would therefore have *deleted* those facts on a phone, not
relocated them — so the panel gained them first:

```
ROLE      AGE
Batter    28 Yrs
BATTING   TEAM
Right Hand Opener   Sunrise Royals
```

A two-up of labelled pairs, rendered **at every width**: a desktop reader who
already has the column loses nothing by seeing it confirmed, and a phone reader
is one tap from the whole record rather than from a gap. `Batting`/`Bowling`
appear only when the player gave them.

Only then is the Role cell dropped at ≤640px. `display: none` also removes it
from the accessibility tree, and that is the point rather than an oversight:
`thead` is hidden on a phone too, so a half-present cell would be a labelled
value nobody can reach. One place, one answer, one tap away.

## Result

```
                    RH-1b     RH-1c     RH-1d
row height          363px  →  205px  →  181px      (-50% overall)
players per screen  2.33   →  4.12   →  4.66
page of 25 rows     9,407px → 5,457px → 4,857px
```

The row card is now exactly the triage question — **who · what state · what to
do** — and nothing else:

```
☐  (photo)  Aditya Sharma
            +91 88020 10000
APPROVED   NUMBER RV5DBZK
TEAM Sunrise Rangers
[   Icon   ][  Captain  ][  Details  ]
```

## And a data-loss bug the move exposed — D-015, P2, FIXED

Verifying the new panel, it rendered no styles for 73 of the 80 players. It was
right to: **the import had eaten them.**

| | |
|---|---|
| Area | CSV import (`parseRegistrationCsv` → `commitRegistrationImport`) |
| Steps | Import 73 players whose `batting_style` column says `Right Hand Batsman` — the spelling the product itself shows |
| Expected | 73 styles stored, or 73 errors |
| Actual | Preview: **"73 valid row(s) · 0 errors"**. Stored: **0**. Silent. |
| Evidence | `select count(batting_style) … → 1` of 80 — the single self-registered player who picked from the dropdown |

Two halves of one gap. The parser errors per line on `name`, `phone`, `role` and
`base_price_band` and passed the two style columns through **raw**;
`commitRegistrationImport` then dropped whatever it did not recognise —
`...(isBattingStyle(row.battingStyle ?? "") ? { battingStyle } : {})`. Stored
values are snake_case tokens (`right_hand_opener`); every screen shows the label
("Right Hand Opener"). An organizer typing what they can see lost the column and
was told the file was clean. `Export CSV` does not emit the style columns
either, so there was no round-trip to copy the right spelling from.

**Fix.** `parseBattingStyle` / `parseBowlingStyle` in `packages/core` accept the
canonical token *or* the human label, in any casing and with any mixture of
spaces, hyphens and underscores — `Off-Break`, `off break` and `off_break` are
one answer — and return null for anything they cannot place. The CSV parser now
refuses those on the line that carries them, the same contract the band got in
DA-14, and hands the commit canonical values so it has nothing left to reject.

Verified through the real dialog:

```
Line 4: unknown batting style "Switch Hitter"; unknown bowling style "Doosra"
→ Fix 1 error to import

"Right Hand Opener" → right_hand_opener
"Left Hand Batsman" → left_hand
"Off-Break"         → off_break
```

Five new core tests, including one that proves a bowling style is not mistaken
for a batting one.

## Verification

```
pnpm verify 11/11 ✅ · core 251 tests ✅ · web integration 43 files / 627 tests ✅
152 screen×width combinations: overflow 0 · JS errors 0 · 4xx/5xx 0
desktop 1280px: display:table-row · thead:table-header-group · 67px — UNCHANGED
```

**Files changed:** `apps/web/src/app/seasons/[slug]/registrations/dashboard-panel.tsx`
· `apps/web/src/app/seasons/seasons.css` · `packages/core/src/player-profile.ts`
· `packages/core/src/registration-csv.ts` · `packages/core/src/index.ts`
· `packages/core/src/registration-ops.test.ts`

## Revised on the same day — role stays on the card

The judgement flagged above was checked and reversed: **role and age stay
visible, only the playing styles move.** A balanced pool needs bowlers and a
keeper, so role is a fact an organizer scans DOWN the list while triaging, not
one they open a panel for. Age rides with it at no cost — "batter 34 yrs" is one
line either way.

That required splitting the cell rather than hiding it: role, age and the styles
were three children of one `<td data-label="Role">` sharing a single `.reg-sub`
class, so CSS could not tell the second sub-line from the third. The styles span
now carries its own `.reg-styles`, and only that is hidden below 640px.

One trap on the way: `.reg-table .reg-styles { display: none }` (0,2,0) lost
silently to the band-2 rule above it,
`.reg-table td[data-label="Role"] .reg-sub { display: inline }` (0,3,1). Matched
on the cell as well as the class, it wins.

**Final row card, and the honest arithmetic:**

```
☐  (photo)  Rohan Kulkarni
            +91 88010 00003
APPROVED   NUMBER RDMFA3V
ROLE batter 28 yrs
TEAM Sunrise Royals
[   Icon   ][  Captain  ][  Details  ]

row height          363px → 205px   (-44%)
players per screen  2.33  → 4.12
page of 25 rows     9,407px → 5,457px
```

Keeping role costs the 24px that RH-1d's 181px had bought. It is the right
trade: the 44% that matters came from re-ordering seven stacked lines into three
bands, not from hiding a fact an organizer reads on every row.

Verified at both ends — on a 390px phone the row reads
`… | batter | 28 yrs | APPROVED | …` with `styles line visible: false`; at
1280px it reads `… | batter | 28 yrs | right hand opener | …` with
`styles line visible: true`. Details shows role, age, batting, bowling and team
at every width regardless.
