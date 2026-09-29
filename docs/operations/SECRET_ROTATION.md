# Secret Rotation Runbook (PRP-1 §5)

Drilled locally 2026-07-16 against a live engine; measured results inline.

## Inventory

Every secret the self-hosted stack holds, where it lives on the host
(`/srv/apps/desiauction/<environment>/`), and what rotating it costs. Generated
by `ops/deploy/init-env.sh` unless marked founder-held. This table was rewritten
on 2026-09-29: the one it replaces described a Fly and Vercel deployment that no
longer exists and listed seven secrets of the twenty below.

| Secret | File(s) | Rotation effect |
|--------|---------|-----------------|
| `ENGINE_SECRET` | `web.env`, `engine.env` | HARD CUTOVER — see the drill below. It does FOUR jobs: authenticates web-to-engine commands, signs spectator socket tickets, keys the digests of sign-in codes (`auth/code-digest.ts`), and signs the passkey challenge cookie (`auth/actions.ts`). Rotating it also invalidates every sign-in code in flight (five to fifteen minutes' worth) and every passkey sign-in in progress |
| Database owner password (`POSTGRES_PASSWORD`) | `db.env`, `migrator.env` | `alter role postgres password …`, then both files. Used only by the migrator and by hand |
| `desiauction_app` / `desiauction_system` passwords | `web.env` (`DATABASE_URL`, `SYSTEM_DATABASE_URL`) | See "Database credential rotation" |
| `desiauction_engine` password | `engine.env` | Same; restarts the engine, so outside a live window only |
| `desiauction_runner` password | `runner.env` | Same |
| Object storage root (`MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`) | `minio.env`, and as `MEDIA_S3_*` / `FINOPS_S3_*` in `web.env` and `runner.env` | The application uses the ROOT credential, so this restarts storage, web and runner together. Uploads fail for the length of the restart |
| `PGBACKREST_REPO1_S3_KEY` / `_KEY_SECRET` | `pgbackrest.env` | IAM allows two keys: create, set, restart the `pgbackrest` and `db` services, confirm `pgbackrest check`, delete the old key |
| **`PGBACKREST_REPO1_CIPHER_PASS`** | `pgbackrest.env` | **NOT ROTATABLE in place.** It encrypts the backup repository; changing it makes every existing backup unreadable. It is generated on the host and exists nowhere else until somebody copies it — see [Escrow](#escrow-the-two-things-that-cannot-be-regenerated) |
| Mirror keys (`MIRROR_S3_ACCESS_KEY` / `_SECRET_KEY`) | `mirror.env` | Two keys, no cutover; restart `minio-mirror` |
| `FEEDBACK_JOB_SECRET`, `SETTLEMENT_JOB_SECRET`, `DEMO_JOB_SECRET` | `web.env` (the scheduler reads the same file) | Restart web and scheduler together; a scheduler holding the old value gets 404 from the job routes and `da-jobs-failed` fires |
| `DEMO_TOKEN_SECRET`, `REVIEW_TOKEN_SECRET` | `web.env` | Every demo-booking and review link already mailed stops working. Rotate only on exposure |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | GitHub environment secret (build time) | Pages open across the deploy that changes it must be reloaded once. Otherwise never needs rotating |
| WhatsApp (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`) | `web.env`, founder-held | Meta System User token: generate the new one, set, restart web. The app secret and verify token change in Meta's console at the same moment as here |
| `SES_ACCESS_KEY_ID` / `SES_SECRET_ACCESS_KEY` | `web.env`, `runner.env`, founder-held | Two keys per IAM user: create, set in both, restart both, then delete the old one |
| `EMAIL_API_KEY` (Resend, rollback only) | `web.env`, `runner.env` | Overlapping keys are allowed — create, deploy, revoke |
| Razorpay `key_secret` + `webhook_secret` | `web.env`, founder-held, not in use | Dual active webhook secrets during transition |
| `SENTRY_DSN` | all three | Not a credential in the strict sense; rotate at leisure |
| `ALERT_WEBHOOK_URL` | `/srv/platform/.env`, and as a GitHub secret for the workflows | Anybody holding it can post fake alerts. Replace in both places |
| `DEPLOY_SSH_KEY`, `DEPLOY_HOST_FINGERPRINT` | GitHub environment secrets | The deploy user is in the `docker` group, which is root on the host. Generate a new key pair, add the public half to the deploy user's `authorized_keys`, update the secret, run one deploy, remove the old public key |
| Session tokens | user browsers | Self-rotating per login; nothing to do |

Set a value with `sudo set-secret <environment> <KEY> <file.env>…`
(`ops/deploy/set-secret.sh`): it reads the value with hidden input and never
puts it on a command line. Restart the services that read the file afterwards.

**A role's password is changed in the DATABASE first.** `create-app-role.sql`
creates a role only if it is absent, so editing the password in an env file
alone changes nothing in Postgres — the service then fails to connect with the
new value. Always `alter role … password …` first, then the env file, then the
restart.

## Escrow: the two things that cannot be regenerated

Everything in the table above can be replaced except the backup passphrase, and
everything can be re-typed except the env files as a set. Both are created ON
the host by `init-env.sh`, and until they are copied off it, the only copy is
on the machine the backups exist to survive.

**If the host is lost and the passphrase with it, the off-box backups cannot be
decrypted. They are then not backups.**

Do this once, after the first production deploy, and again after any change to
an env file:

1. On the host, as root, make one encrypted archive of the environment's
   files. `age` or `gpg` both do; the passphrase you type here is the one you
   will need on the worst day, so it goes in a password manager too:

   ```sh
   cd /srv/apps/desiauction/production
   tar -czf - .env ./*.env | gpg --symmetric --cipher-algo AES256 \
     -o /root/desiauction-production-env-$(date +%F).tgz.gpg
   ```

2. Copy that file OFF the host, to two places that do not depend on each other
   or on this host (a password manager's secure file storage and an encrypted
   drive, for instance). Then remove it from the host:

   ```sh
   shred -u /root/desiauction-production-env-*.tgz.gpg
   ```

3. Separately, record `PGBACKREST_REPO1_CIPHER_PASS` by itself in the password
   manager. It is the one value that must survive even if the archive does not.

4. PROVE IT, on a machine that is not the host: decrypt the archive, read the
   passphrase out of `pgbackrest.env`, and confirm it matches what the password
   manager holds. An escrow nobody has opened is a hope.

5. Record the date in [PRODUCTION_CHECKLIST](PRODUCTION_CHECKLIST.md) §5. The
   restore drill ([RESTORE_RUNBOOK](RESTORE_RUNBOOK.md)) is the other half of
   the same proof: the passphrase decrypts a real backup.

## ENGINE_SECRET rotation (drilled)

Ticket validity is HMAC(secret, auctionId·time-window) with a two-window
grace for TIME, not for SECRET — rotation instantly invalidates every
outstanding spectator ticket and every web-tier command credential. Measured
drill (2026-07-16, local): engine restart downtime **1.29 s**; after rotation
the old secret is refused (401) on the first request, stale tickets are
refused at WS upgrade, fresh tickets accepted.

Procedure:

1. **Never rotate during a live auction window.** Spectator tickets die at
   rotation; clients must re-fetch (page reload). Run the same check the
   deploy runs first, and stop if it refuses:
   `docker compose --profile ops run --rm migrator live-window`.
2. Generate the new secret: `openssl rand -hex 32` (hex only — the env files
   are read by tools that do not all agree about `+`, `/` and `=`).
3. `sudo set-secret production ENGINE_SECRET web.env engine.env`.
4. Restart engine, then web, back to back:
   `docker compose up -d --no-deps --force-recreate engine && docker compose up -d --no-deps --force-recreate web scheduler`.
   In the gap web's old secret gets 401s — commands fail closed, nothing
   corrupts; the engine is the single writer and recovers all state from the
   event log.
5. Smoke, FROM INSIDE THE STACK. The engine refuses its private routes to
   anything that arrives through the public hostname (since 2026-09-29), so a
   `curl` against `https://engine.<domain>/snapshot/…` answers 404 whatever
   the secret and proves nothing:

   ```sh
   docker compose exec -T web /nodejs/bin/node -e "
     fetch('http://engine:4000/snapshot/none', { headers: { 'x-engine-secret': process.env.ENGINE_SECRET } })
       .then((r) => console.log(r.status))"
   ```

   404 means authenticated, unknown auction. 401 means web and engine
   disagree about the secret.
6. Spectators on open pages reconnect with fresh tickets on next page load.
   Anybody who was half-way through signing in asks for a new code.

## Database credential rotation

1. `alter role desiauction_app password '<new>'` (owner session:
   `docker compose exec db psql -U postgres -d desiauction`). Use `\password
   desiauction_app` instead if you would rather it not be in the session log.
2. Put the same password in the URL in the env file (`set-secret`, pasting the
   whole URL) and restart the service. Existing connections are unaffected
   until closed; new ones use the new password.
3. Repeat for `desiauction_system` (web), `desiauction_engine` (engine — a
   restart, so outside a live window) and `desiauction_runner` (runner).
4. `docker compose --profile ops run --rm migrator grants` — the grants are
   unchanged by a password, and this proves the four roles still connect.

## Razorpay webhook secret

Razorpay allows configuring the new secret on the dashboard while the old
remains active on in-flight deliveries; deploy the new secret first, then
switch the dashboard. A stale-signature webhook is refused 401 and Razorpay
retries — no event is lost (settlement webhook ingress is idempotent and
envelope-pinned).

## Email provider API key

**Amazon SES (the live provider).** The IAM user `desiauction-mailer` may hold
two access keys at once, so this rotates without a cutover: IAM → Users →
`desiauction-mailer` → Security credentials → Create access key; put the new
pair in BOTH `web.env` and `runner.env`; restart both; `pnpm --filter web
mail:test --to=<you>` on the host; then Deactivate the old key, wait a day for
anything still holding it to surface, and Delete it. Rotate every 90 days — the
key never expires on its own. See `docs/EMAIL_INFRASTRUCTURE.md`.

**Resend (the rollback).** Resend allows several live keys at once, so this rotates without a cutover:
create the new key (sending access, scoped to `mail.desiauction.in`), deploy
it, confirm one real send, then revoke the old one. Nothing to coordinate.

Two things that are NOT rotations and must not be treated as one. Revoking a
key does not stop mail failing closed and loud: with any of the three send
settings absent the mailer becomes `UnconfiguredMailer` and reports
`"unconfigured"`, so a botched rotation degrades to silence-with-a-signal
rather than to dropped mail. And the DKIM private keys live at the providers —
rotating those means regenerating a selector in the Zoho, SES or Resend console and
replacing the matching TXT record, which is a DNS change with propagation, not
a secret swap. See `docs/EMAIL_INFRASTRUCTURE.md`.

## Cadence

Quarterly, or immediately on suspicion of exposure. Every rotation appends a
row to the ops log (who, what, when, drill result).
