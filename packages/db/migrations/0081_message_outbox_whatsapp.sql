-- PERSONAL MESSAGES ON WHATSAPP (Phase 3).
--
-- A player who opts in to WhatsApp gets the short message there INSTEAD of by
-- SMS (founder decision): the same moment, one ping, with the player card as
-- the picture on a sale. The row is still queued as a text; the drain decides
-- at send time — opted in and a WhatsApp template configured, or not — and
-- records the channel it actually went out on, so `channel = 'whatsapp'` is a
-- fact about delivery, never a plan.
--
-- `media_url` is the picture a WhatsApp template's image header shows (the
-- player card for a public, adult player; the brand card otherwise). SMS
-- ignores it.
ALTER TABLE "message_outbox" DROP CONSTRAINT IF EXISTS "message_outbox_channel_check";--> statement-breakpoint
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_channel_check"
  CHECK ("channel" IN ('email', 'sms', 'whatsapp'));--> statement-breakpoint
ALTER TABLE "message_outbox" DROP CONSTRAINT IF EXISTS "message_outbox_sms_template_check";--> statement-breakpoint
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_sms_template_check"
  CHECK ("channel" = 'email' OR ("template_key" IS NOT NULL AND "slots" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "message_outbox" ADD COLUMN IF NOT EXISTS "media_url" text;
