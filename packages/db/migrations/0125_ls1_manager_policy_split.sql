-- F09: a manager reads their own team_managers rows from any tenant context,
-- but writes only happen inside the club's tenant. The person arm becomes
-- SELECT-only (the team_entries_captain_read pattern, 0120).
DROP POLICY "team_managers_tenant" ON "team_managers";--> statement-breakpoint
CREATE POLICY "team_managers_tenant" ON "team_managers"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "team_managers_person_read" ON "team_managers" FOR SELECT
  USING (person_id = current_setting('app.person_id', true));--> statement-breakpoint
-- Who manages a team and who officiates a match is web-tier scoring data; the
-- auction engine and the finops runner never read it.
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['desiauction_engine','desiauction_runner'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON team_managers, fixture_officials FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
