ALTER TABLE "registrations" ADD COLUMN "is_retained" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "is_vice_captain" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "date_of_birth" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "batting_style" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "bowling_style" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "father_name" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "jersey_name" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "jersey_number" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "tshirt_size" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "trouser_size" text;