-- Consent and suppression: the two records we must hold before sending a
-- message to a person, and the one that says we must not.
--
-- HAND-AUTHORED, deliberately. `db:generate` cannot be trusted in this repo:
-- the drizzle snapshots stop at 0018 while the migrations run to 0021, so a
-- generated diff is computed against a schema four migrations stale and emits
-- statements that are wrong in both directions.
--
-- NO ROW LEVEL SECURITY on either table, and that is not an omission. Every
-- RLS policy here is org-scoped (`org_id = current_setting('app.org_id')`).
-- Consent is between the platform and a person, and a suppression is a fact
-- about a phone number or an email address — neither belongs to a club, and a
-- STOP must hold across every organization on the platform. These follow
-- `people`, `sessions` and `otp_codes`, the identity tables, which carry no
-- tenant policy either.

-- What a person agreed to, and when. APPEND-ONLY: a withdrawal is a new row
-- with granted = false, never an update, because "had they agreed at the moment
-- we sent it?" is a question about the past and a mutable row cannot answer it.
CREATE TABLE "consent_records" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "person_id" char(26) NOT NULL,
  "purpose" text NOT NULL,
  "granted" boolean NOT NULL,
  "source" text NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "request_ip" text,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX "consent_person_idx" ON "consent_records" ("person_id","purpose","created_at");--> statement-breakpoint

-- Addresses we must not send to. Keyed by the CONTACT rather than a person: a
-- STOP arrives from a phone number and a bounce from an email address, neither
-- of which necessarily maps to an account, and both must be honoured anyway.
-- `lifted_at` rather than a delete, so a reversed STOP keeps its evidence.
CREATE TABLE "suppressions" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "contact" text NOT NULL,
  "channel" text NOT NULL,
  "scope" text DEFAULT 'global' NOT NULL,
  "reason" text NOT NULL,
  "lifted_at" timestamp with time zone,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- The read every send performs, in the order it asks: is this contact
-- suppressed on this channel, for this scope, right now.
CREATE INDEX "suppressions_contact_idx" ON "suppressions" ("contact","channel","scope");
