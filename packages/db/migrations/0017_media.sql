ALTER TABLE "competitions" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "photo_uploaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "logo_url" text;