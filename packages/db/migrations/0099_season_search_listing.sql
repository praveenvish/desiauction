-- SEASON PAGES IN SEARCH (SEO-1 Phase 5, 2026-10-01).
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- 1. `list_squads_in_search` — the organizer's opt-in to let search engines
--    index a published season's team squad pages. Off by default, and an
--    opt-in only: the web app still refuses to index squads while ANY approved
--    registration in the season lacks a date of birth that proves the player
--    is an adult (server/seo/squads.ts). A child's name is never offered to a
--    search engine because a switch was on.
--
-- 2. `updated_at` — when the season's own row last changed, for the sitemap's
--    lastmod. Set by a trigger rather than by each writer: a season is written
--    by the details editor, the lifecycle, publishing, the auction clock, the
--    import sheet and the platform hold, and a column that one of them forgot
--    to touch would claim a page had not changed when it had. Backfilled from
--    created_at, which is the last change we can honestly vouch for.

ALTER TABLE "competitions"
  ADD COLUMN "list_squads_in_search" boolean NOT NULL DEFAULT false;

ALTER TABLE "competitions"
  ADD COLUMN "updated_at" timestamp with time zone NOT NULL DEFAULT now();

UPDATE "competitions" SET "updated_at" = "created_at";

CREATE OR REPLACE FUNCTION "competitions_touch_updated_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."updated_at" := now();
  RETURN NEW;
END;
$$;

-- Only a real change moves the date: an UPDATE that rewrites a row with the
-- values it already had is not news to a crawler.
CREATE TRIGGER "competitions_touch_updated_at"
  BEFORE UPDATE ON "competitions"
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION "competitions_touch_updated_at"();
