# IDENTITY · AUTHORIZATION & TENANCY ARCHITECTURE

## DesiAuction NEXT · v1.0 · 2026-07-14 · CTO · Permanent subsystem document (IP-2)

> Documents the **implemented** system, frozen at IP-2. Source of truth:
> `packages/core/src/capabilities.ts` (pure engine),
> `apps/web/src/server/orgs/{authz,orgs,invites,actions}.ts`,
> `packages/db/migrations/0003_rls_org_isolation.sql`, `packages/db/src/index.ts`.
> Governed by C-8 (grants, not roles), C-13 (org_id + RLS defense-in-depth),
> IP-2_DESIGN D5/D6/D9.

## 1 · Grants, not roles (C-8)

A **Grant** = `(person, scope, capability set)` with `granted_by`, `created_at`,
`revoked_at`. Named sets are **ergonomics only** — business code asks about
capabilities, never set names, and never "is this an admin?".

| Set         | Capabilities                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| `org:owner` | `org.manage` `org.members.invite` `org.members.remove` `grant.issue` `grant.revoke` `tournament.create` `tournament.manage` `player.verify` `auction.conduct` |
| `org:staff` | `tournament.manage` `player.verify`                                                                                        |
| `viewer`    | ∅                                                                                                                          |

**Fail-closed rules** (pure, unit-tested in `core`): unknown sets expand to **nothing**;
revoked grants confer **nothing**; scope must match **exactly** — no cross-org, no
cross-type bleed, and no hierarchy (org grants do not imply tournament access; scope
hierarchy arrives with IP-3 as an explicit rule in `capabilities.ts`, never ad hoc in
callers). Scope types `org | tournament | team` exist now; only `org` scopes are
issued in IP-2 — the machinery already supports IP-3's entities.

## 2 · Enforcement (`orgs/authz.ts`)

`requireCapability(db, personId, scope, capability)` fetches the person's grants and
evaluates with core's pure `hasCapability`; failure throws `ForbiddenError`. `can()`
is the boolean twin for view assembly. **Every org-scoped server action follows one
path and no other exists** (D7):

```
requireSession → resolveTenant(slug, membership) → requireCapability → act → audit row
```

Membership (`org_members`) records **belonging**; grants record **permission** — the
two are deliberately separate. Removing a grant leaves membership (and vice versa);
capability loss is effective on the **next check** — no session state caches
permissions.

## 3 · Tenant resolution (`orgs/orgs.ts`)

URL slug → org, **membership required**, in a single joined query. Non-members and
unknown slugs are indistinguishable — both yield `null` → the page 404s (never 403;
org existence is not disclosed). Slugs are `slugify(name) + ULID-suffix` — unique
without a retry loop, not enumerable in practice.

## 4 · Invites (D9, RC-3)

Shareable single-use links — **the platform sends nothing**; the organizer forwards
the URL over their own channel. Token: 24 random bytes base64url, stored **SHA-256
only**, 7-day expiry, revocable. Creation requires `org.members.invite` and a
**valid capability set** (unknown sets refused at creation — nothing mints an
unexpandable grant). Acceptance requires a session (login gate carries `?next=`),
then: **atomic one-time claim** (`UPDATE … WHERE accepted_at IS NULL AND revoked_at IS
NULL` — only one accept can win), membership upsert, grant issuance, audit row.
Expired, revoked, replayed, and unknown tokens are indistinguishable failures.

## 5 · Row-Level Security — the second lock (D5, C-13)

The app layer scopes every query; RLS makes cross-tenant leakage **structurally
impossible for any non-superuser role**. Migration `0003`: `ENABLE` + `FORCE ROW LEVEL
SECURITY` on the four org-scoped tables with policies keyed to
`current_setting('app.person_id'|'app.org_id', true)` — `true` returns NULL when
unset, so **policies fail closed** (zero rows, no error):

| Table         | Policy (USING)                                                              |
| ------------- | ---------------------------------------------------------------------------- |
| `org_members` | `org_id = app.org_id OR person_id = app.person_id`                            |
| `invites`     | `org_id = app.org_id`                                                         |
| `grants`      | `person_id = app.person_id OR (scope_type='org' AND scope_id = app.org_id)`   |
| `audit_log`   | org rows by `app.org_id` · person rows by `app.person_id` · own-actor rows    |

`withTenant()` (`packages/db/src/index.ts`) is the tenant-context primitive: a
transaction with `SET LOCAL app.person_id / app.org_id`.

**Recorded production fact:** the web app's queries do **not** yet run through
`withTenant()` — locally the connection role is the Docker superuser, which PostgreSQL
exempts from policies, so the app works while the **proof tests** run under a
dedicated non-superuser role that mirrors production. Under a production
non-BYPASSRLS role the FORCE'd policies fail closed (empty reads — breakage, not
leakage). **Routing org-scoped queries through tenant context is a named pre-deploy
work item** (first production deploy, IP-3/IP-4) — see RUNBOOKS R-1 and the closure
report. Person-scoped tables (`people`, `sessions`, `otp_codes`,
`passkey_credentials`) deliberately carry no policies: authentication runs
pre-identity ([SESSIONS.md](SESSIONS.md) §4).

## 6 · Audit substrate (D8)

Append-only `audit_log(actor, action, scope_type, scope_id, subject, meta, at)` —
one ledger for org actions (`org.created`, `grant.issued/revoked`,
`invite.created/accepted/revoked`) and person security events
([AUTHENTICATION.md](AUTHENTICATION.md) §7). Immutability is a **tested fact**: a role
provisioned per the production grant recipe (SELECT + INSERT only, RUNBOOKS R-1)
gets `permission denied` on UPDATE and DELETE at the SQL layer (AUDIT PROOF,
`authz.regression.test.ts`). Hash-chaining remains cut per the 0A ruling; external
anchoring is post-GA.

## 7 · Protecting tests

Unit (`capabilities.test.ts`, 8): set expansion, fail-closed unknown sets, revocation,
exact-scope, empty grants. Authz regression (11, real PG): owner-on-create, tenant
indistinguishability, cross-tenant Forbidden, invite lifecycle + replay, staff
non-escalation, expired/revoked invites, unknown-set refusal, immediate revocation,
**AUDIT PROOF**, **RLS PROOF** (non-superuser probe: cross-tenant zero rows; no
context → zero rows). E2E `orgs.spec.ts`: the house journey — create, invite, accept,
assign, revoke, replay-dead, and **A cannot reach B's org (404)** in real browsers.
