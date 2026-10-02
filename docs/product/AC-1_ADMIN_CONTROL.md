# AC-1 — Admin control

Turn `/admin` from a read-only console into a small, safe control plane.
Linear project **AC-1 Admin control** (DES-19 … DES-25); one issue is one PR.

| # | Issue | What |
|---|---|---|
| 1.1 | DES-19 | Foundation: superadmin, step-up code, `server/platform-ops`, `job_runs`, posture template |
| 1.2 | DES-20 | People & roles: invite, grant/revoke, suspend, sign out everywhere |
| 1.3 | DES-21 | Club roles desk on `/admin/orgs/[slug]` |
| 1.4 | DES-22 | Today band, `/admin/system`, storage alerts |
| 1.5 | DES-23 | Cleanup jobs with dry runs (`/admin/jobs`) |
| 1.6 | DES-24 | Download centre (`/admin/exports`) |
| 1.7 | DES-25 | Linear wiring: Sentry, GitHub, Grafana |

This document details **1.1–1.3** (the roles work). 1.4–1.7 keep their
Linear descriptions until they are started.

## Principles

- **Few roles, plain words.** Superadmin ("can give and take admin roles"),
  Admin, Support, Billing, Privacy, Moderation, Demo desk — the existing six
  platform sets plus one.
- **Every risky act is confirmed, recorded and told.** A fresh code from the
  last 10 minutes, a row in the audit log with the reason, and an email to the
  person it happened to.
- **No passwords, no new sign-in path.** People sign in with the codes they
  already use; an invited person's role is simply waiting for them.
- **Tenant data is written as the tenant.** Club changes go through `inOrg` on
  the app role, never the bypass pool; only platform-scoped rows (platform
  grants, suspension) use the system role, through `server/platform-ops` only.

## 1.1 Foundation (DES-19)

1. **`platform:superadmin`**: capability `platform.grant` and nothing else.
   - It follows the platform's rule that every set is one power. Seeing the
     console is `platform:admin`'s, so the founder holds both.
   - Only `pnpm seed:admin --set platform:superadmin` can mint one.
   - The seed locks the live superadmin grants before counting them and
     refuses to revoke the last one.
   - The app can grant and revoke every other platform set, never superadmin.
2. **Step-up code.** `sessions.stepped_up_at`, set when a session is created
   from a code and when a step-up code is verified. Risky admin actions require
   `stepped_up_at` within 10 minutes; otherwise the screen opens **"Confirm
   it's you"**: a 6-digit code to the admin's own sign-in channel (verified
   email, else phone), entered once, good for 10 minutes. New code purpose
   `step_up` beside `login` / `phone_change`.
3. **`server/platform-ops`.** The one home for admin writers. Depcruise rule
   `admin-writes-only-through-platform-ops` replaces `admin-is-read-only`:
   `app/admin` and `server/admin` may not import any write module except
   through `server/platform-ops`; `platform-ops` itself may. Existing admin
   writers (moderation, passes, erasure, …) move in a follow-up, not here.
4. **`job_runs`.** `(id, job, started_at, finished_at, ok, detail jsonb)`. Each
   `/api/jobs/*` route records its run (the scheduler has no database). Read by
   1.4 and 1.5.
5. **Posture template.** `platform-ops.posture.test.ts`: every platform-ops
   writer runs under the production roles (`desiauction_app`,
   `desiauction_system`) and proves what each role can and cannot write.
6. **Role grants.** `desiauction_system` gains exactly: `insert` on
   `job_runs`; `update (suspended_at, suspended_reason, suspended_by)` on
   `people`; `update (revoked_at)` on `sessions`; `update (stepped_up_at)` on
   `sessions`. `grants:verify` pins the new list.

## 1.2 People & roles (DES-20)

`/admin/users` becomes **`/admin/people`** (old address redirects).

- **Find**: search by name, phone or email; filters *has a platform role*,
  *suspended*.
- **Invite person** (superadmin): phone or email, name, roles. Creates the
  person if new and grants the roles now; their first sign-in finds them
  waiting. An email says what they were given and where to sign in.
  Visible at once on `/admin/roles` — never a hidden, dormant grant.
