CREATE TABLE "finops_cursors" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"stream_type" text NOT NULL,
	"stream_id" char(26) NOT NULL,
	"last_seq" integer NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finops_dispatches" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"channel" text NOT NULL,
	"recipient_ref" text NOT NULL,
	"template_id" text NOT NULL,
	"template_version" text NOT NULL,
	"subject_ref" text NOT NULL,
	"provider_ref" text,
	"provider_event_ref" text,
	"failure_code" text,
	"requested_by" char(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finops_documents" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"series_id" char(26) NOT NULL,
	"number" integer NOT NULL,
	"kind" text NOT NULL,
	"party_type" text NOT NULL,
	"party_id" text NOT NULL,
	"party_label" text NOT NULL,
	"amount" bigint NOT NULL,
	"corrects" char(26),
	"source_ref" text,
	"profile_seq" integer NOT NULL,
	"watermark" jsonb NOT NULL,
	"content_digest" text NOT NULL,
	"issued_at_seq" integer NOT NULL,
	"issued_by" char(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finops_events" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"stream_type" text NOT NULL,
	"stream_id" char(26) NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"at_ms" bigint NOT NULL,
	"actor" char(26) NOT NULL,
	"correlation_id" char(26) NOT NULL,
	"command_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finops_exports" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"kind" text NOT NULL,
	"params" jsonb NOT NULL,
	"requested_by" char(26) NOT NULL,
	"artifact_ref" text,
	"artifact_digest" text,
	"row_count" integer,
	"watermark" jsonb,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finops_jobs" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"not_before_ms" bigint NOT NULL,
	"leased_until_ms" bigint,
	"last_error" text,
	"payload" jsonb NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finops_period_days" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"period_id" char(26) NOT NULL,
	"date" text NOT NULL,
	"attestor" char(26) NOT NULL,
	"attestor_kind" text NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"checks" jsonb NOT NULL,
	"watermark" jsonb NOT NULL,
	"attested_at_seq" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finops_periods" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"fy" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_by" char(26) NOT NULL,
	"opening_watermark" jsonb NOT NULL,
	"last_watermark" jsonb NOT NULL,
	"evidence" jsonb,
	"closed_at_seq" integer,
	"open_exceptions" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finops_profiles" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"legal_name" text NOT NULL,
	"posture" text NOT NULL,
	"gstin" text,
	"auto_receipt" boolean DEFAULT false NOT NULL,
	"version" integer NOT NULL,
	"declared_by" char(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finops_profiles_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "finops_schedules" (
	"slot" text PRIMARY KEY NOT NULL,
	"next_due_ms" bigint NOT NULL,
	"last_fired_ms" bigint
);
--> statement-breakpoint
CREATE TABLE "finops_series" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"kind" text NOT NULL,
	"fy" text NOT NULL,
	"prefix" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"document_count" integer DEFAULT 0 NOT NULL,
	"register_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "finops_cursors_stream_uq" ON "finops_cursors" USING btree ("org_id","stream_type","stream_id");--> statement-breakpoint
CREATE INDEX "finops_cursors_org_idx" ON "finops_cursors" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "finops_dispatches_org_idx" ON "finops_dispatches" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finops_documents_series_number_uq" ON "finops_documents" USING btree ("series_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "finops_documents_source_uq" ON "finops_documents" USING btree ("series_id","source_ref") WHERE source_ref is not null;--> statement-breakpoint
CREATE INDEX "finops_documents_org_idx" ON "finops_documents" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finops_events_stream_seq_uq" ON "finops_events" USING btree ("stream_type","stream_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "finops_events_command_uq" ON "finops_events" USING btree ("stream_type","stream_id","command_id");--> statement-breakpoint
CREATE INDEX "finops_events_stream_idx" ON "finops_events" USING btree ("stream_type","stream_id");--> statement-breakpoint
CREATE INDEX "finops_events_org_idx" ON "finops_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "finops_exports_org_idx" ON "finops_exports" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finops_jobs_dedupe_uq" ON "finops_jobs" USING btree ("org_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "finops_jobs_claim_idx" ON "finops_jobs" USING btree ("state","not_before_ms");--> statement-breakpoint
CREATE INDEX "finops_jobs_org_idx" ON "finops_jobs" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finops_period_days_date_uq" ON "finops_period_days" USING btree ("period_id","date");--> statement-breakpoint
CREATE INDEX "finops_period_days_org_idx" ON "finops_period_days" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finops_periods_org_fy_uq" ON "finops_periods" USING btree ("org_id","fy");--> statement-breakpoint
CREATE INDEX "finops_periods_org_idx" ON "finops_periods" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finops_series_key_uq" ON "finops_series" USING btree ("org_id","kind","fy");--> statement-breakpoint
CREATE INDEX "finops_series_org_idx" ON "finops_series" USING btree ("org_id");
-- RLS for financial operations (IP-6, M-IP6-1). Org-scoped; read (USING) +
-- write (WITH CHECK) ship TOGETHER in the creating migration — the RC-4
-- standing rule, applied at birth. Policies fail CLOSED when app.org_id is
-- unset (current_setting(..., true) → NULL → zero rows, rejected writes). No
-- self-row disjunct exists on any finops table. finops_schedules is the ONE
-- deliberate exception: it holds platform schedule slots (slot names + epoch
-- instants), ZERO tenant rows — there is nothing tenant-scoped to guard.

ALTER TABLE "finops_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finops_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY finops_events_tenant ON "finops_events"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "finops_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finops_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY finops_profiles_tenant ON "finops_profiles"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "finops_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finops_series" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY finops_series_tenant ON "finops_series"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "finops_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finops_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY finops_documents_tenant ON "finops_documents"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "finops_dispatches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finops_dispatches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY finops_dispatches_tenant ON "finops_dispatches"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "finops_exports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finops_exports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY finops_exports_tenant ON "finops_exports"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "finops_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finops_periods" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY finops_periods_tenant ON "finops_periods"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "finops_period_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finops_period_days" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY finops_period_days_tenant ON "finops_period_days"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "finops_cursors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finops_cursors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY finops_cursors_tenant ON "finops_cursors"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "finops_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finops_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY finops_jobs_tenant ON "finops_jobs"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));
