# @desiauction/db

The shared data layer (IP-2_DESIGN D1): Drizzle schema, SQL migrations, client factory. Consumed by `apps/web` and `apps/engine`; imports only `drizzle-orm`, `postgres`, `ulidx` (dep-cruiser enforced). Tenant tables carry `org_id` with RLS policies FORCEd in migrations (C-13); `withTenant` sets the per-request Postgres context. Migrations: `pnpm db:generate` → review SQL → `pnpm db:migrate`; forward-only in production (IP-0_DESIGN §20).
