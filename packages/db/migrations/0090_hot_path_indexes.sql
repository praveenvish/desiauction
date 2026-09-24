-- TWO READS ON THE PAGE-LOAD PATH HAD NO INDEX THAT FITS (page-load audit).
--
-- owner_invites_accepted_by_idx — `rolesOf` (apps/web server/roles) asks
-- "which teams has this person accepted an owner invite for?" on EVERY
-- signed-in render: the root layout builds the menu from it. The only index
-- naming `accepted_by` is (auction_id, team_id, accepted_by) from 0044, which
-- a lookup by person alone cannot use — so the query was a sequential scan of
-- every invite ever sent, growing with each auction on the platform.
--
-- auction_events_auction_at_idx — the public directory's "is this season live
-- right now?" test takes max(at_ms) per auction, on every render of / and /c.
-- With only (auction_id) it read every event of each auction to find the
-- newest; (auction_id, at_ms) answers it from the end of one index range.
--
-- NOT CONCURRENTLY, as in 0083/0089: the migrator runs in one transaction, and
-- both tables are small at launch. IF NOT EXISTS lets a hand-built CONCURRENTLY
-- index on a large table turn these into no-ops.
CREATE INDEX IF NOT EXISTS "owner_invites_accepted_by_idx"
  ON "auction_owner_invites" ("accepted_by");
CREATE INDEX IF NOT EXISTS "auction_events_auction_at_idx"
  ON "auction_events" ("auction_id", "at_ms");
