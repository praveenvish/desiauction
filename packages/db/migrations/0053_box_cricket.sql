-- BOX CRICKET (SP-1 Phase 4). The pack ships in
-- packages/core/src/sports/box-cricket.ts; this makes it selectable.
--
-- A real tournament category — organizers run "box cricket" as a named thing
-- and would not find their event under Cricket — that turns out to differ from
-- its parent in a WORD and a typo net. The pack borrows cricket's roles and
-- attributes by reference rather than copying them, so the two vocabularies
-- cannot drift apart the way four copies of cricket's roles once did.
INSERT INTO "sports" ("key", "label", "enabled", "sort_order")
VALUES ('box_cricket', 'Box cricket', true, 6);
