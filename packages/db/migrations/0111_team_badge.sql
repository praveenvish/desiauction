-- TEAMS WITHOUT A LOGO (2026-10-08).
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- A team with no uploaded logo was drawn as its initials in a coloured circle,
-- with nine different rules for which initials. The founder asked for a
-- default team logo instead: a cricket-club shield in the team's colour, its
-- initials on it.
--
-- `team_badge` is the season's choice: 'shield' (the default — every season
-- gets the shield) or 'initials' (the old circle, for a club that preferred
-- it). It changes how a missing logo is drawn, never whether an uploaded one
-- shows.
ALTER TABLE "competitions"
  ADD COLUMN "team_badge" text NOT NULL DEFAULT 'shield';
--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_team_badge_check"
  CHECK ("team_badge" IN ('shield', 'initials'));
