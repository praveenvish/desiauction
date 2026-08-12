-- WHO WON.
--
-- HAND-AUTHORED, like 0022–0025 (the drizzle snapshots stop at 0018).
--
-- A fixture could be scheduled, published, started and marked `completed`, and
-- the product recorded NOTHING about how it went. Not a score, not a winner —
-- `fixtures` carries a status and four timestamps and stops. A club could run a
-- whole tournament through this platform and, at the end of it, nothing here
-- could say who had won a single match.
--
-- Everything a league table shows is derived from this table. There is no
-- points column and no standings table on purpose: a stored table drifts from
-- the results beneath it the first time somebody amends a scorecard, and a
-- derived one cannot.
--
-- OVERS ARE STORED AS BALLS. This is the single most common cricket data bug:
-- 4.5 overs is four overs and five balls, not 4.5 of anything, and net run rate
-- computed on the decimal is silently wrong all season. An integer count of
-- balls has none of that, and the display converts back at the edge.
CREATE TABLE "fixture_results" (
  "fixture_id" char(26) PRIMARY KEY NOT NULL,
  "org_id" char(26) NOT NULL,
  "competition_id" char(26) NOT NULL,
  -- The outcome as cricket means it. `no_result` and `abandoned` are DISTINCT:
  -- a washed-out match that started is a no-result and shares the points; one
  -- that never started is abandoned. Leagues treat them differently and a
  -- single "cancelled" would make the table wrong.
  "outcome" text NOT NULL,
  "winner_team_id" char(26),
  "home_runs" integer,
  "home_wickets" integer,
  "home_balls" integer,
  "away_runs" integer,
  "away_wickets" integer,
  "away_balls" integer,
  -- "DLS", "super over", "conceded" — how the result was arrived at, when it
  -- was not simply the higher score.
  "method" text,
  "note" text,
  "recorded_by" char(26) NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX "fixture_results_competition_idx" ON "fixture_results" ("competition_id");--> statement-breakpoint

ALTER TABLE "fixture_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fixture_results" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY fixture_results_tenant ON "fixture_results"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));
