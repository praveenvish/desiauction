-- THE PLATFORM HOLD: a way to take a public season page down.
--
-- HAND-AUTHORED, like 0019-0070: the drizzle snapshots stop at 0018. Numbered
-- 0072 because FR-1 claimed 0070 and 0071.
--
-- Anybody with an email can open a club and publish a season, and a published
-- season is on the open web: /c/[slug], its player pages, four share cards, the
-- directory, the sitemap, search engines. Until now nothing but the organizer
-- could take that down. The moderation desk (platform:moderation) sets this
-- hold; setting it also makes the season private, and the CHECK below keeps it
-- private for as long as the hold stands — whichever code path tries to publish.
--
-- Nothing is deleted. The club keeps running its season; the hold removes only
-- what strangers can read. Lifting it does not republish: the organizer
-- decides that again, deliberately.
ALTER TABLE "competitions" ADD COLUMN "platform_hold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "platform_hold_reason" text;--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "platform_hold_by" char(26);--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_platform_hold_by_people_id_fk"
  FOREIGN KEY ("platform_hold_by") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint
-- A hold always says why, and only a hold has a reason.
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_platform_hold_reason_check"
  CHECK (
    ("platform_hold_at" IS NULL) = ("platform_hold_reason" IS NULL)
    AND ("platform_hold_reason" IS NULL OR char_length("platform_hold_reason") BETWEEN 1 AND 500)
  );--> statement-breakpoint
-- The point of the column: a held season is never public.
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_platform_hold_private_check"
  CHECK ("platform_hold_at" IS NULL OR "visibility" = 'private');--> statement-breakpoint
-- The desk lists what is held; this keeps that a small read at any size.
CREATE INDEX "competitions_platform_hold_idx"
  ON "competitions" ("platform_hold_at") WHERE "platform_hold_at" IS NOT NULL;
