-- A tournament is the durable name (BPL). Each competition under it is one
-- edition of that tournament (BPL 1, BPL 2, BPL 3) — and the competition is
-- what actually runs: it owns the status, the auction, the teams and the money.
--
-- The old `seasons` table modelled the inverse: an org-scoped season that
-- competitions belonged to. It was never used — zero rows, no UI reachable
-- from anywhere, and every competition's season_id null across the whole
-- database — so it is reshaped in place rather than left beside a new table
-- for someone to trip over later.
--
-- Renames, not drops: the RLS policy and the tenant index follow the table, so
-- the tenancy guarantee is carried over rather than rebuilt (a re-created
-- policy is a chance to get USING/WITH CHECK wrong).

ALTER TABLE "seasons" RENAME TO "tournaments";--> statement-breakpoint
ALTER INDEX "seasons_org_idx" RENAME TO "tournaments_org_idx";--> statement-breakpoint
-- RENAME TABLE does not follow the constraint-backed primary key index.
ALTER INDEX "seasons_pkey" RENAME TO "tournaments_pkey";--> statement-breakpoint
ALTER POLICY "seasons_tenant" ON "tournaments" RENAME TO "tournaments_tenant";--> statement-breakpoint

-- A tournament spans years, so a single year column was never meaningful; the
-- edition carries its own dates. Slug is NOT NULL without a default because the
-- table is empty — there is no row to backfill.
ALTER TABLE "tournaments" DROP COLUMN "year";--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "slug" text NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_slug_unique" UNIQUE ("slug");--> statement-breakpoint

-- Nullable: a one-off competition that is not part of a recurring tournament
-- stays valid and simply has no parent.
ALTER TABLE "competitions" RENAME COLUMN "season_id" TO "tournament_id";--> statement-breakpoint
CREATE INDEX "competitions_tournament_idx" ON "competitions" USING btree ("tournament_id");
