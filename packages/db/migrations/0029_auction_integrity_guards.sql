-- AUCTION INTEGRITY GUARDS AT THE DATABASE.
--
-- HAND-AUTHORED, like 0019–0028: the drizzle snapshots stop at 0018.
--
-- Two invariants the application has always assumed but the database never
-- enforced, promoted to constraints so a race or a bug fails loudly instead of
-- corrupting the record everyone reconciles against.
--
-- 1 · ONE LIVE AUCTION PER COMPETITION. `createAuction` refuses a second
--     auction while a non-abandoned one exists, but the check is read-then-
--     insert: two organizers (or a double-submit) racing it both read "none"
--     and both create, and then the same registered player is sellable in two
--     auctions at once. A partial unique index makes the second create fail
--     loudly. `<> 'abandoned'` mirrors the aggregate's own predicate exactly:
--     any number of abandoned auctions may accumulate; at most one live one.
CREATE UNIQUE INDEX "auctions_competition_active_uq"
  ON "auctions" ("competition_id")
  WHERE "status" <> 'abandoned';--> statement-breakpoint

-- 2 · MONEY IS NEVER NEGATIVE. Amounts are integer paise and the core gauntlet
--     never produces a negative, but nothing at the database said so, so a bad
--     writer could have persisted one and every projection and settlement fold
--     would have ingested it. Cheap to state, and it is the kind of thing you
--     only wish you had stated after it has already happened.
ALTER TABLE "bids"
  ADD CONSTRAINT "bids_amount_nonneg" CHECK ("amount" >= 0);--> statement-breakpoint
ALTER TABLE "lots"
  ADD CONSTRAINT "lots_base_price_nonneg" CHECK ("base_price" >= 0);--> statement-breakpoint
ALTER TABLE "lots"
  ADD CONSTRAINT "lots_sold_price_nonneg"
  CHECK ("sold_price" IS NULL OR "sold_price" >= 0);
