# Beta Onboarding Guide

For the operations team running the DesiAuction public beta, and for the first
hand-picked organizers. No engineering assistance required.

## Who does what

- **Founder / platform operator** — provisions infrastructure and providers
  (checklist §1–3), runs the deploy, holds the `platform.admin` grant, watches
  health and monitoring.
- **Organizer** — runs a tournament: creates a competition, opens registration,
  conducts the auction, settles the money. Onboarded by an invite link or by
  self-serve sign-in + "Create your organization".
- **Player / team owner** — registers via a link, bids on the night, sees what
  they owe. No account setup beyond a phone number.

## First-run: provision → deploy → verify

1. **Provision** the founder externals (see [PRODUCTION_CHECKLIST](PRODUCTION_CHECKLIST.md) §1–3):
   managed Postgres 17, apps on Fly/Vercel, S3 storage, SMS (MSG91), domains/TLS,
   Sentry DSNs, and (optionally) Razorpay.
2. **Validate config** — export the production env and run `pnpm preflight:production`.
   It refuses to pass until every production blocker is set. Do not deploy on a FAIL.
3. **Bootstrap the database** — apply migrations, then the four-role recipe
   (`ops/db/create-app-role.sql`), then `pnpm rls:verify` (proves the app role
   cannot bypass RLS). See [DEPLOYMENT](DEPLOYMENT.md).
4. **Deploy** — the credential-gated Fly workflows (engine, runner) and the
   Vercel flow (web). Point web at the engine (`ENGINE_URL`/`ENGINE_PUBLIC_WS_URL`).
5. **Verify health** — web `GET /healthz` (liveness) + `GET /readyz` (DB
   readiness, 200 `db:ok`); engine `GET /healthz` (DB + watchdog). Wire the
   orchestrator: liveness → `/healthz`, readiness → `/readyz`.
6. **Smoke** — the founder scenario: OTP sign-in → create competition →
   register → live auction → settle → receipt. See [FOUNDER_SCENARIOS](../validation/FOUNDER_SCENARIOS.md).

## Create the beta accounts

- **Platform admin**: sign in once as the founder's number, then
  `pnpm --filter @desiauction/web seed:admin -- +91XXXXXXXXXX` (writes the
  `platform.admin` grant on the system pool — the only way it is issued).
- **Demo organization + tournament**: `pnpm --filter @desiauction/web seed:demo`
  seeds a demo club, a journey-ready competition, and a settled exemplar with
  fixed demo identities — useful for training and for a live walkthrough.
- **Real organizers**: onboard by sending them the app URL. They sign in with
  their phone and create their organization; grant them nothing extra — org
  ownership is theirs on creation. Money authority (settlement/finance) is a
  separate, deliberate grant the organizer issues to their own treasurer.

## Day-to-day operation

- **Watch**: web `/readyz`, engine `/healthz`, the finops runner's tick age,
  and Sentry. Alert on SILENCE (a stale runner cursor, a missed backup), not
  only on errors.
- **Support**: the in-product Support page (`/support`), Help centre (`/help`),
  and `support@desiauction.in`. Issue triage: [ISSUE_REPORTING](ISSUE_REPORTING.md).
- **Recover**: worker restarts and deploys are self-healing (engine replays to a
  snapshot; the finops follower/jobs are idempotent). **Rollback depends on
  whether the release shipped a migration**: no migration means an app-image
  swap; a migration means expand/contract or a restore to the pre-deploy restore
  point, because migrations are forward-only and there are no down migrations
  (0015–0026 shipped after RC-1, one of them destructive). Procedure:
  [DEPLOYMENT §Rollback](DEPLOYMENT.md#rollback). Restore from backup:
  [DISASTER_RECOVERY](DISASTER_RECOVERY.md).

## What to tell beta organizers

- It's free during beta, with full features.
- Payments are recorded, not processed — you collect via cash/UPI/bank and
  record it; receipts and an immutable ledger are produced for you.
- Sign-in is by mobile number; keep your number with you.
- Report anything odd — see the Support page. On auction night, put "AUCTION
  NIGHT" in the subject and it jumps the queue.
