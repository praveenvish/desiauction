# FR-1 — Problem reports and reviews

**Status:** Phases 1–3 BUILT (2026-09-17/18, on `feature/fr1-feedback`); Phases 4–5 planned. **Author:** engineering. **Planned:** 2026-09-17.
**Founder decisions:** taken 2026-09-17 — "go with your recommendations" (§8).

---

## 1. Why this does not exist today

There is no way for anybody to tell us something is broken, and no way for
anybody who ran or played in a season to tell us — or anyone else — how it went.

- `/support` and `/contact` print addresses and say, in their own source, "no
  ticketing backend; no form here pretends to file one".
- The landing page is uniformly no-fabrication, enforced by
  `apps/web/src/content/content.test.ts` ("testimonial" is a banned marker).
  Reviews are the honest route to proof; they may only ever surface as real,
  consented, operator-approved rows.

## 2. What the codebase already gives us

| Need | Existing piece |
|---|---|
| Public form, spam-safe | `server/marketing/actions.ts` — honeypot → validate → throttle → INSERT → acknowledge |
| Mail with a file | `server/messaging/transactional-mail.ts` — `OutgoingMail.attachment` |
| Operator queue + capability | `platform:demo` in `server/admin/capabilities.ts`, `/admin/demos` |
| Scheduled work | `POST /api/jobs/demo-reminders` — fail-closed secret, idempotent |
| Signed links without login | DEMO-1 HMAC-derived tokens |
| Consent to send | `server/messaging/consent.ts` three-layer gate (`maySend`) |
| Storage | `server/media/storage-port.ts` (local FS / S3 via injected signer) |

## 3. Facts that constrain the design

1. **A season has no "completed" status.** `competitions.status` stops at
   `registration_closed`. Only `auctions.status` (`completed`/`reconciled`) and
   `fixtures.status` (`completed`) record an ending. "Event completed" is
   DERIVED from those, never asserted (see the /home "settled" incident).
2. **Players can be minors** (`date_of_birth`). Review mail and public reviews
   skip anyone under 18 AND anyone whose date of birth is unknown.
3. **Screens carry private data** — phones, purses — and some URLs carry
   bearer tokens (`/join/[token]`, `/owner-join/[token]`, demo manage links).
4. **Local runs as DB owner**, so grants never fail locally. Every migration
   here states its role model and is checked with the production-role probe.

## 4. Module A — Report a problem (Phase 1)

**Entry points.** Avatar menu in the product shell; footer link on public
pages; `/support` form. (Live room: a later pass — the peer premium-UI session
owns that surface.)

**What is captured.**
- The person's words (required), a category (`bug` / `confusing` / `idea` /
  `other`), an optional reply email (guests; signed-in people default to theirs).
- The page: URL with query string dropped and token path segments replaced by
  `[redacted]`, viewport, user agent, theme, app build, signed-in person id.
- A screenshot, captured in the browser with a bundled library (no third-party
  script — CSP unchanged). Elements marked `data-private` are masked during
  capture. The person SEES the screenshot before sending and can remove it or
  upload their own image instead. Capture failure falls back to upload.

**Submit.** honeypot → validate → throttle (per IP and per person) → INSERT
`problem_reports` → store screenshot → mail `support@` with the image attached
and a link to `/admin/reports/[id]` → acknowledge the reporter if an address is
known. Mail failure never fails the submission.

**Operator desk.** `/admin/reports`, behind a new `platform:support`
capability set (seeded like `platform:demo`). Statuses: `new` → `triaged` →
`fixed` | `wont_fix` | `duplicate`. Screenshots purged after 90 days by the
retention sweep.

## 5. Module B — Reviews (Phases 2–5)

| | Platform review | Tournament review |
|---|---|---|
| Who | Organizers, team owners | Registered adult players, team owners |
| Content | 1–5, what worked, what to improve, "you may quote me" | 1–5, comment |
| Shown | Nowhere until approved; approved+consented may become testimonials | `/c/[slug]` when public and ≥3 approved reviews |
| Moderation | Operator approval | Held for approval during beta; organizer may reply, not delete; readers can report |

**When a request is sent.**
1. Auction reaches `completed` → +2h → owners and organizers.
2. Season derived finished (every fixture `completed`/`cancelled`, ≥1 played)
   → players and owners (tournament), organizers (platform).
3. Manual — organizer "Ask for reviews" (once per 7 days per season) and an
   operator button in `/admin`.

