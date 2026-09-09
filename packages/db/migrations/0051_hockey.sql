-- HOCKEY (SP-1 Phase 4). The pack ships in packages/core/src/sports/hockey.ts;
-- this makes it selectable.
--
-- India's other national game, and the cheapest sport this platform has added:
-- a file of values, two lines in the registry and this INSERT. No schema, no
-- UI, no engine, no new helper — every function it needs already existed for
-- football, which is the claim ADDING_A_SPORT.md makes to whoever wants the
-- seventh.
INSERT INTO "sports" ("key", "label", "enabled", "sort_order")
VALUES ('hockey', 'Hockey', true, 4);
