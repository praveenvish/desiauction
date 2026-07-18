# Secret Rotation Runbook (PRP-1 §5)

Drilled locally 2026-07-16 against a live engine; measured results inline.

## Inventory

| Secret | Holders | Rotation effect |
|--------|---------|-----------------|
| `ENGINE_SECRET` | web (mints commands + spectator tickets), engine (verifies) | HARD CUTOVER — see drill |
| `SYSTEM_DATABASE_URL` / `DATABASE_URL` passwords | web, engine, finops-runner | Connection-pool refresh on restart |
| Razorpay `key_secret` + `webhook_secret` | web (settlement adapter) | Razorpay dashboard supports dual active webhook secrets during transition |
| `SENTRY_DSN` | web, engine | Non-secret-ish; rotate at leisure |
| Session tokens | user browsers | Self-rotating per login (identity/SESSIONS.md); nothing to do |

## ENGINE_SECRET rotation (drilled)

Ticket validity is HMAC(secret, auctionId·time-window) with a two-window
grace for TIME, not for SECRET — rotation instantly invalidates every
outstanding spectator ticket and every web-tier command credential. Measured
drill (2026-07-16, local): engine restart downtime **1.29 s**; after rotation
the old secret is refused (401) on the first request, stale tickets are
refused at WS upgrade, fresh tickets accepted.

Procedure:

1. **Never rotate during a live auction window.** Spectator tickets die at
   rotation; clients must re-fetch (page reload). The deploy workflow's
   planned live-window check (C-22) applies to rotations too.
2. Generate the new secret (32+ random bytes, base64url).
3. Update the platform secret store for BOTH apps (Fly secrets for engine,
   Vercel env for web) — do not deploy yet.
4. Redeploy engine and web back-to-back (engine first; web's old secret gets
   401s for the gap — commands fail closed, nothing corrupts; the engine is
   the single writer and recovers all state from the event log).
5. Smoke: `curl -H "x-engine-secret: <new>" https://<engine>/snapshot/<any>`
   expects 404 (authenticated, unknown auction) — a 401 means the deploy
   missed. Old secret must return 401.
6. Spectators on open pages reconnect with fresh tickets on next page load.

## Database credential rotation

1. `alter role desiauction_app password '<new>'` (owner session).
2. Update the secret store; redeploy web. Pool reconnects use the new
   password; existing connections are unaffected until closed.
3. Repeat for `desiauction_system` and the engine/runner writer credentials.

## Razorpay webhook secret

Razorpay allows configuring the new secret on the dashboard while the old
remains active on in-flight deliveries; deploy the new secret first, then
switch the dashboard. A stale-signature webhook is refused 401 and Razorpay
retries — no event is lost (settlement webhook ingress is idempotent and
envelope-pinned).

## Cadence

Quarterly, or immediately on suspicion of exposure. Every rotation appends a
row to the ops log (who, what, when, drill result).
