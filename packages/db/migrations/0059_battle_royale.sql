-- BATTLE ROYALE (SP-1 Phase 5). The pack ships in
-- packages/core/src/sports/battle-royale.ts; this makes it selectable.
--
-- THE ONE SPORT HERE THAT NEEDED MORE THAN A FILE OF VALUES. Every pack before
-- it described a fixture with two sides, and `esports.ts` recorded battle
-- royale as unreachable for exactly that reason: sixteen to twenty-five squads
-- drop into ONE lobby and there is no home and no away to write down.
--
-- 0058 is what unblocked it — `fixture_participants`, nullable sides, and the
-- CHECK that says a fixture has two sides or none. This migration is the last
-- line of that work: without the seed the pack exists, `pnpm verify` is green,
-- and no organizer can pick the sport, because the picker reads this table.
INSERT INTO "sports" ("key", "label", "enabled", "sort_order") VALUES
  ('battle_royale', 'Battle royale', true, 11);
