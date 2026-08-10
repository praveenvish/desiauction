-- AN ADDRESS TO SEND TO.
--
-- HAND-AUTHORED, like 0022–0024: the drizzle snapshots stop at 0018 while the
-- migrations run past 0024, so `db:generate` diffs against a stale schema.
--
-- The product has never collected an email address. `people` carries a phone and
-- a name, sign-in is phone-first, and nothing ever asked for anything else — so
-- the email delivery adapter refuses every document with `no_email_on_file`,
-- correctly and permanently. This is the column that refusal named.
--
-- VERIFIED OR ABSENT, never merely typed. `email_verified_at` is what the
-- resolver reads; an address with no verification timestamp is a string
-- somebody entered, not a channel. Sending a receipt to an unverified address
-- is how a club's money reaches a stranger's mailbox because a player fat-
-- fingered a domain.
--
-- Unique when present, and case-folded to get there: mailbox comparison is
-- case-insensitive in practice, and two accounts differing only in capitals
-- would each believe they held the address.
ALTER TABLE "people" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "people_email_uq" ON "people" (lower("email")) WHERE "email" IS NOT NULL;--> statement-breakpoint

-- The codes that prove an address belongs to the person typing it.
--
-- A SEPARATE table from `otp_codes`, deliberately. That table's column is named
-- `phone` and its indexes are built for sign-in; storing an email address in it
-- would leave every reader lying about what it holds, and renaming the column
-- means a migration across the authentication hot path to save thirty lines.
-- Two small tables that each say what they are beat one that does not.
--
-- Person-scoped, unlike otp_codes: you must already be signed in to add an
-- address, so there is always somebody to attach it to, and the code is useless
-- without their session.
CREATE TABLE "email_verifications" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "person_id" char(26) NOT NULL,
  "email" text NOT NULL,
  "code_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX "email_verifications_person_idx" ON "email_verifications" ("person_id","created_at");
