-- WHAT A SEASON'S PASS COVERS.
--
-- HAND-AUTHORED, like 0022–0026: the drizzle snapshots stop at 0018 while the
-- migrations run past 0026, so `db:generate` diffs against a stale schema.
--
-- The pricing page has quoted "Up to 4 teams and 40 players" since PX-10 and
-- nothing in the platform knew it — no tier, no plan, no entitlement, no
-- billing anywhere. A free organizer could run sixteen teams. This is the
-- column the page was always describing.
--
-- ON THE COMPETITION, not the org: the page sells "a Pass per tournament", and
-- an association buying a season's worth of tournaments still gets one row per
-- tournament to point at. Putting it on the org would make the product's unit
-- of sale disagree with the product's unit of work.
--
-- DEFAULT 'free' is the honest default for anything created from here on. It is
-- NOT what the existing rows get: every season already in this database was
-- created during beta, and the pricing page promises in as many words that
-- "Tournaments started during beta stay free forever" — with every tier and
-- every feature. Retro-fitting them to a four-team ceiling would break that
-- promise against people who took it, and would refuse the next team on
-- tournaments that already have six. They are backfilled to 'association',
-- which is the tier whose limits are "by agreement" — which is exactly what a
-- beta grant is.
ALTER TABLE "competitions"
  ADD COLUMN "tier" text NOT NULL DEFAULT 'free';--> statement-breakpoint

UPDATE "competitions" SET "tier" = 'association';--> statement-breakpoint

ALTER TABLE "competitions"
  ADD CONSTRAINT "competitions_tier_check"
  CHECK ("tier" IN ('free', 'pro', 'association'));
