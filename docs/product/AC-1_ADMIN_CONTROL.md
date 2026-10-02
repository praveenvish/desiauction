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

## 1.2 People & roles (DES-20) — built

`/admin/users` becomes **`/admin/people`**. The old address redirects, with
its query, in `next.config.mjs`.

- **Find**: search by name, phone or email. Filters: *Admin roles* and
  *Suspended*. Rows show a red **Suspended** badge.
- **Invite person** (superadmin): phone or email, name, roles and a reason.
  - Someone already on DesiAuction with that **verified** contact gets the
    roles at once.
  - Anyone else gets a **waiting invitation** (`platform_invites`, 14 days)
    that turns into grants the moment that phone or email is **proven** at
    sign-in (`applyPlatformInvites`, called where every session is made).
  - Nothing is ever created on someone's behalf, and no role sits on an
    unproven contact. Email sign-in refuses an unverified, pre-claimed
    address, which is why a pre-made account would have locked the invitee
    out.
- **Person page**: profile, an **Account** card, then clubs and roles,
  seasons and activity.
  - The Account card shows open or suspended (by whom, when, why), the
    signed-in devices, and the last emails sent.
  - Superadmin controls on that card: **Give a role**, **Remove** (each held
    role), **Sign out everywhere**, **Suspend** / **Lift suspension**.
  - Each control asks for a reason, then "Confirm it's you" if the session
    needs it.
- **`/admin/roles`** (superadmin): each role's holders, waiting invitations,
  and the last 100 changes.
- **Rules**:
  - Never suspend yourself or a superadmin.
  - Superadmin is neither grantable nor revocable in the app.
  - Suspension keeps grants, so lifting it restores the account exactly.
    Lifting does not wake old devices.
- **Enforcement**:
  - `getSessionByToken` joins `people.suspended_at`, so a suspended cookie
    stops on its next request.
  - Phone, email and passkey sign-in refuse a suspended account
    (`auth.login.refused_suspended`).
- **Telling people**: the `security.admin_action` email (six variants,
  English and Hindi, with the reason) is sent after the response.
  - It goes through the notification gate and is recorded in `email_sends`.
  - It never contains a link or a code.
  - A person with no verified email is not mailed. The audit row and their
    next visit carry it.
- **Which database role writes what**:
  - `people`, `sessions` and `platform_invites` have no RLS, and the web tier
    already writes them on **`desiauction_app`** (app-layer scoping, behind
    `operatorFor`). Suspension and sign-out-everywhere use that role, so the
    BYPASSRLS system role gains **no** access to `people` or `sessions`.
  - Platform grants are written on **`desiauction_system`**, the only role
    RLS lets write one. It gained exactly `update (revoked_at) on grants`.
    That also fixes `seed:admin --revoke`, which only ever worked locally as
    the owner.
  - `grants:verify` pins this at column level.
- **Search**: a plain `ilike`, keyset-paginated at 50, which is adequate for
  an admin tool at today's size. Add a `pg_trgm` index if people grow past
  ~100k.
- **Proof**: `people-admin.posture.test.ts` drives every action under the
  production roles.

## 1.3 Club roles desk (DES-21) — built

A **Club roles desk** card on `/admin/orgs/[slug]`, for a superadmin
(`platform.grant`). Making someone a club's owner hands them its money, so
this is not every support operator's desk.

- **Add an owner or staff**:
  - Someone already signed in becomes a member and holds the role now.
  - Anyone else gets the club's own invitation link for that role (7 days).
    Support copies and sends it.
- **Remove** a role. The last owner is never removed (`lastOwnerRefuses`).
- **Transfer ownership** in one transaction: the new owner is added and the
  old one steps down, so the club is never without an owner. The new owner
  must have signed in once.
- **Assign or remove** a season's auctioneer. The club's own rules apply:
  the person must be a member, and must not own a team.
- **New team-owner link**:
  - Every unused link for the team is withdrawn and a fresh one minted, both
    through the auction engine (its single writer).
  - Refused when the team's owner has already joined.

Every act needs a reason and step-up, and adds an `admin.club.*` row with
`via: admin` and the reason to the club's own audit log. Writes use the
club's own functions inside its boundary on `desiauction_app` (`inOrg`),
never the system pool. RLS accepts them for a club the superadmin does not
belong to; `club-desk.posture.test.ts` proves this and the club's rules
under the production roles.

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
  target and the reason (required, 10–500 characters).
- The person affected is told by email after the response, the same way every
  security alert is sent:
  - through the notification gate;
  - every attempt and its outcome recorded in `email_sends`;
  - a failed send never undoes the change.
- Invite and grant emails never contain a sign-in link or code: "sign in at
  desiauction.in with this phone/email". This keeps a forwarded email
  harmless.

**Scale**

- `/admin/people` uses keyset pagination (50 per page).
- Name search is a plain `ilike` (adequate at today's size). Add a
  `pg_trgm` index past ~100k people. Phone and email search use their
  existing unique indexes.
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
