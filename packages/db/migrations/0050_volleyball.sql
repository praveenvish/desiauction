-- VOLLEYBALL (SP-1 Phase 4).
--
-- The whole migration again. The pack ships in
-- packages/core/src/sports/volleyball.ts; this makes it selectable.
--
-- Worth noting that this sport needed no more schema than kabaddi did, despite
-- being the first with a genuinely different SHAPE — it scores in sets AND
-- points, where every earlier pack had one running total. `fixture_results.score`
-- has been jsonb since 0047 precisely so a second component costs nothing here.
INSERT INTO "sports" ("key", "label", "enabled", "sort_order")
VALUES ('volleyball', 'Volleyball', true, 3);
