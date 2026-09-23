-- EDITABLE EMAIL WORDING, AND ONE LANGUAGE PER PERSON (Notification Control
-- Center, Phase 2).
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- 1. notification_templates — what a platform admin wrote for one kind of
--    email, in one language, at one version.
--
-- The CODE DEFAULTS are not rows. Every email kind ships its English and Hindi
-- wording in packages/messaging (email-template-defaults.ts); a row here is only
-- ever a DEPARTURE an admin chose, exactly like 0086's switches. So this
-- migration changes nothing that is sent today, and "Reset to default" is
-- archiving the published row, not writing the default back.
--
-- VERSIONED, NEVER EDITED IN PLACE once published. A publish writes a new
-- version and archives the one before; a restore publishes a COPY of an old
-- version under a new number. The history is the rows, and every publish,
-- restore and reset is also on audit_log (scope platform) with who and why.
--
-- PLATFORM-LEVEL, NO org_id, NO RLS — the same shape as 0086. Wording belongs
-- to DesiAuction; clubs never edit it (founder decision, 2026-09-23). Written
-- on the app pool from /admin/notifications/[kind]/email; read by every email
-- send in the web tier and — for receipts, invoices and corrections — by the
-- finops runner, which sends those.
CREATE TABLE "notification_templates" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  -- Email now. In-app wording is the next channel to move here; WhatsApp and
  -- SMS text is Meta- and DLT-approved and never free-editable.
  "channel" text DEFAULT 'email' NOT NULL,
  "language" text NOT NULL,
  "version" integer NOT NULL,
  "status" text NOT NULL,
  -- { "variants": { "<variant>": { subject, preheader, heading, paragraphs,
  -- after, actions, footnote } } } — validated by the same rules at save, at
  -- publish and again at render (a row that fails at render falls back to the
  -- code default, so an email is never blank or broken).
  "content" jsonb NOT NULL,
  "note" text,
  "created_by" char(26) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "published_by" char(26),
  "published_at" timestamp with time zone,
  CONSTRAINT "notification_templates_channel_check" CHECK ("channel" IN ('email', 'in_app')),
  CONSTRAINT "notification_templates_language_check" CHECK ("language" IN ('en', 'hi')),
  CONSTRAINT "notification_templates_status_check"
    CHECK ("status" IN ('draft', 'published', 'archived')),
  CONSTRAINT "notification_templates_version_positive" CHECK ("version" >= 1),
  -- A published row says who published it and when; a draft says neither.
  CONSTRAINT "notification_templates_published_stamp"
    CHECK ("status" = 'draft' OR ("published_by" IS NOT NULL AND "published_at" IS NOT NULL)),
  CONSTRAINT "notification_templates_note_length"
    CHECK ("note" IS NULL OR char_length("note") <= 500),
  CONSTRAINT "notification_templates_version_unique" UNIQUE ("kind", "channel", "language", "version")
);--> statement-breakpoint
-- AT MOST ONE LIVE WORDING per kind, channel and language — the one every send
-- reads. Two published rows would make "which one goes out" an accident of
-- scan order.
CREATE UNIQUE INDEX "notification_templates_one_published"
  ON "notification_templates" ("kind", "channel", "language")
  WHERE "status" = 'published';--> statement-breakpoint
-- And at most one draft: "Save draft" keeps editing the same one.
CREATE UNIQUE INDEX "notification_templates_one_draft"
  ON "notification_templates" ("kind", "channel", "language")
  WHERE "status" = 'draft';--> statement-breakpoint
-- Attribution, by 0069's convention: people are anonymized, never deleted, so
-- RESTRICT only makes the destructive alternative impossible by hand.
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_created_by_people_fk"
  FOREIGN KEY ("created_by") REFERENCES "people" ("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_published_by_people_fk"
  FOREIGN KEY ("published_by") REFERENCES "people" ("id") ON DELETE RESTRICT;--> statement-breakpoint

-- 2. people.language — ONE language for everything we send a person.
--
-- Email and WhatsApp both read it (packages/messaging language.ts). NULL means
-- "never chosen", which is not the same as English: until somebody chooses
-- here, the language they picked with their WhatsApp opt-in (consent_records
-- evidence, 0081) still decides, and only then English. Set from /account's
-- "Language for messages" and from the registration form.
ALTER TABLE "people" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_language_check"
  CHECK ("language" IS NULL OR "language" IN ('en', 'hi'));--> statement-breakpoint

-- 3. THE ENGINE NEVER READS WORDING. Default privileges hand every runtime role
--    SELECT on a new table; the auction engine sends nothing and folds nothing
--    from this one, so it gives the read back (0083's reasoning, and its guard:
--    on a fresh database the roles do not exist yet, and the role recipe
--    carries the same revoke). The RUNNER keeps it: it sends receipts, and a
--    receipt's subject and opening line are wording an admin may have edited.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'desiauction_engine') THEN
    EXECUTE 'REVOKE ALL ON notification_templates FROM desiauction_engine';
  END IF;
END $$;
