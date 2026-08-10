-- What a CLUB chooses to tell its people, per topic and per channel.
--
-- HAND-AUTHORED for the same reason as 0022 and 0023: the drizzle snapshots stop
-- at 0018 while the migrations run past 0023, so `db:generate` diffs against a
-- stale schema and emits statements wrong in both directions.
--
-- The third and last layer of the send gate, and the only one that is a TENANT's
-- decision rather than a person's:
--
--   suppressions            a hard stop keyed by a contact (a STOP, a bounce)
--   notification_preferences what one person wants told to them
--   org_messaging_settings   what this club sends at all            <- this
--
-- All three can only ever REMOVE a message. None of them can cause one, and an
-- organizer switching a topic on cannot override a person who switched it off —
-- the person's answer is checked first and independently. That ordering is the
-- whole reason this is a separate table rather than a column on the preference:
-- a club must never be able to write into a person's consent.
--
-- ROW LEVEL SECURITY, unlike the two tables above. Those are platform-to-person
-- and belong to no club; this row IS owned by an org, so it takes the same
-- org-scoped policy as every other tenant table.
--
-- Absence means ON. A club that has never opened this screen keeps sending the
-- decision notices it sends today — a new table must not silently mute a
-- product that was already talking to people.
CREATE TABLE "org_messaging_settings" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "org_id" char(26) NOT NULL,
  "topic" text NOT NULL,
  "channel" text NOT NULL,
  "enabled" boolean NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" char(26)
);--> statement-breakpoint

-- One live answer per club, per topic, per channel. A setting, not evidence —
-- the audit of who changed it lives in audit_log where the rest of the org's
-- administrative history already is.
CREATE UNIQUE INDEX "org_messaging_settings_uq" ON "org_messaging_settings" ("org_id","topic","channel");--> statement-breakpoint

ALTER TABLE "org_messaging_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_messaging_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_messaging_settings_tenant ON "org_messaging_settings"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));
