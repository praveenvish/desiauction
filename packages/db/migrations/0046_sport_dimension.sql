-- SPORT BECOMES A DIMENSION (SP-1 Phase 1).
--
-- Phase 0 put the vocabulary behind a pack in `packages/core/src/sports/`, and
-- every caller since has resolved to the DEFAULT pack because a competition had
-- no way to say which sport it was. This is that way.
--
-- THE CATALOGUE IS NOT THE REGISTRY, and the two must not be confused:
--
--   · `packages/core/src/sports/` — the sports the platform CAN run. Adding one
--     is a typed pack file, reviewed and deployed like any other code, because
--     a sport is a contract with validators (eleven wickets is impossible) and
--     no admin form can express that safely.
--   · this table — which of those shipped packs are LIVE. It holds a flag, not
--     a definition. Its `key` must match a pack; the FK below then makes it
--     impossible for a competition to name a sport nothing can run.
--
-- SEEDED, NOT ADMINISTERED. There is deliberately no UI writing this table.
-- Enabling a sport requires its pack to exist in code, which is a deploy — so
-- the flag can never usefully move ahead of one, and a click-toggle over a
-- two-row list is not worth spending platform administration's provable
-- read-only property on (see the header of server/admin/access-log.ts for the
-- argument that property is holding). When a pilot-org toggle has a real user,
-- that is the review conversation, and this table is already the right shape
-- for it.
--
-- NO ROW LEVEL SECURITY. Every RLS table on this platform is tenant data keyed
-- by org. This is global reference data — the same eleven rows for everybody,
-- readable by all four roles, written by migrations only. A tenancy policy here
-- would be a policy with nothing to say.
--
-- RE-RUN THE ROLE RECIPE AFTER THIS MIGRATION. `ops/db/create-app-role.sql`
-- grants `on all tables in schema public`, which binds the tables that exist
-- when it runs — a new table is invisible to desiauction_app until it is
-- re-run. Locally you connect as the owner and will never notice; in
-- production every page that reads a competition would fail.

CREATE TABLE "sports" (
  "key" text PRIMARY KEY,
  "label" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  -- The order the pickers offer them in. Not alphabetical: the top of a select
  -- is where the likeliest answer belongs.
  "sort_order" integer NOT NULL DEFAULT 0,
  "added_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

INSERT INTO "sports" ("key", "label", "enabled", "sort_order")
VALUES ('cricket', 'Cricket', true, 0);--> statement-breakpoint

-- DEFAULT 'cricket' is a fact here, not a guess. Every competition and every
-- tournament that exists on this platform today is cricket; there has never
-- been a way to create anything else. That is why this backfills honestly,
-- where `demo_requests.sport` (0045) had to stay nullable — there the question
-- had never been PUT to anyone, and a default would have invented an answer.
--
-- The DEFAULT survives Phase 1 on purpose: with exactly one sport enabled it
-- remains true, and it keeps every existing insert path working untouched.
-- Phase 2 ships the second pack, and on that day the default becomes a lie and
-- gets dropped so callers must state the sport.
ALTER TABLE "competitions" ADD COLUMN "sport" text NOT NULL DEFAULT 'cricket';--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "sport" text NOT NULL DEFAULT 'cricket';--> statement-breakpoint

-- A competition cannot name a sport the platform has no pack for. This is the
-- constraint that makes "admin picks from a catalogue you ship" a fact about
-- the database rather than a convention somebody remembers.
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_sport_fk"
  FOREIGN KEY ("sport") REFERENCES "sports"("key");--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_sport_fk"
  FOREIGN KEY ("sport") REFERENCES "sports"("key");--> statement-breakpoint

CREATE INDEX "competitions_sport_idx" ON "competitions" ("sport");
