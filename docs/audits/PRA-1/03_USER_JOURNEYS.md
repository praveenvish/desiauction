# PRA-1 · 03 — User Journeys

> Walked from `https://domain/` as each persona. Status legend:
> ✅ Complete · 🟡 Partial · 🔴 Broken · ⬛ Missing (no surface exists).

## J1 · Visitor → Customer

```
Landing         ⬛  "/" renders an engineering placeholder (page.tsx:5-13)
Features        ⬛  no route
Pricing         ⬛  no route (tiers designed in docs/45-billing-model.md, unbuilt)
Signup          🔴  only /login exists; OTP delivery = DevInboxSender → a real
                    visitor NEVER receives a code (auth/actions.ts:77)
Purchase pass   ⬛  no billing code, no pass tables in schema
```
**Verdict: MISSING.** A stranger cannot discover, evaluate, sign up for, or buy this product.

## J2 · New user → First session

```
/login          🟡  form works; OTP works only where /dev/inbox exists (dev machines)
Verify code     ✅  creates person (phone only) + session (otp.ts:146)
Land on...      🔴  redirect → /account, which has ZERO links out
Set my name     ⬛  no profile edit anywhere; account page literally shows
                    "— (set during registration)" but self-registration never asks
Find features   🔴  no nav shell; /competitions and /orgs must be typed by hand
```
**Verdict: BROKEN.** The signed-in front door is a dead end.

## J3 · Org admin → Organization ready

```
/orgs           ✅  create org
/org/[slug]     ✅  invite member → copyable /join/[token] URL
Send invite     🔴  copy-paste only; platform has no channel to deliver it
/join/[token]   ✅  preview + accept works (invitee must already know to log in)
Venues          ✅  /org/[slug]/venues create venue + grounds
Org settings    ⬛  no rename/logo/delete/billing
```
**Verdict: PARTIAL** — functional core, manual delivery, no administration.

## J4 · Organizer → Competition live

```
/competitions        ✅  create (name, location, org)
Lifecycle            ✅  draft → setup → registration_open → registration_closed
Teams                ✅  add teams
Registration URL     ✅  copyable link on competition panel
Invite players       🔴  no comms channel; WhatsApp-paste is off-platform
Triage/verify        ✅  registrations console (bulk, CSV, timeline)
Fixtures             ✅  generate/schedule/publish + calendar + match-day
Notify participants  ⬛  nothing exists
Standings/results    ⬛  nothing exists
```
**Verdict: PARTIAL** — strong consoles, zero outward reach.

## J5 · Player → Registered, named, informed

```
Receive reg link   🔴  off-platform (organizer WhatsApp)
/login (next=)     🟡  works only where OTP is deliverable
Register           🟡  role dropdown only — name never asked (register-form.tsx)
Await review       🔴  "The organizer will review" — player is never told the outcome
Auction night      🔴  appears as nameless lot unless organizer imported a CSV
Post-auction       ⬛  no "your team" surface
```
**Verdict: BROKEN.**

## J6 · Team owner → Auction night → Settled

```
/owner-join/[token]  ✅  accept → redirected to live room
Claim paddle         ✅  grant + claim flow
Bid                  ✅  increments, custom amounts, countdown, history
SOLD ceremony        ✅  synchronized stage (ceremony-stage.tsx)
Purse tracking       ✅  cockpit purse table
What do I owe?       ⬛  settlement obligations have no screen
Pay                  ⬛  manual adapters only; Razorpay adapter unwired
                        (no webhook route, no keys in env.ts)
Receipt              ⬛  finops generates receipts headlessly; no delivery channel,
                        no download UI
```
**Verdict: 🟡 to the gavel, ⬛ after it.** The money loop — the product's stated reason to exist — never closes in the UI.

## J7 · Auctioneer → Conducted night

```
/auction (hub)   ✅  readiness + links
/cockpit         ✅  queue, gavel, freeze, undo, pause, recover, complete
Recovery         ✅  recover controls surfaced in cockpit and live panel
/ledger          ✅  full event ledger
/replay          ✅  replay surface
```
**Verdict: COMPLETE** (best journey in the product).

## J8 · Spectator → Watching

```
Get link         🔴  no public competition page; link arrives off-platform
/spectate        ✅  public, read-only, live
After the night  ⬛  no results page
```
**Verdict: PARTIAL.**

## J9 · Treasurer → Books closed

```
Record collections   ⬛  settlement writer reachable only from scripts/tests
Issue documents      ⬛  receipt/invoice code headless
Dispatch documents   ⬛  in-app rows nobody renders; filesystem outbox
Export to accountant ⬛  CSV register + Tally XML exist as code; no download UI
Fiscal close         ⬛  runner executes it; no screen shows it
```
**Verdict: MISSING.**

## J10 · Anyone → Logout

```
/account → Sign out   ✅  logoutAction clears session
```
**Verdict: COMPLETE** (trivially).

## Cross-journey defects (hit every persona)

1. **No navigation shell.** The only static internal link in the whole app is `/orgs` from a hint paragraph (`competitions/page.tsx:83`). Every journey requires typed URLs.
2. **No 404/error/loading routes.** Any mistyped slug or thrown error lands on the default Next.js screen — with no way back (no nav).
3. **No name identity.** People are phone numbers unless CSV-imported.
4. **No outward channel.** The platform cannot deliver an OTP, an invite, a status update, a receipt, or any message to anyone.
