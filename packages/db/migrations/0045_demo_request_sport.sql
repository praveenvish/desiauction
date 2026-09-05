-- WHICH SPORT DID THEY ACTUALLY WANT? (SP-1, the Phase 1-4 gate)
--
-- The platform runs one sport and the codebase can now run many (SP-1 Phase 0
-- put the vocabulary behind a pack). What nobody has is EVIDENCE about which
-- sport to build second. Seven weeks of engineering aimed at a guess is the
-- expensive way to find out; one question on the form organizers already fill
-- is the cheap one.
--
-- NULLABLE, AND DELIBERATELY SO. Every row written before this column existed
-- was created by someone who was never asked the question, and a DEFAULT
-- 'cricket' would answer on their behalf — in the one column whose entire
-- purpose is to be counted. A null here means "not asked", exactly as
-- `player_profiles.gender` distinguishes never-asked from declined-to-say.
-- The application requires the answer going forward; the schema records that
-- history did not have one.
--
-- THE LIST IS NOT THE SPORT REGISTRY, and must never be wired to it. The
-- registry names sports we CAN run (cricket, today). This column records what
-- somebody ASKED for, so it has to offer sports we cannot run yet — that is
-- the whole measurement. Keep it in step with DEMO_SPORTS in
-- apps/web/src/server/marketing/demo-requests.ts.

ALTER TABLE "demo_requests" ADD COLUMN "sport" text;

ALTER TABLE "demo_requests" ADD CONSTRAINT "demo_requests_sport_check"
  CHECK ("sport" IS NULL OR "sport" IN (
    'cricket', 'football', 'kabaddi', 'volleyball', 'badminton',
    'basketball', 'hockey', 'table-tennis', 'pickleball', 'esports', 'other'
  ));

-- The question this column exists to answer is "how many of each, lately",
-- so the index leads with the sport and carries the date beside it.
CREATE INDEX "demo_requests_sport_idx" ON "demo_requests" ("sport", "created_at");
