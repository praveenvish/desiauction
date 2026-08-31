-- WHO A SEASON IS FOR (PI-1, phase P1; enforced in P3).
--
-- HAND-AUTHORED, like 0019-0037.
--
-- The platform had no gender model at all — no person column, no competition
-- category, and therefore no way for a women's tournament to say so anywhere
-- but its free-text name. The person half lands in 0036 (player_profiles);
-- this is the competition half: what the organizer declares the season to be.
--
-- 'open' is the honest default. Every competition that exists today made no
-- declaration, and 'open' states exactly that — no existing row's behavior
-- changes, no registration that was possible yesterday is refused tomorrow.
--
-- ENFORCEMENT DOES NOT LIVE HERE. The category is read by exactly one
-- decision-maker — core's eligibility engine (PI-1 P3) — which blocks on the
-- self-serve path and only ADVISES on organizer add/import (the human-approval
-- invariant 5: the organizer is the gate and may know better). Public surfaces
-- read it for terminology ("Women's", "Open") and nothing else. Scattering
-- `if gender === …` through the app is the anti-pattern this design exists to
-- prevent, and a guardrail test holds the module boundary.

ALTER TABLE "competitions"
  ADD COLUMN "entry_category" text NOT NULL DEFAULT 'open';--> statement-breakpoint

ALTER TABLE "competitions" ADD CONSTRAINT "competitions_entry_category_check"
  CHECK ("entry_category" IN ('open', 'men', 'women', 'mixed'));--> statement-breakpoint

-- ADDITIVE AND BACKWARDS COMPATIBLE: nullable-by-default semantics via the
-- DEFAULT, no row rewritten beyond the column add, no new GRANT needed.
COMMENT ON COLUMN "competitions"."entry_category" IS
  'Organizer-declared entry category: open | men | women | mixed. Read for eligibility (core engine only) and public terminology (PI-1).';
