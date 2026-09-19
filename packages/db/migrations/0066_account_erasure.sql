-- ACCOUNT ERASURE, AS A THING THE PLATFORM CAN ACTUALLY DO.
--
-- HAND-AUTHORED, like 0019-0063: the drizzle snapshots stop at 0018.
--
-- NUMBERED 0066, NOT 0064, ON PURPOSE. The fr1-feedback branch holds 0064
-- (problem_reports) and 0065 (platform_reviews), stamped 1789228800000 and
-- 1789315200000, and the shared local database has already applied them. A
-- second 0064 would collide on the file name when the branches meet and, being
-- stamped no later than an applied entry, would be SKIPPED by the migrator while
-- it reported success (see the journal-timestamp note in packages/db/README.md).
-- Whichever branch merges second rebases its journal entries after the other's;
-- the files themselves cannot collide.
--
-- /account promised "you can ask us to delete your account" and the only way to
-- act on it was hand-written SQL across eleven person_id foreign keys. 0040 made
-- the destructive version impossible (RESTRICT on every shared record); this is
-- the constructive half: a request a person can file, and a marker the erasure
-- leaves behind so every later reader can tell an erased person from a missing
-- one.

-- The moment a person was erased. NULL for everyone else.
ALTER TABLE "people" ADD COLUMN "erased_at" timestamptz;--> statement-breakpoint

-- An erased person keeps their row (shared records point at it) and loses every
-- way to reach them. The reachability rule from 0062 therefore admits one more
-- state, and ONLY that state: a row with no phone and no email is legal when,
-- and because, it was erased.
ALTER TABLE "people" DROP CONSTRAINT "people_reachable_check";--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_reachable_check"
  CHECK ("phone" IS NOT NULL OR "email" IS NOT NULL OR "erased_at" IS NOT NULL);--> statement-breakpoint

-- And the converse, which is what makes the marker trustworthy: an erased row
-- cannot hold a contact channel. A half-finished erasure that nulled the name
-- and left the number is a row this rejects.
ALTER TABLE "people" ADD CONSTRAINT "people_erased_uncontactable_check"
  CHECK ("erased_at" IS NULL OR ("phone" IS NULL AND "email" IS NULL));--> statement-breakpoint

-- A person asking. Platform-to-person data like consent_records: no org, no
-- RLS, every read and write scoped to the person or to the privacy desk in the
-- application layer.
CREATE TABLE "erasure_requests" (
  "id" char(26) PRIMARY KEY,
  "person_id" char(26) NOT NULL REFERENCES "people" ("id") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'requested',
  -- The person's own words, optional. Useful to whoever decides.
  "reason" text,
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  -- Who closed it: a privacy officer for completed/declined, the person for
  -- withdrawn. Set exactly when the request stops being open.
  "decided_by" char(26),
  "decided_at" timestamptz,
  "decision_note" text,
  CONSTRAINT "erasure_requests_status_check"
    CHECK ("status" IN ('requested', 'completed', 'declined', 'withdrawn')),
  CONSTRAINT "erasure_requests_decision_check"
    CHECK (("status" = 'requested') = ("decided_at" IS NULL AND "decided_by" IS NULL)),
  -- A refusal has to say why; the person is told.
  CONSTRAINT "erasure_requests_decline_reason_check"
    CHECK ("status" <> 'declined' OR "decision_note" IS NOT NULL)
);--> statement-breakpoint

-- One open request per person. A second press of the button is the first one.
CREATE UNIQUE INDEX "erasure_requests_open_uq"
  ON "erasure_requests" ("person_id") WHERE "status" = 'requested';--> statement-breakpoint

-- The desk's queue, oldest first.
CREATE INDEX "erasure_requests_queue_idx"
  ON "erasure_requests" ("status", "requested_at");
