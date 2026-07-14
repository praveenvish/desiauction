CREATE TABLE "auction_owner_invites" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"auction_id" char(26) NOT NULL,
	"team_id" char(26) NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" char(26) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by" char(26),
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auction_owner_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "paddle_grants" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"auction_id" char(26) NOT NULL,
	"team_id" char(26) NOT NULL,
	"person_id" char(26) NOT NULL,
	"granted_by" char(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "owner_invites_auction_idx" ON "auction_owner_invites" USING btree ("auction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paddle_grants_active_uq" ON "paddle_grants" USING btree ("auction_id","team_id","person_id") WHERE revoked_at is null;--> statement-breakpoint
CREATE INDEX "paddle_grants_auction_idx" ON "paddle_grants" USING btree ("auction_id");--> statement-breakpoint
CREATE INDEX "paddle_grants_person_idx" ON "paddle_grants" USING btree ("person_id");--> statement-breakpoint

-- RLS for the owner model (M-IP4-3). Org-scoped; read (USING) + write
-- (WITH CHECK) ship together (the RC-4 standing rule); fail CLOSED when unset.

ALTER TABLE "auction_owner_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auction_owner_invites" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY auction_owner_invites_tenant ON "auction_owner_invites"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "paddle_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "paddle_grants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY paddle_grants_tenant ON "paddle_grants"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));
