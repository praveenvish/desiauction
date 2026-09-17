# FR-1 — Problem reports and reviews

**Status:** Phase 1 BUILT (2026-09-17, uncommitted on `feature/fr1-feedback`); Phases 2–5 planned. **Author:** engineering. **Planned:** 2026-09-17.
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
