# Go-live runbook

> The ordered path from "engineering ready" to "first real organizer signs in".
> Written 2026-09-18 by the final readiness audit
> ([REPORT](../audits/FINAL-READINESS/REPORT.md)). Everything here needs an
> account, a credential, a DNS record or a decision that the repository cannot
> supply. Each step ends with a **proof**: a command or an observation that
> shows it is done. A step with no proof is not done.

Owners: **F** = founder (accounts, money, DNS, decisions) · **E** = engineering
(runs commands once F has supplied what they need) · **C** = counsel.

Do the sections in order. A, B and C are the three launch blockers (audit
P0-1..3), and each later section assumes the ones before it.

The reference documents this runbook sequences are [DEPLOYMENT](DEPLOYMENT.md)
(bootstrap, release order, rollback), [PRODUCTION_CHECKLIST](PRODUCTION_CHECKLIST.md)
(the item-by-item ledger), [ops/deploy/README](../../ops/deploy/README.md) (the
compose stack, env files, PITR), [RESTORE_RUNBOOK](RESTORE_RUNBOOK.md),
[EMAIL_SETUP](EMAIL_SETUP.md) and [SECRET_ROTATION](SECRET_ROTATION.md).

---

## A · Host, DNS and the database (P0-3, first half)

1. **F** — Provision the host. The sizing and the reasons behind it are in
   PRODUCTION_CHECKLIST §2 (4 vCPU / 8 GB, in India). Turn on the provider's
   off-server daily backup at the same time; it is the only thing that
   survives a dead disk until section B's off-host copy exists.
2. **F** — Point three DNS records at the host: `PUBLIC_DOMAIN`,
   `ENGINE_DOMAIN`, `S3_DOMAIN`.
   **Proof:** `dig +short <each name>` returns the host's address.
3. **E** — Create the env files on the host, `chmod 600`, split by service as
   listed in ops/deploy/README "The env files the host needs". Generate every
   secret fresh: `openssl rand -base64 48`. `ENGINE_SECRET` must be at least
   32 characters, and the repo's dev default is refused outside development.
4. **E** — Start Postgres alone and run the database bootstrap from
   DEPLOYMENT "Database bootstrap": migrations as the owner, then the role
   recipe **with all four passwords**, then both probes.
   **Proof:**
   ```sh
   pnpm --filter @desiauction/web grants:verify      # exits 0, "no drift"
   APP_DATABASE_URL=… pnpm --filter @desiauction/web rls:verify   # RLS VERIFICATION PASSED
   ```
5. **E** — Point each service at its own role: web `DATABASE_URL` →
   `desiauction_app`, web `SYSTEM_DATABASE_URL` → `desiauction_system`, engine
   → `desiauction_engine`, runner → `desiauction_runner`. Never the owner.
6. **E** — Confirm the four roles work together as a system, not only table by
   table, before any real person touches it:
   ```sh
   pnpm --filter @desiauction/web rehearsal    # one whole auction night, all four roles
   ```
   **Proof:** the rehearsal completes. It refuses to run if the app role is
   BYPASSRLS, so a pass means the posture is the real one.

## B · Backups you have restored (P0-2)

Nothing here is optional, and none of it counts until a restore has been timed.

1. **E** — WAL archiving (PITR). The database image is built from
   `ops/deploy/db/Dockerfile` so `archive_command` can find pgBackRest. The two
   silent failures that were fixed along the way are recorded in
   ops/deploy/README "PITR is the only rollback".
   The sidecar creates the stanza on every boot, runs `check`, and takes a
   weekly full backup plus a daily differential.
   **Proof:** `select archived_count, failed_count from pg_stat_archiver`
   shows archived > 0 and failed = 0. Then repeat the drill ops/deploy/README
   "What was verified" records on the production stanza before the first real
   auction: write a row after a backup, restore, and confirm the row came back
   from WAL.
2. **F + E** — **An off-host copy.** The pgBackRest repo lives in the MinIO on
   the same box, so it protects against a bad migration and not against
   losing the machine. Choose a second destination in a different account (any
   S3-compatible bucket), then:
   - schedule `pnpm backup` daily with `BACKUP_DIR` on that destination and
     `BACKUP_DATABASE_URL` set to a backup-only role;
   - copy `minio_data` there too (`mc mirror`). pgBackRest does not back up
     MinIO, and the finops bucket holds financial records.
   **Proof:** the dated dump and the mirrored objects are listed in the
   off-host bucket from a machine that is not the host.
