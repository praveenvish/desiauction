-- RLS org isolation (IP-2_DESIGN D5, M-IP2-3): the database-layer lock.
-- The app layer scopes every query anyway; these policies make cross-tenant
-- leakage structurally impossible for any non-superuser connection role.
-- FORCE applies policies to the table owner too (the local owner is a
-- superuser, which always bypasses — the isolation proof tests therefore run
-- under a dedicated non-superuser role; production roles are non-BYPASSRLS).
-- current_setting(..., true) returns NULL when unset -> policies fail CLOSED.

ALTER TABLE "org_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_members_tenant ON "org_members"
  USING (
    org_id = current_setting('app.org_id', true)
    OR person_id = current_setting('app.person_id', true)
  );--> statement-breakpoint
ALTER TABLE "invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invites" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY invites_tenant ON "invites"
  USING (org_id = current_setting('app.org_id', true));--> statement-breakpoint
ALTER TABLE "grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "grants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY grants_tenant ON "grants"
  USING (
    person_id = current_setting('app.person_id', true)
    OR (scope_type = 'org' AND scope_id = current_setting('app.org_id', true))
  );--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY audit_tenant ON "audit_log"
  USING (
    (scope_type = 'org' AND scope_id = current_setting('app.org_id', true))
    OR (scope_type = 'person' AND scope_id = current_setting('app.person_id', true))
    OR actor = current_setting('app.person_id', true)
  );
