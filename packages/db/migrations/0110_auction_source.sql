-- WHERE A SEASON'S AUCTION HAPPENS: IN THE APP, OR SOMEWHERE ELSE (2026-10-05).
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- Many leagues hold the auction on paper or in another tool and only want the
-- squads here. Hand entry on the Teams tab already records those results, but
-- nothing said the season was an import until "Publish" wrote a completed
-- auction (`auctions.entered_by_hand`). Until then the public squad pages
-- treated every typed-in player as an unfinished draft and showed only the
-- captain and icon.
--
-- `imported` is the organizer's declaration up front: the public pages show
-- placed players (with their typed price) straight away, and the season never
-- creates an in-app auction. Fixed once a non-aborted real auction exists —
-- the application refuses the change; there is no path that writes it after.
--
-- ADDITIVE AND BACKWARDS COMPATIBLE: every existing season ran (or will run)
-- its auction in the app, which the DEFAULT states; no new GRANT is needed
-- (column of an existing table the roles already read and write).

ALTER TABLE "competitions"
  ADD COLUMN "auction_source" text NOT NULL DEFAULT 'app';--> statement-breakpoint

ALTER TABLE "competitions" ADD CONSTRAINT "competitions_auction_source_check"
  CHECK ("auction_source" IN ('app', 'imported'));--> statement-breakpoint

COMMENT ON COLUMN "competitions"."auction_source" IS
  'Where the auction happens: app (run live here) | imported (held elsewhere, results typed in on the Teams tab). Fixed once a non-aborted real auction exists.';