One `review_requests` row per person×subject (UNIQUE — resending is a no-op),
sent by `POST /api/jobs/review-requests`, gated by `maySend` under a new
`feedback_requests` topic with `orgId` passed. Link = HMAC-derived token,
30-day expiry, no login needed.

## 6. Data

| Migration | Table | RLS |
|---|---|---|
| 0064 | `problem_reports` | none (stranger-authored, like `demo_requests`) |
| 0065 | `review_requests`, `reviews`, `review_reports` | tournament reviews tenant-scoped |

Journal `when` = previous + 86400000 (silent-skip trap). Role script re-run and
the production-role probe for each.

## 7. Phases

| Phase | Scope | Size |
|---|---|---|
| 1 | Report a problem: form, screenshot, mail, desk, retention | ~1 wk |
| 2 | Review form (token page) + platform reviews + approval desk | ~1 wk |
| 3 | Automatic requests: three triggers, sweep, consent topic | ~1 wk |
| 4 | Public tournament reviews on `/c/[slug]`, reply, reports | ~1 wk |
| 5 | Testimonials from approved consented rows; content test amended | days |

Each phase: regression tests, precompiled e2e, axe, 320px. Built on
`feature/fr1-feedback` off `main`.

## 8. Founder decisions (2026-09-17)

1. Players with unknown date of birth receive no review mail. **Yes.**
2. Guest reply email is optional, with an honest note. **Yes.**
3. Tournament reviews held for approval during beta. **Yes.**
4. No-fabrication rule loosened only for approved, consented reviews. **Yes.**

## 9. Phase 1 — what shipped, and where the plan was wrong

**Shipped.** Migration `0064_problem_reports` (`problem_reports` +
`problem_report_screenshots`, no RLS); `server/support/*` (validation,
redaction, throttle, mail, triage, retention); `platform:support` capability
set + `platformSupportGate`; `/admin/reports` desk + gated
`/admin/reports/[id]/screenshot`; `POST /api/jobs/feedback`
(`FEEDBACK_JOB_SECRET`); `ReportProblemProvider` in the root layout, opened from
the avatar menu, the mobile drawer, the public footer (`#report-a-problem`) and
`/support`. Table is `problem_reports`, not `bug_reports` — "idea" and
"confusing" are categories too.

**Where the plan was wrong or incomplete — each found by running it:**

1. *Screenshots in the media store.* The storage port serves every key from a
   public base URL, so screenshots live in the database behind a gated route.
2. *Masking by colour.* Setting `color: transparent` on the clone still drew the
   phone numbers. The mask now replaces the characters in the clone.
3. *Animation-frame scheduling.* A hidden tab pauses frames, so capture never
   started. Now a timer plus a 20 s give-up that offers upload instead.
4. *Route-level CSP.* `next.config.mjs` headers replace a route handler's header
   of the same name; the screenshot's `sandbox` policy is restated there.

**Operator setup before this is live:** set `FEEDBACK_JOB_SECRET` and schedule
`POST /api/jobs/feedback` (header `x-feedback-job-secret`); grant the desk with
`seed:admin -- --set platform:support <phone>`; re-run the role recipe and
`grants:verify` after 0064.

**Verification.** 25 unit + 11 DB regression tests (support), admin read-only
proof extended to `reportQueue`, nav/content suites (125 total green); lint,
typecheck, depcruise, format, production build green; browser-verified guest
footer flow, signed-in submit (row + 96 KB JPEG), 404 partition without the
grant, desk triage, gated image headers, and phone masking on a real
registrations table. Not yet run: Playwright e2e for this flow.

## 10. Phase 2 — what shipped, and where the plan was wrong

