-- KABADDI (SP-1 Phase 4).
--
-- The whole migration. The pack ships in packages/core/src/sports/kabaddi.ts
-- and this is the flag that makes it selectable — no schema change, because
-- since 0047 a sport's player detail lives in `registrations.attributes` and a
-- scoreline in `fixture_results.score`, both jsonb. That is what Phase 4 was
-- supposed to cost, and it is what it cost.
--
-- Third in the picker: sort order is expected volume, not alphabet.
INSERT INTO "sports" ("key", "label", "enabled", "sort_order")
VALUES ('kabaddi', 'Kabaddi', true, 2);
