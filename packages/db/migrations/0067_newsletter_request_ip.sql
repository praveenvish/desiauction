-- THE NEWSLETTER'S ONE MISSING COLUMN.
--
-- HAND-AUTHORED, like 0019-0066: the drizzle snapshots stop at 0018.
--
-- Every other anonymous write in this product is throttled by counting its own
-- rows per network address (otp_codes, email_verifications, demo_requests). The
-- newsletter form could not be: its table had no address to count, so the limit
-- lived in process memory, which a restart forgets and a second instance never
-- shares. This gives it the same column the others have, so the limit becomes a
-- row count like theirs.
--
-- Throttling only. The address ages out after ninety days (the retention sweep
-- nulls it), exactly as the demo form's does.
ALTER TABLE "newsletter_subscribers" ADD COLUMN "request_ip" text;--> statement-breakpoint
CREATE INDEX "newsletter_subscribers_ip_idx"
  ON "newsletter_subscribers" ("request_ip", "created_at");--> statement-breakpoint
-- The retention sweep reads by age.
CREATE INDEX "newsletter_subscribers_created_idx" ON "newsletter_subscribers" ("created_at");
