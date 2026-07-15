CREATE TABLE "journal_checkpoints" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"seq" integer NOT NULL,
	"digest" text NOT NULL,
	"bytes" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_legs" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"posting_id" char(26) NOT NULL,
	"leg_index" integer NOT NULL,
	"account" text NOT NULL,
	"direction" text NOT NULL,
	"amount" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_postings" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"event_seq" integer NOT NULL,
	"template" text NOT NULL,
	"case_id" char(26),
	"team_id" char(26),
	"source_stream" text NOT NULL,
	"source_seq" integer NOT NULL,
	"memo" text,
	"at_ms" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_cases" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"auction_id" char(26) NOT NULL,
	"competition_id" char(26) NOT NULL,
	"status" text DEFAULT 'opened' NOT NULL,
	"basis" text NOT NULL,
	"source_event_count" integer NOT NULL,
	"source_digest" text NOT NULL,
	"fold_digest" text,
	"created_by" char(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_events" (
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
CREATE TABLE "settlement_obligations" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"case_id" char(26) NOT NULL,
	"team_id" char(26) NOT NULL,
	"amount" bigint NOT NULL,
	"increased" bigint DEFAULT 0 NOT NULL,
	"reduced" bigint DEFAULT 0 NOT NULL,
	"discharged" bigint DEFAULT 0 NOT NULL,
	"waived" bigint DEFAULT 0 NOT NULL,
	"reinstated" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "journal_checkpoints_org_seq_uq" ON "journal_checkpoints" USING btree ("org_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_legs_posting_index_uq" ON "journal_legs" USING btree ("posting_id","leg_index");--> statement-breakpoint
CREATE INDEX "journal_legs_account_idx" ON "journal_legs" USING btree ("org_id","account");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_postings_org_event_uq" ON "journal_postings" USING btree ("org_id","event_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_postings_source_uq" ON "journal_postings" USING btree ("org_id","source_stream","source_seq");--> statement-breakpoint
CREATE INDEX "journal_postings_case_idx" ON "journal_postings" USING btree ("org_id","case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_cases_auction_live_uq" ON "settlement_cases" USING btree ("auction_id") WHERE status <> 'voided';--> statement-breakpoint
CREATE INDEX "settlement_cases_org_idx" ON "settlement_cases" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_events_stream_seq_uq" ON "settlement_events" USING btree ("stream_type","stream_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_events_command_uq" ON "settlement_events" USING btree ("stream_type","stream_id","command_id");--> statement-breakpoint
CREATE INDEX "settlement_events_stream_idx" ON "settlement_events" USING btree ("stream_type","stream_id");--> statement-breakpoint
CREATE INDEX "settlement_events_org_idx" ON "settlement_events" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_obligations_case_team_uq" ON "settlement_obligations" USING btree ("case_id","team_id");--> statement-breakpoint
CREATE INDEX "settlement_obligations_org_idx" ON "settlement_obligations" USING btree ("org_id");--> statement-breakpoint

-- RLS for settlement (IP-5, M-IP5-1). Org-scoped; read (USING) + write
-- (WITH CHECK) ship TOGETHER in the creating migration — the RC-4 standing rule,
-- applied at birth rather than patched in later. Policies fail CLOSED when
-- app.org_id is unset (current_setting(..., true) → NULL → zero rows, rejected
-- writes). No self-row disjunct exists on any settlement table: settlement has
-- no cross-org read shape, so there is nothing for a write check to inherit.

ALTER TABLE "settlement_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settlement_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY settlement_events_tenant ON "settlement_events"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "settlement_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settlement_cases" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY settlement_cases_tenant ON "settlement_cases"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "settlement_obligations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settlement_obligations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY settlement_obligations_tenant ON "settlement_obligations"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "journal_postings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_postings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY journal_postings_tenant ON "journal_postings"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "journal_legs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_legs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY journal_legs_tenant ON "journal_legs"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "journal_checkpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_checkpoints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY journal_checkpoints_tenant ON "journal_checkpoints"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));
