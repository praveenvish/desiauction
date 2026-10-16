-- PRACTICE AUCTIONS (2026-10-02).
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- Before the real night, an organiser can run a short practice in the same
-- season so every owner learns the bidding screens on their own phone. The
-- practice is an ordinary auction row — same engine, same screens, same links —
-- marked `kind = 'practice'`. Everything that reads a season's auction (setup,
-- settlement, public pages, posters, careers, notifications) reads `kind =
-- 'real'` only, so a practice can never be mistaken for the night itself.
--
-- Every existing row is a real auction: the DEFAULT backfills them.
ALTER TABLE "auctions" ADD COLUMN "kind" text NOT NULL DEFAULT 'real';
--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_kind_check"
  CHECK ("kind" IN ('real', 'practice'));
--> statement-breakpoint
-- One REAL auction per season, as before (0029) — practice rows do not count.
DROP INDEX "auctions_competition_active_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX "auctions_competition_active_uq" ON "auctions" ("competition_id")
  WHERE "status" <> 'abandoned' AND "kind" = 'real';
--> statement-breakpoint
-- And at most one practice running beside it.
CREATE UNIQUE INDEX "auctions_competition_practice_uq" ON "auctions" ("competition_id")
  WHERE "status" <> 'abandoned' AND "kind" = 'practice';
