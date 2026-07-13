# IDENTITY · OPERATIONAL RUNBOOKS

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · Permanent subsystem document (IP-2)

> Factual procedures for operating the identity subsystem. Local infrastructure is
> docker-compose PG17 (`localhost:5433`); production targets are the IP-0 founder
> externals (Neon Mumbai + Vercel) — **not yet provisioned** at IP-2 close.

## R-1 · Production database provisioning (roles + grants)

Migrations run as the database owner (`drizzle-kit migrate`). The **app role** must be
a separate, least-privilege login. This recipe is pinned by tests (AUDIT PROOF + RLS
PROOF in `authz.regression.test.ts` provision probe roles the same way):

```sql
CREATE ROLE app_web LOGIN PASSWORD '<platform-secret>' NOSUPERUSER NOBYPASSRLS;
GRANT SELECT, INSERT, UPDATE          ON people, sessions, otp_codes,
                                         passkey_credentials, grants, invites TO app_web;
GRANT DELETE                          ON passkey_credentials TO app_web;  -- removePasskey
GRANT SELECT, INSERT                  ON organizations, org_members TO app_web;
GRANT SELECT, INSERT                  ON audit_log TO app_web;            -- APPEND-ONLY: never UPDATE/DELETE
-- otp_inbox: NO grant in production (dev-only delivery table)
```

**Invariants:** `NOBYPASSRLS` always (D5) · `audit_log` gets SELECT + INSERT and
nothing else, ever (D8) · no DDL. **Pre-deploy work item (recorded at IP-2 close):**
org-scoped queries must be routed through `withTenant()` before this role goes live —
FORCE'd RLS policies fail closed for it ([AUTHORIZATION.md](AUTHORIZATION.md) §5).

## R-2 · Migrations

`pnpm --filter @desiauction/db db:generate` (from `schema.ts`) →
`pnpm --filter @desiauction/db db:migrate`. Migrations are append-only files in
`packages/db/migrations/`; every CI run re-applies them against a fresh service
container, and re-applying against an existing DB is a proven no-op (idempotence,
re-verified at M-IP2-4). Never edit an applied migration; add the next one.
No migration while an auction is LIVE (C-22 — enforcement arrives IP-7).

## R-3 · RC-1: swapping in the real OTP provider

1. Implement `OtpSender` (`apps/web/src/server/auth/otp-sender.ts`) for the procured
   provider (send only; no read path).
2. Replace the single construction point — `const sender = new DevInboxSender(db)` in
   `auth/actions.ts` — with an env-selected sender; keep `DevInboxSender` for
   development.
3. Nothing else changes (D3). Re-run the security regression + login e2e suites;
   they must pass untouched.
4. Until this lands, **production login is undeliverable by design** — codes would be
   written to `otp_inbox` with no reader (`/dev/inbox` 404s in production). Do not
   open production signup before RC-1.

## R-4 · Incident: suspected session-token theft

Sessions are server-revocable instantly ([SESSIONS.md](SESSIONS.md)). For one person
(by phone, E.164):

```sql
UPDATE sessions SET revoked_at = now()
WHERE person_id = (SELECT id FROM people WHERE phone = '+91XXXXXXXXXX')
  AND revoked_at IS NULL;
```

The person logs in again via OTP/passkey. Review their trail:

```sql
SELECT action, at, meta FROM audit_log
WHERE actor = (SELECT id FROM people WHERE phone = '+91XXXXXXXXXX')
ORDER BY at DESC LIMIT 50;
```

Platform-wide compromise (e.g. leaked DB snapshot — note: snapshots hold only token
_hashes_): `UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL;` — every
user re-authenticates; nothing else rotates.

## R-5 · Incident: suspected passkey compromise

Self-service: account page → remove passkey (hard delete, audited). Operator:

```sql
DELETE FROM passkey_credentials WHERE credential_id = '<id>';
```

Then R-4 (revoke sessions) — removal kills future logins, not the live session.

## R-6 · OTP data hygiene (manual until a purge job ships)

No automated purge exists (recorded in the [DPDP inventory](DPDP_DATA_INVENTORY.md)).
Codes are dead ≤ 5 minutes after issue regardless; hygiene is about data minimization:

```sql
DELETE FROM otp_codes WHERE created_at < now() - interval '24 hours';
DELETE FROM otp_inbox WHERE created_at < now() - interval '24 hours';  -- dev only
```

Safe any time — verification only ever reads the latest unconsumed code, and both
rate-limit windows are 1 hour.

## R-7 · WebAuthn environment (per environment)

| Env        | `RP_ID`                  | `RP_ORIGINS`                                  |
| ---------- | ------------------------ | ---------------------------------------------- |
| local/e2e  | `localhost` (default)    | `http://localhost:3000,http://localhost:3050` (default) |
| staging    | staging host (e.g. `staging.desiauction.in`) | `https://<staging host>`       |
| production | apex (e.g. `desiauction.in`) | `https://<apex>` (+ `https://www.<apex>` if served) |

Rules: `RP_ID` must suffix-match the browser host; origins are full URLs; both are
validated fail-closed at boot (`env.ts`). **Changing `RP_ID` orphans every enrolled
passkey** — treat as a migration event, never a casual edit.

## R-8 · Support: "my code doesn't work"

In order: wrong/expired code (5-min TTL) → 5 wrong attempts killed the code (a fresh
code fixes it; lockout leaves an `auth.otp.lockout` event) → resend inside 30 s
cooldown → > 5 codes in the hour (wait) → invalid number shape (must be Indian
mobile). The verify response is deliberately generic — diagnose from the DB/audit
side, never by relaxing the response.

## R-9 · Dev OTP inbox

Development only: `/dev/inbox?phone=+91…` renders the latest 100 codes from
`otp_inbox` (`?phone` filters server-side; e2e suites depend on it). The route 404s
whenever `NODE_ENV !== "development"` — proven against a real production server at
M-IP2-4. Production DBs must not grant `otp_inbox` at all (R-1).
