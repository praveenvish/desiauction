-- MOVE ONE SEASON OUT OF ITS TOURNAMENT (2026-10-05).
--
-- HAND-AUTHORED, like 0019 onward.
--
-- 0108 moved a tournament with every edition, and refused a single season of
-- one. The first real move wanted exactly that: BPL-4 to a new club, BPL-1..3
-- staying where they were played. Now a season of a tournament moves alone:
-- the tournament row and its other editions stay in the old club, and the
-- season joins the tournament of the same name and sport in the new club —
-- created there (id and slug from the app, like every tournament) when the
-- new club has none. Everything else is 0108 unchanged: the same checks, the
-- same rows moved, the same audit rows (which now name the tournament).
--
-- The signature grows two arguments, so the old function is dropped and the
-- grant re-made (ops/db/create-app-role.sql names the new signature).
DROP FUNCTION IF EXISTS "platform_move_tournament"(char, char, char, text, char, char);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "platform_move_tournament"(
  p_tournament_id char(26),
  p_competition_id char(26),
  p_target_org char(26),
  p_reason text,
  p_audit_out_id char(26),
  p_audit_in_id char(26),
  p_new_tournament_id char(26),
  p_new_tournament_slug text
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
  v_src_tournament char(26);
  v_target_tournament char(26);
  v_tournament_created boolean := false;
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
    -- A season of a tournament may move alone (0109): its tournament and the
    -- other editions stay, and the season joins the same-named tournament in
    -- the new club, created there if it has none — never a link across clubs.
    SELECT org_id, tournament_id INTO v_source, v_src_tournament
      FROM competitions WHERE id = p_competition_id;
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

  IF v_src_tournament IS NOT NULL THEN
    SELECT t.id INTO v_target_tournament
      FROM tournaments t, tournaments s
      WHERE s.id = v_src_tournament AND t.org_id = p_target_org
        AND t.sport = s.sport AND lower(btrim(t.name)) = lower(btrim(s.name))
      ORDER BY t.created_at
      LIMIT 1;
    IF v_target_tournament IS NULL THEN
      IF p_new_tournament_id IS NULL OR p_new_tournament_slug IS NULL THEN
        RAISE EXCEPTION 'move_needs_tournament_id' USING ERRCODE = 'P0001';
      END IF;
      INSERT INTO tournaments (id, org_id, sport, name, slug, created_by)
        SELECT p_new_tournament_id, p_target_org, sport, name, p_new_tournament_slug, v_actor
        FROM tournaments WHERE id = v_src_tournament;
      v_target_tournament := p_new_tournament_id;
      v_tournament_created := true;
    END IF;
    UPDATE competitions SET tournament_id = v_target_tournament WHERE id = p_competition_id;
  END IF;

  v_counts := jsonb_build_object(
    'seasons', v_rows,
    'auctions', cardinality(v_auctions),
    'teams', cardinality(v_teams),
    'registrations', (SELECT count(*) FROM registrations WHERE competition_id = ANY (v_comps)),
    'membersAdded', v_members,
    'tournamentCreated', v_tournament_created
  );

  INSERT INTO audit_log (id, actor, action, scope_type, scope_id, subject, meta) VALUES
    (p_audit_out_id, v_actor, 'org.tournament_moved_out', 'org', v_source, v_subject,
      jsonb_build_object('via', 'admin', 'reason', p_reason, 'to', p_target_org, 'seasons', to_jsonb(v_comps),
        'tournament', v_src_tournament) || v_counts),
    (p_audit_in_id, v_actor, 'org.tournament_moved_in', 'org', p_target_org, v_subject,
      jsonb_build_object('via', 'admin', 'reason', p_reason, 'from', v_source, 'seasons', to_jsonb(v_comps),
        'tournament', coalesce(v_target_tournament, p_tournament_id)) || v_counts);

  RETURN v_counts || jsonb_build_object('from', v_source, 'to', p_target_org);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "platform_move_tournament"(char, char, char, text, char, char, char, text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'desiauction_app') THEN
    GRANT EXECUTE ON FUNCTION "platform_move_tournament"(char, char, char, text, char, char, char, text) TO desiauction_app;
  END IF;
END $$;
