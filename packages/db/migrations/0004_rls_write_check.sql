-- RLS write-side lock (RC-4 Finding 1, BLOCKING-before-freeze).
-- 0003 created FOR ALL policies with USING only. PostgreSQL then reuses USING
-- as WITH CHECK for INSERT/UPDATE, and every USING carries a self-row disjunct
-- (person_id/actor = app.person_id) for legitimate cross-org SELF-READS. On the
-- WRITE side that disjunct is an escape hatch: a non-superuser role could set
-- app.person_id = self and INSERT a grant giving itself org:owner on ANY
-- scope_id (confirmed under the R-1 role recipe). These explicit WITH CHECK
-- clauses constrain every write to the ACTIVE tenant — no self-row escape —
-- while leaving the read USING clauses (proven correct by the RLS PROOF)
-- untouched. Invariant enforced: you may only write rows scoped to your active
-- org, and audit rows only as yourself.

ALTER POLICY org_members_tenant ON "org_members"
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER POLICY invites_tenant ON "invites"
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER POLICY grants_tenant ON "grants"
  WITH CHECK (
    scope_type = 'org' AND scope_id = current_setting('app.org_id', true)
  );--> statement-breakpoint

ALTER POLICY audit_tenant ON "audit_log"
  WITH CHECK (
    (
      scope_type = 'org'
      AND scope_id = current_setting('app.org_id', true)
      AND actor = current_setting('app.person_id', true)
    )
    OR (
      scope_type = 'person'
      AND scope_id = current_setting('app.person_id', true)
      AND actor = current_setting('app.person_id', true)
    )
  );
