-- MOVE A TOURNAMENT TO ANOTHER CLUB (2026-10-05).
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- A founder created a club, then wanted an existing tournament to live in it.
-- No runtime role can do that with an UPDATE: every org-scoped policy checks
-- the SAME predicate for USING and WITH CHECK (`org_id = app.org_id`), so under
-- the old club the new value is refused and under the new club the rows are
-- invisible — and five tables are append-only for every runtime role. The move
-- is therefore one SECURITY DEFINER function, owned by the migration owner
-- (a superuser in every deployment: docker's POSTGRES_USER), that:
--
--   * refuses unless its own role bypasses RLS — FORCE ROW LEVEL SECURITY
--     would otherwise turn every UPDATE below into a silent 0-row no-op;
--   * refuses unless app.person_id holds an unrevoked platform:superadmin
--     grant (the web tier ALSO gates on platform.grant + step-up; this is the
--     database's own check, since EXECUTE is the only thing standing between
--     the app credential and a cross-club rewrite);
--   * refuses while any auction of the moved seasons is live or paused — the
--     engine caches each auction's org (a scheduled one re-reads it per
--     command, see apps/engine engine-core `execute`);
--   * refuses when any settlement case exists for those seasons: the money
--     journal is ONE stream per org with a per-org total order and invoice
--     numbering, which cannot be split between clubs;
--   * moves the tournament and EVERY season under it (or one standalone
--     season), with everything that hangs off them, in one transaction;
--   * clears the two pointers into the old club's own furniture (a team's
--     franchise, a fixture's ground) rather than leave a cross-club link;
--   * makes the people who act on those seasons (season-scoped grants, team
--     grants, paddle holders) members of the new club, since season pages
--     gate on membership; their old memberships are untouched;
--   * writes one audit row into each club.
--
-- What stays behind on purpose: the old club's audit history (append-only
-- evidence), sent messages (rendered once, immutable), and media objects —
-- storage keys carry the old org in their path, and signed reads check only
-- the key's shape, so existing photos and logos keep working.
CREATE OR REPLACE FUNCTION "platform_move_tournament"(
  p_tournament_id char(26),
  p_competition_id char(26),
  p_target_org char(26),
  p_reason text,
  p_audit_out_id char(26),
  p_audit_in_id char(26)
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor char(26) := nullif(current_setting('app.person_id', true), '');
  v_source char(26);
  v_sources int;
  v_comps char(26)[];
  v_auctions char(26)[];
  v_teams char(26)[];
  v_subject text;
  v_counts jsonb;
  v_members int;
  v_rows int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'move_needs_rls_bypass' USING ERRCODE = 'P0001';
  END IF;

  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM grants
    WHERE person_id = v_actor AND scope_type = 'platform'
      AND capability_set = 'platform:superadmin' AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'move_not_superadmin' USING ERRCODE = 'P0001';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'move_reason_required' USING ERRCODE = 'P0001';
  END IF;

  IF (p_tournament_id IS NULL) = (p_competition_id IS NULL) THEN
    RAISE EXCEPTION 'move_one_subject' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_target_org) THEN
    RAISE EXCEPTION 'move_target_missing' USING ERRCODE = 'P0001';
  END IF;

  -- The seasons, locked, so an auction cannot be created or opened under us.
  IF p_tournament_id IS NOT NULL THEN
    PERFORM 1 FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'move_subject_missing' USING ERRCODE = 'P0001';
    END IF;
    SELECT coalesce(array_agg(id), '{}') INTO v_comps
      FROM (SELECT id FROM competitions WHERE tournament_id = p_tournament_id FOR UPDATE) c;
    SELECT org_id INTO v_source FROM tournaments WHERE id = p_tournament_id;
    v_subject := p_tournament_id;
  ELSE
    SELECT coalesce(array_agg(id), '{}') INTO v_comps
      FROM (SELECT id FROM competitions WHERE id = p_competition_id FOR UPDATE) c;
    IF cardinality(v_comps) = 0 THEN
      RAISE EXCEPTION 'move_subject_missing' USING ERRCODE = 'P0001';
    END IF;
    -- A season of a tournament moves with its tournament, never alone: the
    -- tournament row would be left pointing across clubs.
    IF EXISTS (SELECT 1 FROM competitions WHERE id = p_competition_id AND tournament_id IS NOT NULL) THEN
      RAISE EXCEPTION 'move_season_has_tournament' USING ERRCODE = 'P0001';
    END IF;
    SELECT org_id INTO v_source FROM competitions WHERE id = p_competition_id;
    v_subject := p_competition_id;
  END IF;

  -- Every season must sit in the same club as the tournament.
  SELECT count(DISTINCT org_id) INTO v_sources FROM competitions WHERE id = ANY (v_comps);
  IF v_sources > 1 OR EXISTS (SELECT 1 FROM competitions WHERE id = ANY (v_comps) AND org_id <> v_source) THEN
    RAISE EXCEPTION 'move_split_subject' USING ERRCODE = 'P0001';
  END IF;

  IF v_source = p_target_org THEN
    RAISE EXCEPTION 'move_same_club' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO v_auctions
    FROM (SELECT id FROM auctions WHERE competition_id = ANY (v_comps) FOR UPDATE) a;

  IF EXISTS (SELECT 1 FROM auctions WHERE id = ANY (v_auctions) AND status IN ('live', 'paused')) THEN
    RAISE EXCEPTION 'move_auction_running' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM settlement_cases
    WHERE competition_id = ANY (v_comps) OR auction_id = ANY (v_auctions)
  ) THEN
    RAISE EXCEPTION 'move_has_money' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO v_teams FROM teams WHERE competition_id = ANY (v_comps);

  -- Membership in the new club for the people who act on these seasons.
  WITH actors AS (
    SELECT person_id FROM grants
      WHERE revoked_at IS NULL AND scope_type = 'tournament' AND scope_id = ANY (v_comps)
    UNION
    SELECT person_id FROM grants
      WHERE revoked_at IS NULL AND scope_type = 'team' AND scope_id = ANY (v_teams)
    UNION
    SELECT person_id FROM paddle_grants WHERE auction_id = ANY (v_auctions)
  ), added AS (
    INSERT INTO org_members (org_id, person_id)
    SELECT p_target_org, person_id FROM actors WHERE person_id IS NOT NULL
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_members FROM added;

  -- Club-only players (no phone) belong to a club; re-point the ones who play
  -- nowhere else in the old club.
  UPDATE people p SET club_org_id = p_target_org
  WHERE p.club_org_id = v_source
    AND EXISTS (SELECT 1 FROM registrations r WHERE r.person_id = p.id AND r.competition_id = ANY (v_comps))
    AND NOT EXISTS (
      SELECT 1 FROM registrations r
      WHERE r.person_id = p.id AND r.org_id = v_source AND NOT (r.competition_id = ANY (v_comps))
    );

  -- The auction spine, deepest first (no FK forces an order; this mirrors purge-org).
  UPDATE auction_team_target_revisions SET org_id = p_target_org WHERE auction_id = ANY (v_auctions);
  UPDATE auction_team_targets SET org_id = p_target_org WHERE auction_id = ANY (v_auctions);
  UPDATE bids SET org_id = p_target_org WHERE auction_id = ANY (v_auctions);
  UPDATE lots SET org_id = p_target_org WHERE auction_id = ANY (v_auctions);
  UPDATE auction_events SET org_id = p_target_org WHERE auction_id = ANY (v_auctions);
  UPDATE paddle_grants SET org_id = p_target_org WHERE auction_id = ANY (v_auctions);
  UPDATE auction_owner_invites SET org_id = p_target_org WHERE auction_id = ANY (v_auctions);
  UPDATE paddles SET org_id = p_target_org WHERE auction_id = ANY (v_auctions);
  UPDATE feature_settings SET org_id = p_target_org
    WHERE scope_type = 'auction' AND scope_id = ANY (v_auctions);
  UPDATE auctions SET org_id = p_target_org WHERE id = ANY (v_auctions);

  -- Competition structure.
  UPDATE fixture_lineups SET org_id = p_target_org WHERE competition_id = ANY (v_comps);
  UPDATE fixture_participants SET org_id = p_target_org WHERE competition_id = ANY (v_comps);
  UPDATE fixture_results SET org_id = p_target_org WHERE competition_id = ANY (v_comps);
  UPDATE fixtures SET org_id = p_target_org, ground_id = NULL WHERE competition_id = ANY (v_comps);
  UPDATE pass_upgrade_requests SET org_id = p_target_org WHERE competition_id = ANY (v_comps);
  UPDATE org_import_mappings SET org_id = p_target_org WHERE competition_id = ANY (v_comps);
  UPDATE review_requests SET org_id = p_target_org WHERE competition_id = ANY (v_comps);
  UPDATE reviews SET org_id = p_target_org WHERE competition_id = ANY (v_comps);
  UPDATE registrations SET org_id = p_target_org WHERE competition_id = ANY (v_comps);
  UPDATE teams SET org_id = p_target_org, franchise_id = NULL WHERE competition_id = ANY (v_comps);
  UPDATE competitions SET org_id = p_target_org WHERE id = ANY (v_comps);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF p_tournament_id IS NOT NULL THEN
    UPDATE tournaments SET org_id = p_target_org WHERE id = p_tournament_id;
  END IF;

  v_counts := jsonb_build_object(
    'seasons', v_rows,
    'auctions', cardinality(v_auctions),
    'teams', cardinality(v_teams),
    'registrations', (SELECT count(*) FROM registrations WHERE competition_id = ANY (v_comps)),
    'membersAdded', v_members
  );

  INSERT INTO audit_log (id, actor, action, scope_type, scope_id, subject, meta) VALUES
    (p_audit_out_id, v_actor, 'org.tournament_moved_out', 'org', v_source, v_subject,
      jsonb_build_object('via', 'admin', 'reason', p_reason, 'to', p_target_org, 'seasons', to_jsonb(v_comps)) || v_counts),
    (p_audit_in_id, v_actor, 'org.tournament_moved_in', 'org', p_target_org, v_subject,
      jsonb_build_object('via', 'admin', 'reason', p_reason, 'from', v_source, 'seasons', to_jsonb(v_comps)) || v_counts);

  RETURN v_counts || jsonb_build_object('from', v_source, 'to', p_target_org);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "platform_move_tournament"(char, char, char, text, char, char) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'desiauction_app') THEN
    GRANT EXECUTE ON FUNCTION "platform_move_tournament"(char, char, char, text, char, char) TO desiauction_app;
  END IF;
END $$;
