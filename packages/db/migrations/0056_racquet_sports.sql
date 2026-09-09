-- BADMINTON, TABLE TENNIS, PICKLEBALL (SP-1 Phase 4). The packs ship in
-- packages/core/src/sports/; this makes them selectable.
--
-- THESE WERE RECORDED AS BLOCKED AND WERE NOT. `PHASE-4_NOTES.md` said racquet
-- sports needed a new `fixtureShape` because "a team tie is several rubbers,
-- not one scoreline". The first half is true; the conclusion did not follow. A
-- tie's RESULT is one scoreline per side — rubbers won, and games won inside
-- them — which is the arrangement volleyball has had since Phase 4 with sets
-- and points. `ScoreRecord` is an arbitrary map of named numbers and the result
-- form is generated from `scoreFields`, so all three packs needed no code.
--
-- What is genuinely unavailable is recording WHO played the third rubber and
-- how it finished. That is a scorecard with line-ups, and no sport here has one
-- — cricket cannot say who batted either. Racquet sports are no more limited
-- than the six that shipped before them.
INSERT INTO "sports" ("key", "label", "enabled", "sort_order") VALUES
  ('badminton', 'Badminton', true, 8),
  ('table_tennis', 'Table tennis', true, 9),
  ('pickleball', 'Pickleball', true, 10);
