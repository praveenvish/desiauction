-- WHATSAPP AND SMS TEMPLATE MAPPING, AND META'S APPROVAL STATUS
-- (Notification Control Center, Phase 3).
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- A WhatsApp message can only go out under a template Meta has APPROVED, by
-- name and language; an SMS only under a DLT-registered template id. Until now
-- each name/id lived in an env var per kind (WHATSAPP_TEMPLATE_<KEY>,
-- MSG91_TEMPLATE_<KEY>), so pointing a moment at a newly approved template was
-- a deploy. These tables make it an admin decision at
-- /admin/notifications/templates. The TEXT is still not editable: Meta only
-- sends what it approved, and the code (whatsapp.ts) is what gets submitted.
--
-- PLATFORM-LEVEL, NO org_id, NO RLS — the shape of 0086/0087. Written on the
-- app pool (DML through ALTER DEFAULT PRIVILEGES, asserted by name in
-- apps/web/scripts/verify-grants.ts), audited on the system pool.
--
-- ABSENCE IS THE ENV VAR. No mapping row means the send reads the env var it
-- read yesterday, so this migration changes nothing that is sent today.

-- 1. Which approved template each kind uses, per text channel.
CREATE TABLE "provider_template_mappings" (
  "kind" text NOT NULL,
  "channel" text NOT NULL,
  -- WhatsApp: the name Meta approved (one name holds every language version).
  "provider_template_name" text,
  -- SMS: the DLT template id MSG91 sends against.
  "provider_template_id" text,
  -- The language versions this name is approved in. A reader in a language
  -- not listed gets the first one listed instead of a 132001 refusal.
  "languages" text[] DEFAULT ARRAY['en', 'hi']::text[] NOT NULL,
  "note" text,
  "updated_by" char(26),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "provider_template_mappings_pk" PRIMARY KEY ("kind", "channel"),
  CONSTRAINT "provider_template_mappings_channel_check"
    CHECK ("channel" IN ('whatsapp', 'sms')),
  -- Exactly the handle the channel needs, and never the other one.
  CONSTRAINT "provider_template_mappings_handle_check"
    CHECK (
      ("channel" = 'whatsapp' AND "provider_template_name" IS NOT NULL AND "provider_template_id" IS NULL)
      OR ("channel" = 'sms' AND "provider_template_id" IS NOT NULL AND "provider_template_name" IS NULL)
    ),
  -- Meta's own rule for a template name. The length is its own test: a
  -- regex bound above 255 is refused by Postgres ("invalid repetition count").
  CONSTRAINT "provider_template_mappings_name_format"
    CHECK ("provider_template_name" IS NULL OR (
      "provider_template_name" ~ '^[a-z0-9_]+$' AND char_length("provider_template_name") <= 512
    )),
  CONSTRAINT "provider_template_mappings_id_format"
    CHECK ("provider_template_id" IS NULL OR (
      "provider_template_id" ~ '^[A-Za-z0-9_-]+$' AND char_length("provider_template_id") <= 64
    )),
  CONSTRAINT "provider_template_mappings_languages_check"
    CHECK (cardinality("languages") >= 1 AND "languages" <@ ARRAY['en', 'hi']::text[]),
  -- LOGIN IS ENV-MANAGED. The sign-in code's template decides whether anybody
  -- can sign in, so it is never moved from a screen (WHATSAPP_TEMPLATE_NAME,
  -- MSG91_TEMPLATE_ID); every login kind is `auth.*` (catalogue.test).
  CONSTRAINT "provider_template_mappings_login_locked"
    CHECK ("kind" NOT LIKE 'auth.%'),
  CONSTRAINT "provider_template_mappings_note_length"
    CHECK ("note" IS NULL OR char_length("note") <= 500)
);--> statement-breakpoint
ALTER TABLE "provider_template_mappings" ADD CONSTRAINT "provider_template_mappings_updated_by_people_fk"
  FOREIGN KEY ("updated_by") REFERENCES "people" ("id") ON DELETE RESTRICT;--> statement-breakpoint

-- 2. What Meta last said about each template, per language.
--
-- A SNAPSHOT, replaced whole by each successful sync, and not kept in memory:
-- the grid's chip and the scheduled sync must agree across every web process
-- and survive a restart, and the six-hourly sync decides "is it stale?" from
-- the stored time. A submission writes its row at once (source 'submitted'),
-- so a template sent for approval shows PENDING before the next sync.
CREATE TABLE "provider_template_status" (
  "name" text NOT NULL,
  "language" text NOT NULL,
  "status" text NOT NULL,
  "category" text,
  "quality" text,
  "rejected_reason" text,
  "meta_id" text,
  "source" text DEFAULT 'sync' NOT NULL,
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "provider_template_status_pk" PRIMARY KEY ("name", "language"),
  CONSTRAINT "provider_template_status_source_check"
    CHECK ("source" IN ('sync', 'submitted'))
);--> statement-breakpoint

-- 3. The sync itself: when it was last tried, when it last worked, and why not.
--    One row per provider. Its `last_attempt_at` is the rate limit on "Refresh
--    from Meta", shared by every web process.
CREATE TABLE "provider_template_syncs" (
  "provider" text PRIMARY KEY NOT NULL,
  "last_attempt_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "last_error" text,
  "template_count" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "provider_template_syncs_provider_check" CHECK ("provider" IN ('whatsapp'))
);--> statement-breakpoint

-- 4. ONLY THE WEB TIER SENDS WHATSAPP AND SMS. Default privileges hand every
--    runtime role SELECT on a new table; the engine sends nothing and the
--    finops runner sends receipts by email and in-app only, so both give the
--    read back (0083's reasoning and guard: on a fresh database the roles do
--    not exist yet, and the role recipe carries the same revoke).
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['desiauction_engine', 'desiauction_runner'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON provider_template_mappings, provider_template_status, '
        'provider_template_syncs FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END $$;
