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
2. **F** — **An off-host copy.** Choose a destination in a different account
   (any S3-compatible bucket) and fill in `pgbackrest.env` (repo1) and
   `mirror.env` (the MinIO buckets) per ops/deploy/README "Backups". The
   sidecars are automated; until repo1 is off-box the `pgbackrest` sidecar
   refuses to run unless `PGBACKREST_ALLOW_ONBOX_REPO=1` is set, and the mirror
   refuses outright.
   **Proof:** `pgbackrest info` lists a backup in the off-box repo, and the
   mirrored objects are listed in the off-host bucket from a machine that is
   not the host. `backup-production.yml` goes green.
3. **E** — **Restore drill, timed.** Local rehearsal, then the same drill on
   staging against a real dump:
   ```sh
   pnpm restore:drill --rehearse
   ```
   It restores into a scratch database, verifies it, and conducts a whole
   auction night on the copy under the four roles.
   **Proof:** record the wall-clock RTO in RESTORE_RUNBOOK "Rehearsal record"
   with the date and dump size. The local figure is in the audit REPORT §11.
4. ☑ Backup success is on the alert list: `da-backup-failed` and
   `da-backup-stale` (no `BACKUP_OK` in 26 h) fire on the missing backup, not
   only the failed one, and `backup-production.yml` checks the same from
   outside nightly. **F** — `ALERT_WEBHOOK_URL` so they reach a phone.

## C · Sign-in works for real people (P0-1)

Login is OTP-first. Until this section is done, nobody but the operator can
sign in. `env.ts` refuses to start production with `OTP_PROVIDER=dev`.

**WhatsApp replaces SMS for launch** (founder decision 2026-09-23). Sign-in
codes and personal messages go out on Meta's WhatsApp Cloud API directly; SMS
through MSG91 is **deferred** until DLT registration, and nothing in env.ts or
preflight requires it. Email sign-in stays the default door
(`LOGIN_DEFAULT_METHOD=email`) and works with no text channel at all.

1. **F** — Meta Business verification, a WhatsApp Business Account, a phone
   number with the display name `DesiAuction` approved, a System User token,
   the authentication template and the utility templates approved. Every step,
   with where each value lives in Meta's dashboards:
   [WHATSAPP_SETUP](../messaging/WHATSAPP_SETUP.md). The template texts to
   submit (English and Hindi) are in
   [WHATSAPP_TEMPLATES](../messaging/WHATSAPP_TEMPLATES.md), generated from the
   code.
2. **E** — Set in `web.env`:
   ```sh
   OTP_PROVIDER=whatsapp
   WHATSAPP_PHONE_NUMBER_ID=…                       # Meta's phone number ID, not the number
   WHATSAPP_ACCESS_TOKEN=…                          # System User token, no expiry
   WHATSAPP_TEMPLATE_NAME=…                         # the approved AUTHENTICATION template
   WHATSAPP_APP_SECRET=…                            # App settings → Basic; signs every callback
   WHATSAPP_WEBHOOK_VERIFY_TOKEN=…                  # ≥16 chars, yours; pasted into Meta's form
   WHATSAPP_TEMPLATE_…=…                            # one per approved utility template
   ```
   `env.ts` refuses to boot production with WhatsApp sending configured and
   either webhook secret unset: replies — STOP among them — land only on the
   callback URL, and a number that cannot hear STOP breaks Meta's policy and
   the DPDP Act. A utility template whose name is unset is simply not sent on
   WhatsApp.
3. **E** — In the Meta app, **WhatsApp → Configuration → Webhook**: Callback
   URL `https://desiauction.in/api/webhooks/whatsapp`, Verify token =
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, subscribe to the **`messages`** field, press
   **Test**. Deploy the two secrets first: the route answers 404 until they are
   set.
   **Proof:** sign in by the phone tab on a phone that has never used the
   product, from a network that is not the office's. Time it: the code should
   arrive on WhatsApp within seconds. Opt in on /account, trigger a personal
   message, and see its `message_outbox` row reach `delivery_status =
   delivered`. Then reply STOP: the confirmation arrives, and the latest
   `whatsapp.updates` row in `consent_records` for that person is
   `granted = false`. Reply START and it flips back.
4. **F** — _Deferred, not a launch blocker._ SMS via MSG91 and **DLT
   registration** (principal entity, sender header, one content template per
   shape — [DLT_REGISTRATION](../messaging/DLT_REGISTRATION.md)). When it
   lands: `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` and the per-shape
   `MSG91_TEMPLATE_*` ids, `SMS_INBOUND_SECRET` for the SMS STOP webhook, and
   only then consider `LOGIN_DEFAULT_METHOD=phone` — preflight warns about
   phone-first login with no SMS fallback, because a Meta outage would close
   the default door.

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

1. **F** — Uptime checks on `/healthz` (engine) and `/readyz` (web) from outside
   the host, paging a phone — ALERTS "Outside the box".
2. ☑ Alerts on the absence of things, provisioned: no backup in 26 h, no mirror
   in 3 h, no successful scheduled job in 15 min, plus runner crash loops. Runner
   tick/queue AGE is still not in the logs (ALERTS table). **F** —
   `ALERT_WEBHOOK_URL`.
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

1. An organizer signs in (email, or a WhatsApp code on the phone tab), names themselves, creates an organization and
   a season in a non-cricket sport, and publishes registration.
2. Four players register from their own phones (one of them a minor, with
   guardian consent). The organizer approves three and waitlists one, and each
   is told (inbox and email; WhatsApp where a template is approved — SMS is
   deferred for launch).
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
