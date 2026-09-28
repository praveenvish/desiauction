-- WHEN IS AUCTION NIGHT? (email programme PR6)
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- The product held no time for the auction. `auctions.status = 'scheduled'`
-- means "created, not open yet" and says nothing about WHEN, and the auction
-- row only exists once the organizer presses "Create auction" — well after
-- registration, which is exactly when players and owners want the date. So the
-- time lives on the SEASON: set it whenever it is known, keep it through an
-- auction aborted and created again, and read it anywhere the season is read.
-- Every reminder, countdown and "the time changed" notice starts here.
--
-- A moment, not a wall-clock string: `timestamptz`, stored in UTC, entered and
-- shown in IST by the app. NULL is "not set yet" — every season today.
--
-- ADDITIVE: one nullable column, no default, no backfill, no new GRANT (a
-- column of a table the roles already read and write). The auction engine
-- never reads `competitions`, so nothing live can notice.

ALTER TABLE "competitions" ADD COLUMN "auction_starts_at" timestamp with time zone;
