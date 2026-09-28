-- EVERY EMAIL WE SEND DIRECTLY, RECORDED (email programme PR2).
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- The personal-message queue (message_outbox, 0079) is a record of every mail
-- it delivers. The DIRECT sends were not: a sign-in code, a security warning,
-- a demo booking, a review request and a problem-report receipt went straight
-- to the provider and left nothing behind, so "did that person get our mail?"
-- had no answer and a bounce had nothing to attach to. This is that record.
--
-- A LEDGER, NOT A COPY. No subject, no body, no address. A sign-in code must
-- never sit in a table, and nothing here needs the words: the kind says what
-- was sent. The person (when there is an account) says to whom; the recipient's
-- DOMAIN alone ("gmail.com") is kept so deliverability can be read per mailbox
-- provider without holding anybody's address. The provider's message id is
-- what a delivery or bounce callback will be matched on.
--
-- PLATFORM-LEVEL, NO org_id POLICY, NO RLS — the demo and review tables' shape:
-- most of these mails belong to no club (a code, a demo visitor), so there is
-- no tenant to scope them to. Written on the app pool, which holds the DML
-- through ALTER DEFAULT PRIVILEGES (asserted by name in
-- apps/web/scripts/verify-grants.ts). Deleted with the outbox's keys after a
-- year (support/report-retention.ts); a person's rows go at erasure (SET NULL
-- keeps the count, loses the person).

CREATE TABLE "email_sends" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "person_id" char(26),
  "org_id" char(26),
  "recipient_domain" text NOT NULL,
  "outcome" text NOT NULL,
  -- Why the gate withheld it, when it did.
  "reason" text,
  "provider_message_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "email_sends_outcome_check"
    CHECK ("outcome" IN ('sent', 'suppressed', 'failed', 'unconfigured', 'breaker-open')),
  CONSTRAINT "email_sends_domain_length" CHECK (char_length("recipient_domain") <= 255),
  CONSTRAINT "email_sends_reason_length" CHECK ("reason" IS NULL OR char_length("reason") <= 200)
);--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_person_id_people_fk"
  FOREIGN KEY ("person_id") REFERENCES "people" ("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "email_sends_provider_message_uq" ON "email_sends" ("provider_message_id")
  WHERE "provider_message_id" IS NOT NULL;--> statement-breakpoint
-- The admin counts read a window by kind and outcome, like the outbox's (0089).
CREATE INDEX "email_sends_window_idx" ON "email_sends" ("created_at", "kind", "outcome");--> statement-breakpoint
CREATE INDEX "email_sends_person_idx" ON "email_sends" ("person_id") WHERE "person_id" IS NOT NULL;--> statement-breakpoint

-- A switch turned off from a mail's one-click unsubscribe (RFC 8058) is
-- recorded as what it is, not as a change "in account settings". Widening
-- only, as 0085 did: every existing row still satisfies the new set.
ALTER TABLE "consent_records" DROP CONSTRAINT "consent_records_source_check";--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_source_check"
  CHECK ("source" IN ('registration','account','sms_stop','sms_start','whatsapp_stop','whatsapp_start','email_unsubscribe','import','support','login')) NOT VALID;--> statement-breakpoint
ALTER TABLE "consent_records" VALIDATE CONSTRAINT "consent_records_source_check";
