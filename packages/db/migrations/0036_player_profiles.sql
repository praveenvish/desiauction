-- THE PERSON'S DURABLE CRICKET IDENTITY (PI-1, phase P1).
--
-- HAND-AUTHORED, like 0019-0035: the drizzle snapshots stop at 0018.
--
-- Until now "player profile" meant columns on `registrations` (0018) — a
-- per-season fact re-entered every season. This table is the person-level
-- source of DEFAULTS: the register wizard prefills from it, the chosen values
-- still land on the registration as that season's snapshot, and editing a
-- profile never rewrites history. The auction pool keeps reading registrations
-- alone; nothing in the certified boundary gains a new reader or writer.
--
-- GENDER, MODELED ONCE. NULL means the question was never put to this person;
-- 'unspecified' means it was, and they declined — two different absences a
-- reader must be able to tell apart. Never inferred, never an authorization
-- input, never rendered on an org-facing or public surface. The single
-- decision consumer is core's eligibility engine (PI-1 P3).
--
-- NO RLS, deliberately: like people, sessions and consent_records, this is
-- between the platform and a person, not a club. App-layer self-scoping is the
-- lock, held by a person-isolation regression test (the sessions pattern).
--
-- DPDP (inventory amended in this change): every column is optional,
-- self-declared, collected on the person's own account/profile surfaces.
-- Erasure = the row is nulled alongside `people` anonymization.

CREATE TABLE "player_profiles" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "person_id" char(26) NOT NULL,
  "gender" text,
  "gender_self_described" text,
  "date_of_birth" text,
  "location" text,
  "default_role" text,
  "default_batting_style" text,
  "default_bowling_style" text,
  "preferred_jersey_name" text,
  "preferred_jersey_number" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- One profile per person. A second write is an update, never a second row.
CREATE UNIQUE INDEX "player_profiles_person_uq" ON "player_profiles" ("person_id");--> statement-breakpoint

-- The enum walls. Text + CHECK, as everywhere else (no pg enums in this
-- schema): an unknown value is refused by the database, not merely by the
-- validator in front of it.
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_gender_check"
  CHECK ("gender" IS NULL OR "gender" IN ('male', 'female', 'non_binary', 'self_described', 'unspecified'));--> statement-breakpoint

ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_role_check"
  CHECK ("default_role" IS NULL OR "default_role" IN ('batter', 'bowler', 'all_rounder', 'wicket_keeper'));--> statement-breakpoint

-- Length walls for the free-text fields, so a pasted essay cannot bloat a row
-- the account page reads on every visit (the 0034 note-length precedent).
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_self_described_length_check"
  CHECK ("gender_self_described" IS NULL OR length("gender_self_described") <= 40);--> statement-breakpoint

ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_location_length_check"
  CHECK ("location" IS NULL OR length("location") <= 80);--> statement-breakpoint

ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_jersey_name_length_check"
  CHECK ("preferred_jersey_name" IS NULL OR length("preferred_jersey_name") <= 30);--> statement-breakpoint

-- ADDITIVE AND BACKWARDS COMPATIBLE. A rollback to the previous build leaves
-- the table unread rather than broken. GRANTS: the app role reaches it via the
-- 0018-era DEFAULT PRIVILEGES; the system role via its own default SELECT; the
-- enumerated engine/runner roles never touch it (re-run of
-- ops/db/create-app-role.sql per its header keeps their snapshot SELECT
-- current, as after every migration).
COMMENT ON TABLE "player_profiles" IS
  'Person-level cricket identity (PI-1): source of registration defaults, never the per-season record of fact.';
