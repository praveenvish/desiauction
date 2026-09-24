-- WHAT A SEASON'S AUCTION COUNTS IN: RUPEES OR POINTS.
--
-- Some leagues run the auction on points — a budget of 1,000 per team, no real
-- money changing hands. Until now every amount was read as paise and printed
-- as rupees, and a completed auction invited the organizer to "settle the
-- money", which for a points league is a debt that does not exist.
--
-- THE STORAGE SCALE DOES NOT CHANGE. Amounts stay integers ×100 of the shown
-- unit — 1 point is stored as 100, exactly as ₹1 is 100 paise — so lots,
-- bids, purses and the engine's event log mean the same thing in both modes.
-- This column decides only how an amount is worded, and whether the money
-- surfaces (settlement, dues, payments, invoices) exist for the season.
--
-- Fixed once the season has an auction: the purse and base prices were typed
-- in this unit, and re-reading them in the other would scale every figure by
-- the wrong word. The application refuses the change (competition actions);
-- there is no path that writes it after an auction row exists.
--
-- ADDITIVE AND BACKWARDS COMPATIBLE: every existing season was a rupee season,
-- which the DEFAULT states; no new GRANT is needed (column of an existing
-- table the roles already read and write).

ALTER TABLE "competitions"
  ADD COLUMN "auction_unit" text NOT NULL DEFAULT 'inr';--> statement-breakpoint

ALTER TABLE "competitions" ADD CONSTRAINT "competitions_auction_unit_check"
  CHECK ("auction_unit" IN ('inr', 'points'));--> statement-breakpoint

COMMENT ON COLUMN "competitions"."auction_unit" IS
  'What the auction counts in: inr (rupees, settleable) | points (no money owed). Amounts are x100 either way. Fixed once an auction exists.';
