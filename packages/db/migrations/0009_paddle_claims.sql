DROP INDEX "paddles_auction_team_uq";--> statement-breakpoint
ALTER TABLE "paddles" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "paddles_auction_team_active_uq" ON "paddles" USING btree ("auction_id","team_id") WHERE released_at is null;