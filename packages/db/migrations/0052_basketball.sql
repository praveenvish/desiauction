-- BASKETBALL (SP-1 Phase 4). The pack ships in
-- packages/core/src/sports/basketball.ts; this makes it selectable.
--
-- The first sport here where a LOSS is worth a point (FIBA's 2/1), and the
-- first to call a fixture a Game rather than a Match. Both were expressible
-- without touching the contract: `PointsPolicy` is four independent numbers
-- rather than a ladder assuming zero at the bottom, and the terminology wiring
-- built in Phase 4 for `ground` covers `fixture` too.
INSERT INTO "sports" ("key", "label", "enabled", "sort_order")
VALUES ('basketball', 'Basketball', true, 5);
