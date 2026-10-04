-- AUCTION RESULTS ENTERED BY HAND (2026-10-04).
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- Plenty of leagues hold the auction in a hall with a whiteboard and only
-- want the app for the posters and team cards afterwards. The organiser places
-- each player on a team from the Teams tab, types the price if there was one,
-- and publishes. Publishing writes an ordinary REAL auction, already
-- completed — so every poster, card and public page reads it exactly as it
-- reads a night run in the app, and the roster locks like it does after one.
--
-- `registrations.offline_price` holds the typed price until then (×100, like
-- every price; NULL = none given). `auctions.entered_by_hand` marks the auction
-- so screens that replay the room know there was no room to replay.
--
-- ADDITIVE: nullable or defaulted, no backfill; no new GRANT is needed
-- (columns of existing tables the roles already read and write).
ALTER TABLE "registrations" ADD COLUMN "offline_price" bigint;
--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_offline_price_check"
  CHECK ("offline_price" IS NULL OR "offline_price" >= 0);
--> statement-breakpoint
ALTER TABLE "auctions" ADD COLUMN "entered_by_hand" boolean NOT NULL DEFAULT false;
