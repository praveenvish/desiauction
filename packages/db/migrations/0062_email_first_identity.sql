-- A PERSON CAN NOW BE ANCHORED BY EITHER CREDENTIAL (Phase 2).
--
-- `people.phone` has been NOT NULL since 0000, which made a phone number the
-- one thing every account had to have. That was right when SMS was the only
-- door. It stopped being right when Indian SMS turned out to need DLT
-- registration with TRAI before a single message can be sent — a queue that
-- blocks every signup, including the founder's.
--
-- BOTH CREDENTIALS STAY UNIQUE, and that is the whole safety model. `phone`
-- keeps its unique constraint and `email` keeps the unique index on
-- lower(email) from 0025. Postgres permits many NULLs under a unique
-- constraint, so phone-less accounts do not collide with each other while every
-- real number still identifies exactly one person.
--
-- A CONSEQUENCE WORTH STATING: because both are unique, somebody who signs up
-- by email and later offers a phone that already belongs to another account is
-- REFUSED, not merged. Merging would need proof of both credentials at once —
-- which needs an SMS code, which is the thing that is blocked — so a merge path
-- built now could not be used anyway. Two accounts and a clear message beats a
-- silent fold, which is how one person quietly acquires another's registrations
-- and money.
--
-- At least one of the two is still required. Nothing may exist with neither,
-- because such a row could never be signed into and could never be found.
ALTER TABLE "people" ALTER COLUMN "phone" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "people"
  ADD CONSTRAINT "people_reachable_check"
  CHECK ("phone" IS NOT NULL OR "email" IS NOT NULL);
