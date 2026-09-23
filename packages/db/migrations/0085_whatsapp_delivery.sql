-- WHATSAPP BECOMES THE TEXT CHANNEL (founder decision 2026-09-23).
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- SMS/DLT is deferred; personal messages and login codes go on WhatsApp via
-- Meta's Cloud API. Meta answers a send with a message id (`wamid`) and then
-- reports what became of it — sent, delivered, read, failed — to OUR callback
-- URL, minutes later. Until now the id was thrown away, so a message the phone
-- never received looked exactly like one it did. This keeps the id and what
-- Meta says about it.
--
-- 1. The outbox row remembers the provider's id and Meta's latest word on it.
--    Status only moves forward (sent → delivered → read, or → failed); the
--    webhook enforces that order, because Meta may deliver callbacks out of it.
ALTER TABLE "message_outbox" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "message_outbox" ADD COLUMN "delivery_status" text;--> statement-breakpoint
ALTER TABLE "message_outbox" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_outbox" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_outbox" ADD COLUMN "delivery_error" text;--> statement-breakpoint
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_delivery_status_check"
  CHECK ("delivery_status" IS NULL OR "delivery_status" IN ('sent', 'delivered', 'read', 'failed'));--> statement-breakpoint
-- The webhook finds its row by the provider's id; one id is one message.
CREATE UNIQUE INDEX "message_outbox_provider_message_uq"
  ON "message_outbox" ("provider_message_id") WHERE "provider_message_id" IS NOT NULL;--> statement-breakpoint

-- 2. What people send US. Meta retries a callback until it gets a 200, so the
--    same "STOP" can arrive more than once; one row per inbound message id makes
--    handling it idempotent, and is the record of what was asked and when. The
--    body is not kept — only the keyword it was read as. Swept after ninety days.
CREATE TABLE "whatsapp_inbound" (
  "provider_message_id" text PRIMARY KEY NOT NULL,
  "phone" text NOT NULL,
  "intent" text NOT NULL,
  "person_id" char(26),
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_inbound_intent_check" CHECK ("intent" IN ('stop', 'start', 'unknown'))
);--> statement-breakpoint
ALTER TABLE "whatsapp_inbound" ADD CONSTRAINT "whatsapp_inbound_person_fk"
  FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX "whatsapp_inbound_received_idx" ON "whatsapp_inbound" ("received_at");--> statement-breakpoint

-- 3. Personal data the service roles never read (0083's rule, for the new table).
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['desiauction_engine', 'desiauction_runner'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON whatsapp_inbound FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
