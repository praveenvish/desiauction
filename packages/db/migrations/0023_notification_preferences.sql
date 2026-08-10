-- What a person wants told to them, per topic and per channel.
--
-- HAND-AUTHORED for the same reason as 0022: the drizzle snapshots stop at 0018
-- while the migrations run past 0022, so `db:generate` diffs against a stale
-- schema and emits statements that are wrong in both directions.
--
-- NO ROW LEVEL SECURITY, matching consent_records and suppressions and the
-- identity tables they follow. A preference is between the platform and a
-- person; it is not owned by any club, and every policy in this schema is
-- org-scoped.
--
-- Distinct from `suppressions`: that is a hard stop keyed by a CONTACT, often
-- arriving from someone with no account at all (a STOP text, a hard bounce).
-- This is the per-account setting - "registrations yes, auction reminders no".
--
-- The absence of a row is not neutral, and the default differs by category:
-- transactional topics are allowed until switched off, promotional ones refused
-- until switched on. Nobody should have to opt in to hearing that their own
-- registration was approved.
CREATE TABLE "notification_preferences" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "person_id" char(26) NOT NULL,
  "topic" text NOT NULL,
  "channel" text NOT NULL,
  "allowed" boolean NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- One live answer per person, per topic, per channel. Changing your mind
-- UPDATES the row - unlike consent, this is a setting and not evidence, and the
-- evidence of the change lives in consent_records where it belongs.
CREATE UNIQUE INDEX "notification_pref_uq" ON "notification_preferences" ("person_id","topic","channel");