3. **E** — **Restore drill, timed.** Local rehearsal, then the same drill on
   staging against a real dump:
   ```sh
   pnpm restore:drill --rehearse
   ```
   It restores into a scratch database, verifies it, and conducts a whole
   auction night on the copy under the four roles.
   **Proof:** record the wall-clock RTO in RESTORE_RUNBOOK "Rehearsal record"
   with the date and dump size. The local figure is in the audit REPORT §11.
4. **E** — Put backup success on the alert list (section F). An alert has to
   fire when a backup is **missing**, not only when one errors.

## C · Sign-in works for real people (P0-1)

Login is OTP-first. Until this section is done, nobody but the operator can
sign in. `env.ts` refuses to start production with `OTP_PROVIDER=dev`.

1. **F** — MSG91 account plus **DLT registration**: the principal entity, the
   sender header, and one content template per message shape — every template
   in [DLT_REGISTRATION](../messaging/DLT_REGISTRATION.md), generated from the
   code. The OTP template needs a code slot. Registration decision notices are
   separate templates (the regime registers one template per message shape),
   the old number's phone-change notice is one more, and so are the three
   personal texts (a sale, a named role, a lineup).
2. **E** — Set in `web.env`:
   ```sh
   OTP_PROVIDER=msg91
   MSG91_AUTH_KEY=…
   MSG91_TEMPLATE_ID=…                              # the OTP template
   MSG91_TEMPLATE_REGISTRATION_APPROVED=…           # one per decision shape
   MSG91_TEMPLATE_REGISTRATION_WAITLISTED=…
   MSG91_TEMPLATE_REGISTRATION_REJECTED=…
   MSG91_TEMPLATE_REGISTRATION_WITHDRAWN=…
   MSG91_TEMPLATE_REGISTRATION_RESTORED=…
   MSG91_TEMPLATE_SECURITY_PHONE_CHANGED=…          # the old number is told
   MSG91_TEMPLATE_AUCTION_SOLD=…                    # "Cup Kings bought you for Rs 75,000"
   MSG91_TEMPLATE_TEAM_APPOINTED=…                  # "You are named captain of Cup Kings"
   MSG91_TEMPLATE_LINEUP_ANNOUNCED=…                # "You are in the Cup Kings lineup vs Tigers"
   SMS_INBOUND_SECRET=…                             # ≥16 chars; STOP replies land here
   ```
   A missing decision template makes that one notice refuse with the variable
   named; it does not send against another shape's registration. The two
   auction texts are the same: without their ids the sale and the appointment
   still reach the player by inbox and email, and the queued text fails once
   with the variable named (`message_outbox.last_error`). Texts due between
   10 pm and 8 am IST wait for 8 am. The circuit breaker (3 consecutive
   provider failures, 60 s cool-down) is on by default.
3. **E** — Configure the provider's inbound (STOP) webhook with the same
   `SMS_INBOUND_SECRET`. While the secret is unset, that route answers 404.
   **Proof:** sign in on a phone that has never used the product, from a
   network that is not the office's. Time it: the code should arrive within
   seconds. Then reply STOP and confirm the number appears on the suppression
   list.
4. **F** — _Optional, not a launch blocker._ WhatsApp for the personal
   messages. A player who ticks "Send my auction and team updates on WhatsApp
   instead of SMS" gets the sale (with their player card), a named role and a
   lineup on WhatsApp instead of by text. Needs a verified Meta Business
   account with a WhatsApp number on the Cloud API, and the three templates in
   [WHATSAPP_TEMPLATES](../messaging/WHATSAPP_TEMPLATES.md) approved (Utility,
   English). **E** — set in `web.env`:
   ```sh
   WHATSAPP_PHONE_NUMBER_ID=…                       # shared with WhatsApp sign-in codes
   WHATSAPP_ACCESS_TOKEN=…
   WHATSAPP_TEMPLATE_AUCTION_SOLD=…                 # the APPROVED template names
   WHATSAPP_TEMPLATE_TEAM_APPOINTED=…
   WHATSAPP_TEMPLATE_LINEUP_ANNOUNCED=…
   ```
   Until a template's name is set, that moment goes by SMS even to players who
   opted in, and any WhatsApp failure falls back to SMS in the same send.
   **Proof:** opt in on /account with a test number, announce a lineup for a
   test match, and see it arrive on WhatsApp; the queue row's `channel` reads
   `whatsapp`.

