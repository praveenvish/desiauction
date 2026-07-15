CREATE TABLE "payments" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"case_id" char(26) NOT NULL,
	"team_id" char(26) NOT NULL,
	"method" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"amount" bigint NOT NULL,
	"captured" bigint DEFAULT 0 NOT NULL,
	"refunded_total" bigint DEFAULT 0 NOT NULL,
	"attested" boolean DEFAULT false NOT NULL,
	"attested_by" char(26),
	"provider_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "payments_org_idx" ON "payments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "payments_case_idx" ON "payments" USING btree ("case_id");--> statement-breakpoint

-- RLS for the payments projection (IP-5, M-IP5-2). Org-scoped; read (USING) +
-- write (WITH CHECK) ship together (the RC-4 standing rule); fail CLOSED when
-- app.org_id is unset. No self-row disjunct — settlement has no cross-org read shape.

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payments_tenant ON "payments"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));
