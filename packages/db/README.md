# @desiauction/db

The shared data layer (IP-2_DESIGN D1): Drizzle schema, SQL migrations, client factory. Consumed by `apps/web` and `apps/engine`; imports only `drizzle-orm`, `postgres`, `ulidx` (dep-cruiser enforced). Tenant tables carry `org_id` with RLS policies FORCEd in migrations (C-13).

**Tenant isolation is load-bearing at runtime.** Every tenant read and write in the web tier runs inside `withTenantDb`, which sets `app.person_id` / `app.org_id` for one transaction. The application connects as `desiauction_app` (NOBYPASSRLS), and `apps/web` refuses to boot if its role is SUPERUSER or BYPASSRLS. The RLS-exempt system pool is confined to the named pre-tenant paths listed in `ops/posture-allowlist.json`. `pnpm check:posture` fails CI on any new bypass. `grants:verify`, `rls:verify` and `posture:verify` prove the roles, the policies and the application under the production role recipe.

Migrations are forward-only in production (IP-0_DESIGN §20); see below for writing one.

## Adding a migration by hand (0019 onward)

The drizzle snapshot chain stops at 0018, so every migration since is written by
hand: a `NNNN_name.sql` file plus an entry in `migrations/meta/_journal.json`.

**The journal's `when` must be later than every migration the target database has
already applied.** The migrator runs only entries whose `when` exceeds the newest
`created_at` in `drizzle.__drizzle_migrations`. An entry stamped too early is
skipped, and `db:migrate` still prints "migrations applied". The journal uses
hand-spaced stamps one day apart that run ahead of real time, so a stamp from
`Date.now()` or `drizzle-kit generate` sorts before the head and is silently
ignored. Use the previous entry's `when` + `86400000`, then **verify the change
with a direct query** rather than trusting the success line.

**Branches share numbers; databases are shared too.** Two branches that each
append "the next" migration both pick the same number. The local database is
shared across worktrees, so whichever applies first owns that number's
timestamp, and the other's entry is skipped. Before adding one, read
`select id, created_at from drizzle.__drizzle_migrations order by created_at desc limit 5`
and number yours after anything a sibling branch has already applied. 0066 is
numbered past `fr1-feedback`'s 0064/0065 for this reason.
