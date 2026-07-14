CREATE TABLE "auction_events" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"auction_id" char(26) NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"at_ms" bigint NOT NULL,
	"actor" char(26) NOT NULL,
	"correlation_id" char(26) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auctions" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"competition_id" char(26) NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" char(26) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"auction_id" char(26) NOT NULL,
	"lot_id" char(26) NOT NULL,
	"paddle_id" char(26) NOT NULL,
	"amount" bigint NOT NULL,
	"status" text DEFAULT 'accepted' NOT NULL,
	"event_seq" integer NOT NULL,
	"placed_at_ms" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lots" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"auction_id" char(26) NOT NULL,
	"registration_id" char(26) NOT NULL,
	"lot_number" text NOT NULL,
	"seq" integer NOT NULL,
	"base_price" bigint NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"rounds_used" integer DEFAULT 0 NOT NULL,
	"ends_at_ms" bigint,
	"held_remaining_ms" bigint,
	"timer_extensions" integer DEFAULT 0 NOT NULL,
	"sold_to_paddle_id" char(26),
	"sold_price" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paddles" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"org_id" char(26) NOT NULL,
	"auction_id" char(26) NOT NULL,
	"team_id" char(26) NOT NULL,
	"person_id" char(26) NOT NULL,
	"paddle_number" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "auction_events_auction_seq_uq" ON "auction_events" USING btree ("auction_id","seq");--> statement-breakpoint
CREATE INDEX "auction_events_auction_idx" ON "auction_events" USING btree ("auction_id");--> statement-breakpoint
CREATE INDEX "auctions_org_idx" ON "auctions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "auctions_competition_idx" ON "auctions" USING btree ("competition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bids_auction_event_uq" ON "bids" USING btree ("auction_id","event_seq");--> statement-breakpoint
CREATE INDEX "bids_lot_idx" ON "bids" USING btree ("lot_id","event_seq");--> statement-breakpoint
CREATE INDEX "bids_auction_idx" ON "bids" USING btree ("auction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lots_auction_seq_uq" ON "lots" USING btree ("auction_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "lots_auction_number_uq" ON "lots" USING btree ("auction_id","lot_number");--> statement-breakpoint
CREATE UNIQUE INDEX "lots_auction_registration_uq" ON "lots" USING btree ("auction_id","registration_id");--> statement-breakpoint
CREATE INDEX "lots_auction_status_idx" ON "lots" USING btree ("auction_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "paddles_auction_team_uq" ON "paddles" USING btree ("auction_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paddles_auction_number_uq" ON "paddles" USING btree ("auction_id","paddle_number");--> statement-breakpoint
CREATE INDEX "paddles_auction_idx" ON "paddles" USING btree ("auction_id");--> statement-breakpoint

-- RLS for the Auction engine (M-IP4-1). Org-scoped; read (USING) + write
-- (WITH CHECK) ship together (the RC-4 standing rule); fail CLOSED when unset.

ALTER TABLE "auctions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auctions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY auctions_tenant ON "auctions"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "paddles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "paddles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY paddles_tenant ON "paddles"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "lots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY lots_tenant ON "lots"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "bids" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bids" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY bids_tenant ON "bids"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "auction_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auction_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY auction_events_tenant ON "auction_events"
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));