## D · Environment and preflight (P0-3, second half)

1. **E** — Fill `web.env` from `.env.example`. Every variable is annotated
   there. The derived values (`RP_ID`, `RP_ORIGINS`, `MEDIA_PUBLIC_BASE`,
   `FINOPS_S3_ENDPOINT`) come from `PUBLIC_BASE_URL` and `MEDIA_S3_ENDPOINT`.
   Set them only to override, and an override is checked against the real
   host.
2. **E** — `ENGINE_ALLOWED_ORIGINS` in `engine.env`, set by hand to the
   `PUBLIC_BASE_URL` origin. It is a different process and derives nothing.
3. **E** — Run preflight with the production env loaded:
   ```sh
   pnpm preflight:production
   ```
   **Proof:** zero FAIL lines. It checks, among others: distinct app and
   system database URLs, remote engine URLs with `wss://`, a real OTP provider
   with its credentials, `RP_ID` matching the host, bucket storage for both
   media and finops, `SENTRY_DSN`, `TRUSTED_PROXY_COUNT`, and that the legal
   identity is published.
4. **E** — Deploy in release order (DEPLOYMENT "Release order"): engine, then
   runner, then web.
   **Proof:** `curl -fsS https://$ENGINE_DOMAIN/healthz`,
   `curl -fsS https://$PUBLIC_DOMAIN/readyz`, and the runner logging its
   machines as `started`.
5. **E** — Schedule the daily feedback job: `POST /api/jobs/feedback` with the
   `x-feedback-job-secret` header (`FEEDBACK_JOB_SECRET`). Besides review asks
   and report retention, it is what ages out spent sign-in codes and stored
   request addresses after a day.
   **Proof:** one run returns `security` counts in its JSON body.
6. **E** — Schedule the personal-message drain every 5 minutes:
   `POST /api/jobs/messages` with the same `x-feedback-job-secret` header. The
   sale and the captain/icon announcement send right away on their own; this is
   what retries a mail the provider refused, with back-off, up to five tries.
   **Proof:** one run returns `drained: { sent, suppressed, retrying, failed }` in its
   JSON body.

## E · Errors reach somebody

1. **F** — Create the Sentry project(s). **E** — Set `SENTRY_DSN` for web and
   engine. Production refuses to boot the web tier without it.
   **Proof:** trigger a test error from the staging web tier and see it in
   Sentry within a minute, with a request id attached.
2. **E** — Content-Security-Policy is Report-Only from day one. After a first
   production week with no `csp.violation` lines in the logs, set
   `CSP_ENFORCE=1`. Unsetting it backs out without a deploy.

## F · Alerts on silence (P2-H)

The platform runs on one host with a single engine process by design. That is
acceptable only because the engine recovers from its event log. The restart
time the audit measured is in REPORT §11. Somebody has to learn of an outage
before a club does.

1. **E** — Uptime checks on `/healthz` (engine) and `/readyz` (web) from outside
   the host, paging a phone.
2. **E** — Alerts on the absence of things. Suggested starting thresholds: no
   backup in 26 h, runner tick age over 5 min, a finops follower cursor not
   advancing for 15 min. Tune them after the first month. PRODUCTION_CHECKLIST §4
   lists the full set.
3. **E** — Drill it: stop the staging runner and confirm the page arrives.
   **Proof:** the page arrives, with a timestamp in the deploy log.

## G · Email posture (S-7)

1. **F** — DMARC is at `p=none` on both domains. After reading two weeks of
   aggregate reports and confirming SPF and DKIM alignment for Zoho and
   Resend, **edit** the existing `_dmarc` record to `p=quarantine`. A second
   record invalidates both. See EMAIL_SETUP.
   **Proof:** `dig +short TXT _dmarc.desiauction.in` shows `p=quarantine`, and
   a test booking confirmation still lands in an inbox.
