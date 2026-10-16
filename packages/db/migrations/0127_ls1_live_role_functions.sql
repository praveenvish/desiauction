-- F07: apps/live is internet-facing, so it no longer reads tables at all. Its
-- role (desiauction_live, created by ops/db/create-app-role.sql) may only call
-- these two functions. Each applies P-1 itself — the same conditions as
-- `scoringPublicAccess` in packages/db/src/scoring-public.ts — and returns
-- nothing for a match the caller may not see. The delay rule stays in one
-- place (core's delayedHistoryIndex): the first call returns the ring's
-- timestamps, the second returns the one entry it releases.
CREATE FUNCTION live_snapshot(p_fixture_id char(26), p_slug text, p_token text)
RETURNS TABLE (state jsonb, stamps jsonb, trust text, rules jsonb, sport text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.state,
         (SELECT coalesce(jsonb_agg(h.e -> 'updatedAt' ORDER BY h.n), '[]'::jsonb)
            FROM jsonb_array_elements(s.history) WITH ORDINALITY AS h(e, n)),
         m.trust_level, c.scoring_rules, c.sport
    FROM fixtures f
    JOIN matches m ON m.fixture_id = f.id
    JOIN competitions c ON c.id = f.competition_id
    JOIN match_live_state s
      ON s.fixture_id = f.id AND s.org_id = f.org_id AND s.competition_id = f.competition_id
   WHERE f.id = p_fixture_id
     AND m.phase <> 'void'
     AND m.org_id = f.org_id
     AND m.competition_id = f.competition_id
     AND c.org_id = f.org_id
     AND (nullif(p_slug, '') IS NULL OR c.slug = p_slug)
     AND ((c.visibility = 'public' AND f.status IN ('published', 'in_progress', 'completed'))
          OR (nullif(p_token, '') IS NOT NULL AND m.share_token = p_token))
   LIMIT 1
$$;--> statement-breakpoint
CREATE FUNCTION live_history_entry(p_fixture_id char(26), p_slug text, p_token text, p_index int)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.history -> p_index
    FROM fixtures f
    JOIN matches m ON m.fixture_id = f.id
    JOIN competitions c ON c.id = f.competition_id
    JOIN match_live_state s
      ON s.fixture_id = f.id AND s.org_id = f.org_id AND s.competition_id = f.competition_id
   WHERE f.id = p_fixture_id
     AND m.phase <> 'void'
     AND m.org_id = f.org_id
     AND m.competition_id = f.competition_id
     AND c.org_id = f.org_id
     AND (nullif(p_slug, '') IS NULL OR c.slug = p_slug)
     AND ((c.visibility = 'public' AND f.status IN ('published', 'in_progress', 'completed'))
          OR (nullif(p_token, '') IS NOT NULL AND m.share_token = p_token))
   LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION live_snapshot(char, text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION live_history_entry(char, text, text, int) FROM PUBLIC;