**Shipped.** Migration `0065_platform_reviews` (`review_requests`, `reviews`,
no RLS, `subject_type` pinned to `platform` by CHECK so Phase 4 widens a
constraint instead of reshaping tables); `server/reviews/*` (HMAC link tokens
under `REVIEW_TOKEN_SECRET`, one ask per person via unique index + ON CONFLICT,
validation, page state, submit-while-pending, moderation, the desk's ask flow);
`/review/[token]` (public, noindex, unknown → 404, expired and closed said
plainly); `/admin/reviews` (ask by email or number, copyable link, publish/hide,
who-was-asked with sent/opened/reviewed); a `feedback` topic on /account that
the ask honours through `maySend`.

**Decisions made while building:**

1. *The desk shares `platform:support`* with Reports — both are what people told
   us; a fifth grant would be ceremony.
2. *An ask always yields a link*, even when mail cannot go (no email, mail
   unconfigured): most organizers live on WhatsApp. An opted-out person gets no
   link on the desk, so an operator cannot route around their choice.
3. *Deleting a person deletes their review* (CASCADE): the words are theirs.
4. *Date of birth for the minor check* is the profile's, else the latest
   registration's — read on the system pool, because registrations are tenant
   rows and under the app role a minor would look undated.
5. *A moderated review is frozen*: `ON CONFLICT … DO UPDATE … WHERE status =
   'pending'`, so a submit that read "pending" a moment before publish cannot
   overwrite what was published.

**Found by running it:** React resets a form's uncontrolled fields when its
action settles, so the page thanked the person and showed an empty form. The
action now echoes the submitted values and the form remounts from them.

**Also found:** `.env.local` carries a real Resend key, so a local dev server
SENDS REAL MAIL. Browser checks from here on run with the `EMAIL_*` lines
stripped from the env file.

**Operator setup before live:** set `REVIEW_TOKEN_SECRET` (32+ chars; the dev
default is refused in production); re-run the role recipe and `grants:verify`
after 0065.

**Verification.** 13 unit + 15 DB regression tests (reviews); admin read-only
proof extended to `reviewDesk`; 255 tests across the touched suites green; lint,
typecheck, depcruise, format, production build green; browser-verified ask →
link → write → edit → publish → link closed, the /account switch, and the form
at 320px. Not yet run: Playwright e2e for either phase.

## 11. Phase 3 — what shipped, and where the plan was wrong

**Shipped.** `server/reviews/review-sweep.ts`, run by the existing
`POST /api/jobs/feedback` after the retention purge. It asks for a PLATFORM
review 2 hours to 14 days after:

- **an auction closed** — timed by the `AuctionClosed` event in the auction's
  ledger. Asks the club's organizers and every paddle holder, each with their
  own opening line ("You've run a tournament" / "You bid for a team").
- **a season finished** — derived: every fixture completed or cancelled, at
  least one played, timed by the latest fixture. Asks the organizers.

One platform ask per person, ever; the sweep never re-issues (only the desk
does). No email → not asked. Known minor → never asked. "Feedback requests"
off → the ask is recorded so no later sweep reconsiders them, but never mailed.
At most 200 asks per run. The desk's ask list now says why each person was
asked.

**Where the plan was wrong:**

1. *"Auction reaches completed → +2h" had no clock.* `auctions` has no
   completion time; the ledger's `AuctionClosed` event does. 96 local auctions
   are "completed" with no close event (seeded) — they are never asked about.
2. *"Organizers" is not org membership.* Team owners are viewer-level members,
   so organizers are active `org:owner` / `org:staff` grants.
3. *Without an upper bound the first run would mail everybody* who ever closed
   an auction (461 locally). The 14-day lookback is the guard.
4. *"Players and owners (tournament)" moved to Phase 4* — this phase only has
   the platform subject; tournament asks arrive with tournament reviews.
5. *The club's messaging switch is not consulted.* It governs SMS on behalf of
   a club; this is a platform email, gated by the person's own switch.

**Operator setup:** schedule `POST /api/jobs/feedback` every 15–60 minutes
(it already needed scheduling for Phase 1's purge).

**Verification.** 13 DB regression tests (isolated by running the sweep with a
January-2020 clock over January-2020 fixtures, so the cross-tenant read cannot
touch real rows); a read-only dry run of the candidate query against the real
local database: 74 ms, 1 candidate.

## 12. Merge note — account erasure (0066, on `ui/premium-foundation`)

A parallel branch adds account erasure (`0066_account_erasure`, deliberately
numbered after this branch's 0064/0065). Erasure KEEPS the `people` row and
scrubs it, so this branch's `ON DELETE CASCADE` / `SET NULL` never fire for an
erased person. Whichever branch merges second must extend the erasure to:

- delete the person's `review_requests` (their `reviews` cascade with them);
- null `problem_reports.reply_email` where `person_id` is theirs (the report
  itself stays — it is about the platform — but its way to reach them goes).

Also: that branch's 0069 adds FKs on attribution columns; on the shared local
database, `consent.regression` and `admin-foundation.regression` fail from THIS
branch because the database is ahead of it. Not a defect here; re-run after the
branches meet.
