-- SOMEBODY WANTS TO BE SHOWN.
--
-- HAND-AUTHORED, like 0022–0030: the drizzle snapshots stop at 0018.
--
-- /schedule-demo has printed a mailto since PX-10, and said so honestly in its
-- own source: "no booking-calendar backend". The reason was real — outbound
-- email was an open founder decision at the time — and it is now closed in
-- code. This is the somewhere those requests land.
--
-- NO ROW LEVEL SECURITY, AND THAT IS THE DELIBERATE PART. Every tenant table on
-- this platform is protected by `..._tenant` policies keyed on `app.org_id`,
-- and an exception that nobody wrote down would be indistinguishable from an
-- exception somebody forgot. This table has no org: the person filling the form
-- is a stranger with no session, no membership and no tenant to be scoped to —
-- the same category as `newsletter_subscribers`, and for the same reason. The
-- only readers are platform operators on the RLS-exempt system pool.
--
-- IT IS A REQUEST, NOT A BOOKING. 0032 adds the calendar on top; this table
-- stands alone and is useful alone, because a captured lead with a queue behind
-- it is already strictly better than an address in a mailto link.
--
-- SIZE IS A BAND, NOT A NUMBER. "How many teams?" asked of somebody who has not
-- run the tournament yet produces a guess typed as fact. The bands are what the
-- answer is actually worth, and 'unsure' is a first-class answer rather than an
-- empty column.
CREATE TABLE "demo_requests" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  -- Normalised to E.164 by the SAME normaliser sign-in uses. A second phone
  -- parser in this codebase would be a second set of bugs.
  "phone" text NOT NULL,
  -- Optional. Required only to receive the acknowledgement by mail; the
  -- on-screen confirmation is the contract either way.
  "email" text,
  "org_name" text NOT NULL,
  "tournament_size" text NOT NULL,
  -- Nullable on purpose: most people asking for a demo have not fixed a date,
  -- and a NOT NULL here would make them invent one.
  "auction_on" date,
  "preferred_window" text NOT NULL,
  -- Their words. The single most useful column for whoever answers, and the one
  -- a form is always tempted to leave out.
  "note" text,
  -- Which surface sent them. Without it the question "is the pricing-page CTA
  -- worth anything?" has no answer but a guess.
  "source" text NOT NULL,
  -- Throttling only; ages out with the row under the retention sweep.
  "request_ip" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- The answer. Null contact = still open.
  "contacted_at" timestamp with time zone,
  "contacted_by" char(26),
  "outcome" text,
  CONSTRAINT "demo_requests_size_check"
    CHECK ("tournament_size" IN ('under-8', '8-16', '16-32', 'over-32', 'unsure')),
  CONSTRAINT "demo_requests_window_check"
    CHECK ("preferred_window" IN ('weekday-evening', 'weekend-morning', 'weekend-evening', 'any')),
  CONSTRAINT "demo_requests_source_check"
    CHECK ("source" IN ('schedule-demo', 'pricing', 'landing', 'help', 'other')),
  CONSTRAINT "demo_requests_outcome_check"
    CHECK ("outcome" IS NULL OR "outcome" IN
      ('scheduled', 'showed', 'no_show', 'signed_up', 'not_a_fit', 'no_response')),
  -- An outcome without a contact time would be an answer nobody gave.
  CONSTRAINT "demo_requests_answered_together_check"
    CHECK (("contacted_at" IS NULL) = ("outcome" IS NULL))
);--> statement-breakpoint

-- The queue reads newest-first and splits on answered/unanswered.
CREATE INDEX "demo_requests_open_idx"
  ON "demo_requests" ("created_at" DESC)
  WHERE "contacted_at" IS NULL;--> statement-breakpoint

CREATE INDEX "demo_requests_created_idx"
  ON "demo_requests" ("created_at" DESC);--> statement-breakpoint

-- The two throttle lookups, and nothing else. Mirrors `otp_codes_ip_idx`,
-- which is the house limiter this one is modelled on.
CREATE INDEX "demo_requests_phone_idx"
  ON "demo_requests" ("phone", "created_at");--> statement-breakpoint

CREATE INDEX "demo_requests_ip_idx"
  ON "demo_requests" ("request_ip", "created_at");--> statement-breakpoint

-- THE ROLE MODEL, STATED RATHER THAN ASSUMED.
--
-- Local development runs as the database OWNER, which has every privilege
-- implicitly, so a missing grant is invisible here and appears only in
-- production — which is how the four-role recipe once rotted a dozen migrations
-- behind. No GRANT is issued here because none is needed, and that is a claim
-- worth writing down rather than leaving to be rediscovered:
--
--   · desiauction_app  — ALTER DEFAULT PRIVILEGES (ops/db/create-app-role.sql)
--     already grants it SELECT/INSERT/UPDATE/DELETE on every table created
--     later by the migration role. The public form and the operator desk both
--     run on this pool, and both are covered the moment this table exists.
--   · desiauction_system — has SELECT on everything by default privilege, which
--     is all the operator QUEUE needs. It deliberately gains no write: its
--     enumerated write list is pinned by `grants:verify`, and a fourth table on
--     it should be a decision somebody makes on purpose. It is not needed here,
--     because a table with no RLS needs no BYPASSRLS role to write it.
--   · desiauction_engine / desiauction_runner — read-only by default privilege
--     and that is already more than either has any business with. A demo
--     request is neither auction truth nor money.
