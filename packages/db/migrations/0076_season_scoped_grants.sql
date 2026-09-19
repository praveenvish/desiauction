-- SEASON-SCOPED GRANTS — the auctioneer (launch polish, Phase 3).
--
-- The grant model has always allowed a competition scope (scope_type
-- 'tournament', scope_id = competitions.id — canCompetition ORs it with the org
-- scope), but no code ever issued one, and this policy made it impossible: the
-- WITH CHECK only admitted scope_type = 'org'. The founder asked for an
-- auctioneer who is not the club's owner, for ONE season.
--
-- Widened by exactly one arm, the same on both sides: a 'tournament' scope is
-- readable and writable when that competition belongs to the ACTIVE org. The
-- competitions subquery runs under competitions' own org-arm policy, so another
-- club's season can neither be named nor matched. The person-arm self-read and
-- the org arm are unchanged; issuing still requires grant.issue in app code.
ALTER POLICY grants_tenant ON "grants"
  USING (
    person_id = current_setting('app.person_id', true)
    OR (scope_type = 'org' AND scope_id = current_setting('app.org_id', true))
    OR (
      scope_type = 'tournament'
      AND scope_id IN (
        SELECT id FROM competitions WHERE org_id = current_setting('app.org_id', true)
      )
    )
  )
  WITH CHECK (
    (scope_type = 'org' AND scope_id = current_setting('app.org_id', true))
    OR (
      scope_type = 'tournament'
      AND scope_id IN (
        SELECT id FROM competitions WHERE org_id = current_setting('app.org_id', true)
      )
    )
  );