- **Person page (360°)**: profile; clubs and their roles; platform roles;
  sessions and devices (last seen, browser); recent activity (audit); recent
  messages. Actions on the page:
  - **Grant / revoke a platform role** — superadmin only.
  - **Suspend / unsuspend** — with a reason. Suspending revokes every session
    and refuses sign-in ("This account is suspended. Contact support.").
    Never yourself, never a superadmin.
  - **Sign out everywhere.**
  Each: step-up, audit row with reason, email to the person.
- **`/admin/roles`**: who holds each platform role now, and the history
  (granted / revoked, by whom, when, why).

## 1.3 Club roles desk (DES-21)

A **Members** tab on `/admin/orgs/[slug]` so support can act for a club that
is stuck:

- **Add an owner** or **transfer ownership** (grant the new owner, then
  revoke the old one — the last-owner guard always holds).
- **Add staff.**
- **Assign / remove a season's auctioneer.**
- **Re-issue a team-owner link** (revokes the old one, mints a new one).

Each needs a written reason, step-up, and is recorded in the club's audit log.
Writes go through `inOrg(operator, org)` on the app role using the existing
org functions (`issueGrant`, `revokeGrants`, `assignAuctioneer`, …).
A person not yet in the club is added as a member first (by phone or email,
created if new), as an invite would.

## Security and scale (applies to 1.1–1.3)

**Who can do what**

- Each gate is checked on the server, per action, against the grant rows
  (`hasPlatformCapability`). A hidden button is never the control.
- A capability set that isn't on the list is denied (deny by default).
- **Superadmin**:
  - The app has no path that grants or revokes it.
  - Only the seed creates or revokes it. The seed locks the superadmin grant
    rows (`for update`) before counting them, so two revokes running at the
    same moment cannot leave zero.
- **Platform grants**:
  - Written only by `server/platform-ops` on the system role. The app role
    still cannot insert them (RLS `grants_tenant`, already proven in posture).
  - `platform-ops` is the only module allowed to import the system pool for
    writes (depcruise).

**Step-up**

- Bound to the **session** (`sessions.stepped_up_at`), not the person, so a
  second, stolen session does not inherit it.
- Codes are hashed with the existing code digest, single-use, limited to 5
  attempts, and rate-limited per person and per IP like sign-in codes.
- Purpose `step_up` cannot be used to sign in.
- A session created from a code counts as stepped up for its first 10
  minutes, so the admin is not asked twice right after signing in.

**Suspension**

- Enforced where every request resolves its session (`getSessionByToken`
  joins `people.suspended_at`). A suspended person's existing cookie stops
  working on the next request, not at expiry.
- New sign-ins are refused at every code-verify path: phone, email, passkey.
- Live auction sockets use short-lived tickets minted per page. Revoking the
  sessions stops new tickets; an open socket ends when its ticket window
  rolls over.
- A suspended person's grants are kept, so unsuspending restores them exactly.

**Evidence**

- Every action writes one append-only `audit_log` row with the actor, the
  target, the reason (required, 10–500 characters) and the step-up time.
- The person affected is told by email through the outbox (durable, retried),
  never a fire-and-forget send.
- Invite and grant emails never contain a sign-in link or code: "sign in at
  desiauction.in with this phone/email". This keeps a forwarded email
  harmless.

**Scale**

- `/admin/people` uses keyset pagination (50 per page).
- Name search uses a `pg_trgm` index on `people.name`; phone and email
  search use their existing unique indexes.
- `job_runs` is indexed on `(job, started_at desc)` and pruned by the 1.5
  cleanup job (90 days).
- Admin reads that span every club (directory, roles) stay on the system
  role's read-only SELECT. Writes to a club stay on the app role inside that
  club's boundary (`inOrg`).

**Proof**

- A posture test for each writer, under `desiauction_app` and
  `desiauction_system`. Each must show:
  - what it can write;
  - that the app role cannot write a platform grant or a suspension;
  - that a non-superadmin is refused even with a valid step-up.

## Done when

- 1.1: merged with format, depcruise, posture and the existing suites green.
- 1.2: e2e in both themes at 360 px, posture proof under production roles.
- 1.3: posture proof under production roles.
