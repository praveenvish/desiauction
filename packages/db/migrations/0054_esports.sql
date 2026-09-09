-- ESPORTS (SP-1 Phase 4). The pack ships in packages/core/src/sports/esports.ts;
-- this makes it selectable.
--
-- The first sport here whose players may have NO role: `RoleVocabulary.required`
-- has been in the contract since Phase 0 and no shipped pack had ever set it
-- false. Valorant has positions, BGMI has different ones, a FIFA ladder has
-- none — so the four this pack offers are offered, not demanded.
--
-- Also the first to rename a squad (a Roster) and to name a venue that is not a
-- place (a Server).
--
-- KNOWN LIMIT, recorded in the pack: battle royale (BGMI, Free Fire) has no
-- two-sided fixture — one lobby, twenty-five squads, scored on placement plus
-- kills — and `fixture_results.score` is {home, away}. That needs a
-- `fixtureShape`, exactly as racquet sports do from the other direction.
INSERT INTO "sports" ("key", "label", "enabled", "sort_order")
VALUES ('esports', 'Esports', true, 7);
