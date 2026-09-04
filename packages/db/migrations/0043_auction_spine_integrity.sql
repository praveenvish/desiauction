-- REFERENTIAL INTEGRITY FOR THE AUCTION SPINE.
--
-- HAND-AUTHORED, like 0019-0042.
--
-- Migration 0040 opened with the sentence "the database had exactly two foreign
-- keys" and closed the `person_id` arm. It left the spine: audit PA-1 §7 found
-- 133 `*_id` columns with no constraint at all, and the consequences already in
-- the development database — 220 lots referencing a registration that did not
-- exist, 214 sold lots referencing a paddle that did not exist, 220
-- competitions with no organization.
--
-- The failure mode is the reason this matters more than tidiness: a read model
-- joining through a missing row renders EMPTY rather than erroring. Nobody sees
-- a stack trace; an organizer sees a season with no players, and the next
-- person to look spends an afternoon debugging a platform whose data was simply
-- broken.
--
-- ON DELETE RESTRICT, EVERYWHERE, DELIBERATELY.
--
-- Not CASCADE. A cascade here would mean deleting an organization silently
-- destroys its auctions, its bids and its sale record — and this product's
-- promise is that money records survive erasure (invariant 4: "a Person's
-- erasure destroys identity, never facts"). Offboarding anonymizes; it does not
-- delete. RESTRICT makes an accidental delete a loud refusal at the statement
-- that attempted it, which is exactly the diagnosis the silent orphans denied
-- us. `lots.sold_to_paddle_id` and `registrations.team_id` are nullable and
-- keep RESTRICT too: the pointer may be absent, but while it is set it must
-- point at something real.
--
-- NOT VALID, THEN VALIDATE.
--
-- `ADD CONSTRAINT ... NOT VALID` takes a brief lock and does not scan; the
-- separate `VALIDATE CONSTRAINT` scans under SHARE UPDATE EXCLUSIVE, which does
-- not block reads or writes. On today's row counts either would be
-- instantaneous, but the shape is the point: this is the form every future
-- constraint in this repository should take, and 0040's plain ADD is the one it
-- is correcting.
--
-- PREREQUISITE, and it was the real work. Sixteen regression teardowns deleted
-- an organization and left its whole auction spine behind — 660 fresh orphans
-- per suite run. These constraints would have turned every one of those suites
-- red on the day they landed, exactly as 0040 broke the engine's teardown and
-- left it failing for months while all 66 of its assertions passed. That is
-- fixed first (`apps/web/src/server/test-support/purge-org.ts`), the residue is
-- purged, and `node scripts/purge-orphans.mjs` reports clean before this runs.

--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_auction_id_fk"
  FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "lots" VALIDATE CONSTRAINT "lots_auction_id_fk";--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_registration_id_fk"
  FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "lots" VALIDATE CONSTRAINT "lots_registration_id_fk";--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_sold_to_paddle_id_fk"
  FOREIGN KEY ("sold_to_paddle_id") REFERENCES "paddles"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "lots" VALIDATE CONSTRAINT "lots_sold_to_paddle_id_fk";--> statement-breakpoint

ALTER TABLE "bids" ADD CONSTRAINT "bids_lot_id_fk"
  FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "bids" VALIDATE CONSTRAINT "bids_lot_id_fk";--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_paddle_id_fk"
  FOREIGN KEY ("paddle_id") REFERENCES "paddles"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "bids" VALIDATE CONSTRAINT "bids_paddle_id_fk";--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_auction_id_fk"
  FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "bids" VALIDATE CONSTRAINT "bids_auction_id_fk";--> statement-breakpoint

ALTER TABLE "paddles" ADD CONSTRAINT "paddles_auction_id_fk"
  FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "paddles" VALIDATE CONSTRAINT "paddles_auction_id_fk";--> statement-breakpoint
ALTER TABLE "paddles" ADD CONSTRAINT "paddles_team_id_fk"
  FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "paddles" VALIDATE CONSTRAINT "paddles_team_id_fk";--> statement-breakpoint

ALTER TABLE "auctions" ADD CONSTRAINT "auctions_competition_id_fk"
  FOREIGN KEY ("competition_id") REFERENCES "competitions"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "auctions" VALIDATE CONSTRAINT "auctions_competition_id_fk";--> statement-breakpoint

ALTER TABLE "teams" ADD CONSTRAINT "teams_competition_id_fk"
  FOREIGN KEY ("competition_id") REFERENCES "competitions"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "teams" VALIDATE CONSTRAINT "teams_competition_id_fk";--> statement-breakpoint

ALTER TABLE "registrations" ADD CONSTRAINT "registrations_competition_id_fk"
  FOREIGN KEY ("competition_id") REFERENCES "competitions"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "registrations" VALIDATE CONSTRAINT "registrations_competition_id_fk";--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_team_id_fk"
  FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "registrations" VALIDATE CONSTRAINT "registrations_team_id_fk";--> statement-breakpoint

ALTER TABLE "competitions" ADD CONSTRAINT "competitions_org_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "competitions" VALIDATE CONSTRAINT "competitions_org_id_fk";--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_org_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "auctions" VALIDATE CONSTRAINT "auctions_org_id_fk";--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_org_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "teams" VALIDATE CONSTRAINT "teams_org_id_fk";--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_org_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "lots" VALIDATE CONSTRAINT "lots_org_id_fk";--> statement-breakpoint

-- The money spine: an obligation or a payment without its case is a number
-- nobody can explain, and both are evidence.
ALTER TABLE "settlement_obligations" ADD CONSTRAINT "settlement_obligations_case_id_fk"
  FOREIGN KEY ("case_id") REFERENCES "settlement_cases"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "settlement_obligations" VALIDATE CONSTRAINT "settlement_obligations_case_id_fk";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_case_id_fk"
  FOREIGN KEY ("case_id") REFERENCES "settlement_cases"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "payments" VALIDATE CONSTRAINT "payments_case_id_fk";
