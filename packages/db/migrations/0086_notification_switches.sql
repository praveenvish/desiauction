-- THE PLATFORM'S NOTIFICATION SWITCHES (Notification Control Center, Phase 1).
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- Phase 0 gave every send ONE gate (apps/web/src/server/messaging/gate.ts) and
-- a catalogue of every kind we send. Its admin layer was a hook that always
-- answered "on". These two tables are what it reads now: a platform admin's
-- decisions, made at /admin/notifications, published directly, audited in
-- audit_log (scope platform) and reversible from the same screen.
--
-- PLATFORM-LEVEL, NO org_id, NO RLS — the same shape as the demo and review
-- tables. A switch here is DesiAuction's, not a club's: there is no tenant to
-- scope it to. The web tier reads them on whatever handle the gate was given
-- and writes them on the app pool, which holds the DML through ALTER DEFAULT
-- PRIVILEGES (asserted by name in apps/web/scripts/verify-grants.ts).
--
-- ABSENCE IS THE CATALOGUE. No row means the kind is on, with the catalogue's
-- own controllability. So this migration changes nothing that is sent today,
-- and a row is only ever a DEPARTURE an admin chose and can see.

-- 1. One kind on one channel.
CREATE TABLE "notification_switches" (
  "kind" text NOT NULL,
  "channel" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  -- NULL = the catalogue's answer. FALSE = an admin took the switch away from
  -- people (or clubs). Never TRUE: see the check below.
  "person_controllable" boolean,
  "org_controllable" boolean,
  "reason" text,
  "updated_by" char(26),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_switches_pk" PRIMARY KEY ("kind", "channel"),
  CONSTRAINT "notification_switches_channel_check"
    CHECK ("channel" IN ('email', 'whatsapp', 'sms', 'in_app')),
  -- RESTRICT-ONLY. An override may stop people or clubs switching a kind off;
  -- it can never let them switch off something the catalogue locks (a security
  -- alert, a staff notice). "Give back the catalogue's answer" is NULL, so TRUE
  -- has no honest meaning and is refused outright.
  CONSTRAINT "notification_switches_restrict_only"
    CHECK ("person_controllable" IS NOT TRUE AND "org_controllable" IS NOT TRUE),
  -- LOGIN CODES ARE NEVER STOPPED (founder rule, 2026-09-23). The catalogue
  -- names every login kind `auth.*` (catalogue.test pins it), so the database
  -- refuses the row even if the code above it were wrong.
  CONSTRAINT "notification_switches_login_locked"
    CHECK ("kind" NOT LIKE 'auth.%' OR "enabled"),
  -- A SECURITY ALERT goes off only with a written reason (the same rule, the
  -- same prefix convention: every security kind is `security.*`).
  CONSTRAINT "notification_switches_security_reason"
    CHECK ("kind" NOT LIKE 'security.%' OR "enabled" OR char_length(btrim(coalesce("reason", ''))) >= 10),
  CONSTRAINT "notification_switches_reason_length"
    CHECK ("reason" IS NULL OR char_length("reason") <= 500)
);--> statement-breakpoint
-- Attribution, by 0069's convention: people are anonymized, never deleted, so
-- RESTRICT only makes the destructive alternative impossible by hand.
ALTER TABLE "notification_switches" ADD CONSTRAINT "notification_switches_updated_by_people_fk"
  FOREIGN KEY ("updated_by") REFERENCES "people" ("id") ON DELETE RESTRICT;--> statement-breakpoint

-- 2. A whole channel, everywhere — "WhatsApp off during a Meta incident".
--    Login codes still go on a killed channel (the gate decides them before it
--    reads this), and the admin screen says so where the switch is.
CREATE TABLE "notification_channels" (
  "channel" text PRIMARY KEY NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "reason" text,
  "updated_by" char(26),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notification_channels_channel_check"
    CHECK ("channel" IN ('email', 'whatsapp', 'sms', 'in_app')),
  CONSTRAINT "notification_channels_reason_length"
    CHECK ("reason" IS NULL OR char_length("reason") <= 500)
);--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_updated_by_people_fk"
  FOREIGN KEY ("updated_by") REFERENCES "people" ("id") ON DELETE RESTRICT;
