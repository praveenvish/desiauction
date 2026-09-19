-- PERSONAL MESSAGES BY SMS (Phase 2): the queue carries a text as well as a mail.
--
-- Most players sign up by phone and never verify an email, so a sale told only
-- by email reaches the minority. The big moments — bought, named captain — also
-- go out as ONE line of SMS on a DLT-registered template.
--
-- An SMS row is not a rendered message: under DLT the operator holds the fixed
-- text, and the gateway is given the template and its SLOTS. So the row keeps
-- `template_key` + `slots`, and `body_text` holds the local render for the dev
-- inbox and for whoever reads the row. `subject` and `body_html` carry nothing
-- for a text and are written as empty strings, keeping the email columns NOT
-- NULL for the email rows that need them.
ALTER TABLE "message_outbox" DROP CONSTRAINT IF EXISTS "message_outbox_channel_check";--> statement-breakpoint
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_channel_check"
  CHECK ("channel" IN ('email', 'sms'));--> statement-breakpoint
ALTER TABLE "message_outbox" ADD COLUMN IF NOT EXISTS "template_key" text;--> statement-breakpoint
ALTER TABLE "message_outbox" ADD COLUMN IF NOT EXISTS "slots" jsonb;--> statement-breakpoint
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_sms_template_check"
  CHECK ("channel" <> 'sms' OR ("template_key" IS NOT NULL AND "slots" IS NOT NULL));
--> statement-breakpoint
-- ONE ANSWER PER TOPIC, ON EVERY CHANNEL.
--
-- The account's "Auction updates" switch (and the club's per-topic switch) was
-- written for SMS alone, because SMS was all this product sent. The personal
-- emails (0079) are gated on the EMAIL row, which nobody could set, so a person
-- who had switched Auction updates off still got the emails. The switches now
-- write both channels; this carries every answer already given across to email,
-- so a "no" said before today still means no. Ids are fresh 26-character keys.
INSERT INTO "notification_preferences" ("id", "person_id", "topic", "channel", "allowed", "updated_at")
SELECT upper(substr(md5(random()::text || "id"), 1, 26)), "person_id", "topic", 'email', "allowed", now()
FROM "notification_preferences" WHERE "channel" = 'sms'
ON CONFLICT ("person_id", "topic", "channel") DO NOTHING;--> statement-breakpoint
INSERT INTO "org_messaging_settings" ("id", "org_id", "topic", "channel", "enabled", "updated_at", "updated_by")
SELECT upper(substr(md5(random()::text || "id"), 1, 26)), "org_id", "topic", 'email', "enabled", now(), "updated_by"
FROM "org_messaging_settings" WHERE "channel" = 'sms'
ON CONFLICT ("org_id", "topic", "channel") DO NOTHING;
