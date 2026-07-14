ALTER TABLE "registrations" ADD COLUMN "registration_number" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "team_id" char(26);--> statement-breakpoint
CREATE INDEX "registrations_number_idx" ON "registrations" USING btree ("registration_number");--> statement-breakpoint
CREATE INDEX "registrations_team_idx" ON "registrations" USING btree ("team_id");