-- ONE IDENTIFIER PER SPORT.
--
-- `demo_requests.sport` has offered 'table-tennis' since 0045, when nothing
-- could run it and the key answered to nothing but that list. The pack shipped
-- in 0056 as `table_tennis`, matching every other multi-word key here
-- (`box_cricket`), and a test holds every runnable sport to being sayable on
-- the demand form. Two spellings of one sport would split its demand across two
-- buckets and make the SP-1 gate read low for both.
--
-- Existing answers are MIGRATED rather than dropped: somebody asked for this
-- sport and that request is the whole point of the column.
ALTER TABLE "demo_requests" DROP CONSTRAINT "demo_requests_sport_check";
--> statement-breakpoint
UPDATE "demo_requests" SET "sport" = 'table_tennis' WHERE "sport" = 'table-tennis';
--> statement-breakpoint
ALTER TABLE "demo_requests" ADD CONSTRAINT "demo_requests_sport_check"
  CHECK ("sport" IS NULL OR "sport" IN (
    'cricket', 'box_cricket', 'football', 'kabaddi', 'volleyball', 'badminton',
    'basketball', 'hockey', 'table_tennis', 'pickleball', 'esports', 'other'
  ));
