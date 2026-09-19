-- PERSONAL MESSAGES — the send queue (launch: player & owner moments).
--
-- A finished auction tells ninety players and every owner what happened to
-- them, by email where they have a verified address. Sending that inline would
-- put ninety provider calls on the request that closed the auction, and lose
-- whatever a restart interrupted. So every message is WRITTEN here first —
-- rendered, immutable, once — and a drain delivers it, retrying with backoff.
--
-- `dedupe_key` is the at-most-once rule: one key per person per moment (a sale,
-- an appointment to a role on a team), so a retried completion or a second
-- "Announce" press never sends the same moment twice.
--
-- No org_id arm and no RLS, like otp_codes and the review tables: a platform
-- queue keyed by person, written inside the product's own actions and drained
-- by a platform job. Its content is personal (a name, a price), so erasure
-- deletes a person's rows and the retention job purges delivered ones.
CREATE TABLE IF NOT EXISTS "message_outbox" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "person_id" char(26) NOT NULL,
  "org_id" char(26),
  "kind" text NOT NULL,
  "channel" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "subject" text NOT NULL,
  "body_text" text NOT NULL,
  "body_html" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "message_outbox_channel_check" CHECK ("channel" IN ('email')),
  CONSTRAINT "message_outbox_status_check"
    CHECK ("status" IN ('pending', 'sent', 'failed', 'suppressed'))
);--> statement-breakpoint
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_person_fk"
  FOREIGN KEY ("person_id") REFERENCES "people" ("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_outbox_dedupe_uq" ON "message_outbox" ("dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_outbox_due_idx"
  ON "message_outbox" ("next_attempt_at") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_outbox_person_idx" ON "message_outbox" ("person_id");
