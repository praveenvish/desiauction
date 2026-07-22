ALTER TABLE "registrations" ADD COLUMN "is_icon" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "is_captain" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "coach_name" text;