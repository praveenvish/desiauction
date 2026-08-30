-- A TIME, NOT A PROMISE TO FIND ONE.
--
-- HAND-AUTHORED, like 0022–0031.
--
-- 0031 captured the request. This is the calendar on top of it, and the whole
-- design turns on one decision:
--
-- SLOTS ARE DERIVED, NEVER MATERIALISED. There is no `demo_slots` table. What
-- is offered on a Tuesday is a pure function of the availability windows, the
-- blackout dates and the bookings that already exist — computed at read time,
-- every time. A materialised slot table would need a job to keep it true, and
-- the failure mode of that job is a calendar that offers a time nobody is
-- there for. A derivation cannot drift.
--
-- DOUBLE-BOOKING IS A DATABASE INVARIANT. Not a check-then-insert, which two
-- people pressing at once will step straight through. A partial unique index
-- over live bookings is what actually refuses the second one, and the loser
-- gets a re-render with that slot gone — the same idiom as
-- `pass_upgrade_requests_open_uq`.
--
-- TIME IS STORED IN UTC AND SPOKEN IN IST. `timestamptz` throughout; the
-- windows below are minutes-past-midnight in Asia/Kolkata, resolved to instants
-- by the derivation. One market, one timezone, named on the page — a calendar
-- that silently guesses is worse than one that states its own.

-- WHAT IS ON OFFER. Recurring weekly, because that is how a person actually
-- keeps a calendar: "Tuesday and Thursday evenings" survives contact with a
-- month, twenty individual dates do not.
CREATE TABLE "demo_availability" (
  "id" char(26) PRIMARY KEY NOT NULL,
  -- 0 = Sunday, matching both JS getDay() and Postgres EXTRACT(DOW).
  "weekday" smallint NOT NULL,
  -- Minutes past midnight, IST. Integers rather than `time` because the
  -- derivation does arithmetic on them and every dialect of `time` in every
  -- driver is a different shape.
  "start_minute" integer NOT NULL,
  "end_minute" integer NOT NULL,
  "slot_minutes" integer NOT NULL DEFAULT 30,
  -- A window can be retired without deleting the history of what was offered
  -- when a past booking was made.
  "effective_from" date,
  "effective_to" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" char(26) NOT NULL,
  CONSTRAINT "demo_availability_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6),
  CONSTRAINT "demo_availability_bounds_check"
    CHECK ("start_minute" >= 0 AND "end_minute" <= 1440 AND "start_minute" < "end_minute"),
  -- A window shorter than its own slot length yields nothing and would be a
  -- silently empty day.
  CONSTRAINT "demo_availability_slot_check"
    CHECK ("slot_minutes" BETWEEN 15 AND 240 AND "end_minute" - "start_minute" >= "slot_minutes"),
  CONSTRAINT "demo_availability_effective_check"
    CHECK ("effective_to" IS NULL OR "effective_from" IS NULL OR "effective_to" >= "effective_from")
);--> statement-breakpoint

CREATE INDEX "demo_availability_weekday_idx" ON "demo_availability" ("weekday");--> statement-breakpoint

-- NOT THIS THURSDAY. A subtraction from the recurring pattern, which is the
-- only shape that lets somebody go away for a week without dismantling and
-- rebuilding their whole calendar.
CREATE TABLE "demo_blackouts" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "blackout_on" date NOT NULL,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" char(26) NOT NULL,
  CONSTRAINT "demo_blackouts_day_uq" UNIQUE ("blackout_on")
);--> statement-breakpoint

-- THE BOOKING.
CREATE TABLE "demo_bookings" (
  "id" char(26) PRIMARY KEY NOT NULL,
  -- Every booking belongs to a request: the questions on that form are what
  -- makes the call worth having, so there is no path to a slot that skips them.
  "demo_request_id" char(26) NOT NULL
    REFERENCES "demo_requests" ("id") ON DELETE CASCADE,
  "slot_start" timestamp with time zone NOT NULL,
  "slot_end" timestamp with time zone NOT NULL,
  -- SHA-256 of a base64url secret handed to the requester once, never stored.
  -- Same idiom as sessions, invites and owner-join tokens.
  "token_hash" text NOT NULL UNIQUE,
  "confirmed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  -- 'requester' | 'organizer' — who called it off changes what we say next.
  "cancelled_by" text,
  -- A reschedule is a NEW row pointing at the one it replaced, never an UPDATE
  -- of slot_start: "what time did we agree, and when did that change?" is a
  -- question about the past, and a mutated column cannot answer it.
  "rescheduled_from" char(26) REFERENCES "demo_bookings" ("id"),
  "reminder_24h_sent_at" timestamp with time zone,
  "reminder_1h_sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "demo_bookings_span_check" CHECK ("slot_end" > "slot_start"),
  CONSTRAINT "demo_bookings_cancelled_by_check"
    CHECK ("cancelled_by" IS NULL OR "cancelled_by" IN ('requester', 'organizer')),
  CONSTRAINT "demo_bookings_cancel_together_check"
    CHECK (("cancelled_at" IS NULL) = ("cancelled_by" IS NULL))
);--> statement-breakpoint

-- THE INVARIANT. One live booking per instant; cancelled rows step aside so the
-- slot returns to the pool. This index is the only thing standing between two
-- simultaneous confirmations and a double-booked founder.
CREATE UNIQUE INDEX "demo_bookings_slot_uq"
  ON "demo_bookings" ("slot_start")
  WHERE "cancelled_at" IS NULL;--> statement-breakpoint

-- The picker asks "what is taken between now and a fortnight from now".
CREATE INDEX "demo_bookings_slot_idx"
  ON "demo_bookings" ("slot_start")
  WHERE "cancelled_at" IS NULL;--> statement-breakpoint

CREATE INDEX "demo_bookings_request_idx"
  ON "demo_bookings" ("demo_request_id");--> statement-breakpoint

-- The reminder sweep's only query: live, confirmed, starting soon, not yet told.
CREATE INDEX "demo_bookings_reminder_idx"
  ON "demo_bookings" ("slot_start")
  WHERE "cancelled_at" IS NULL AND "confirmed_at" IS NOT NULL;--> statement-breakpoint

-- NO ROW LEVEL SECURITY, for the reason 0031 gives at length: there is no
-- tenant here. A stranger picking a time has no org, no membership and no
-- session. The token in their link is what authorises them against their own
-- booking, and it is checked in SQL by hash — not by RLS, which has no
-- principal to key on.
--
-- Grants: nothing to issue. The default privileges in the four-role recipe give
-- desiauction_app full DML on tables created later (the public picker and the
-- operator desk both run there) and desiauction_system SELECT (the queue).
-- The system role's pinned write list stays at four tables.