2. **F** — Confirm the statutory mailboxes (`privacy@`, the grievance officer)
   receive mail from an outside address. Publishing them started a clock.

## H · Money (P2-R)

Manual capture (cash, UPI, bank) is the path that has actually run, and it
works without anything in this section. The gateway is optional for beta.
If you turn it on:

1. **F + C** — Ask a CA and the gateway adviser first. Collecting on behalf of
   organizers raises the GST-registration and RBI payment-aggregator
   questions, and neither waits for a turnover threshold.
2. **F** — Razorpay live keys, the webhook secret, and **a Route linked account
   per organizer**. The code refuses every gateway payment with
   `no_settlement_account` until an organizer has one. The platform's own
   account is never a fallback.
3. **E** — `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
   `RAZORPAY_WEBHOOK_SECRET` (≥16 chars; unset makes the webhook route 404).
   **Proof:** one live staging transaction end to end: order → webhook →
   capture → the season's books discharge.

## I · Price (S-8)

1. **F** — Decide the paid tiers. Today `/pricing` says "Free through the beta,
   always free for up to 4 teams and 40 players", and the two larger tiers
   have no price. That is honest for a beta and has to change before anyone is
   charged.
   **Proof:** the decision is written into `apps/web/src/content/marketing.ts`
   and `/pricing` renders it.

## J · Legal ratification (P1-L)

1. **C** — Review and ratify the Terms, the Privacy Policy and the Data
   Retention policy. They are marked `BETA_DRAFT_2` (Privacy and Retention
   v0.2, 18 Sep 2026). The drafts were updated in this audit for account
   erasure and the newsletter list. The product takes money and registers
   minors, and both facts are in scope.
2. **F** — Publish the legal identity (`apps/web/src/content/company.ts`).
   Preflight's `legal-identity-published` check fails until it is published.
3. **F + C** — **Decide whether ratification needs fresh acceptance.**
   `TERMS_NOTICE_VERSION` (`apps/web/src/server/auth/terms-consent.ts`,
   currently `2026-08-30`) names the wording the sign-in notice showed.
   Bumping it records a new consent row for every person at their next
   sign-in, so "did they agree to what we showed that day?" stays answerable.
   If counsel treats the ratified text as materially different, bump it in the
   same release that publishes the text.
   **Proof:** the ratified documents are live, and `consent_records` holds rows
   for the new version after the first sign-ins.

## K · The smoke scenario (the last gate)

Run it on production, with real phones, before the first organizer is invited.
It is the whole product in one evening:

1. An organizer signs in by SMS, names themselves, creates an organization and
   a season in a non-cricket sport, and publishes registration.
2. Four players register from their own phones (one of them a minor, with
   guardian consent). The organizer approves three and waitlists one, and each
   gets the right SMS.
3. The organizer creates teams, invites two owners by link, and grants them
   paddles. The owners claim the paddles on their own phones.
4. A live auction: at least one extension, one undo, one unsold lot, and a
   spectator on the public link. Stop the engine mid-lot, restart it, and the
   room recovers.
5. Settle the season with manual capture. The runner issues the receipts, and
   a player downloads theirs.
6. One player asks for account erasure, and the privacy desk (a
   `platform:privacy` holder, granted with
   `pnpm --filter @desiauction/web seed:admin -- --set platform:privacy <phone>`)
   carries it out.
7. During step 4 the operator watches the room on `/admin/live` and its
   `/admin/auctions/[id]` page, and the numbers agree with the organizer's own
   Auction tab. A `platform:moderation` holder takes the season's public page
   down and lifts the hold again (see [ADMIN_OPERATIONS](ADMIN_OPERATIONS.md)).

**Proof:** every step done by a real person on a real device, and no new
Sentry issue. The next morning, a backup of that night is listed off-host.

## After launch

- **Day 31 or later** — remove the legacy session-cookie fallback. Production
  sessions are issued as `__Host-da_session`; `presentedToken` in
  `apps/web/src/server/auth/actions.ts` still accepts the old `da_session` so
  the rename signed nobody out. The cookie itself expires 30 days after it
  was issued (it is not re-set when a session slides), so after that no
  browser still holds the old name.

---

When A–K are all proven, the audit's three P0 blockers are closed. Record the
date and the proof for each section in REPORT §24.
