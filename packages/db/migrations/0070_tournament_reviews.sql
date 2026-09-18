/*
 * HOW WAS THE SEASON? (FR-1 Phase 4 — tournament reviews.)
 *
 * HAND-AUTHORED. NUMBERED 0070 because a parallel branch holds 0066–0069 and
 * the shared local database has applied them; 0070/0071 were claimed for this
 * branch by message to that session. Journal `when` = 1789747200000, after its
 * 0069.
 *
 * 0065 pinned `subject_type` to 'platform' so this could widen a constraint
 * instead of reshaping tables that already hold people's words. It does:
 *
 *   · A request and a review may now be about a COMPETITION. Such a row names
 *     the competition, its org (denormalised for the desk and the public page),
 *     and the ROLE the person had in it — player or team owner — which is what
 *     the public page signs an unnamed review with ("A team owner").
 *   · One ask per person per SUBJECT: one platform ask ever, and one per season.
 *     The single unique index becomes two partial ones.
 *   · An organizer may REPLY to a published review of their season. They may
 *     not edit it, hide it or delete it — the only people who can take a review
 *     down are the platform's operators.
 *   · Anybody reading a public review may REPORT it. Reports queue for the
 *     operators; nothing is taken down automatically, because an automatic
 *     takedown is a button any three friends can press together.
 *
 * STILL NO ROW LEVEL SECURITY. The principal on the review page is the link
 * token; the public page reads published rows for a PUBLIC competition only
 * (visibility is the gate, as it is for everything else on /c/[slug]); and the
 * organizer's reply is written after `competition.manage` is proven. The org_id
 * column is there for reads, not for isolation — the operator desk is
 * cross-tenant by definition.
 */

-- --- review_requests --------------------------------------------------------

ALTER TABLE "review_requests" ADD COLUMN "competition_id" char(26);--> statement-breakpoint
ALTER TABLE "review_requests" ADD COLUMN "org_id" char(26);--> statement-breakpoint
ALTER TABLE "review_requests" ADD COLUMN "role" text;--> statement-breakpoint

ALTER TABLE "review_requests" DROP CONSTRAINT "review_requests_subject_check";--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_subject_check"
  CHECK ("subject_type" IN ('platform', 'competition'));--> statement-breakpoint

-- A platform ask names no season and no role; a season ask names all three.
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_subject_shape_check"
  CHECK (
    ("subject_type" = 'platform' AND "competition_id" IS NULL AND "org_id" IS NULL AND "role" IS NULL)
    OR
    ("subject_type" = 'competition' AND "competition_id" IS NOT NULL AND "org_id" IS NOT NULL
      AND "role" IN ('player', 'owner'))
  );--> statement-breakpoint

-- CASCADE: a season that is deleted takes the asks about it.
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_competition_id_competitions_id_fk"
  FOREIGN KEY ("competition_id") REFERENCES "competitions"("id") ON DELETE CASCADE;--> statement-breakpoint

DROP INDEX "review_requests_person_subject_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "review_requests_platform_uq"
  ON "review_requests" ("person_id") WHERE "subject_type" = 'platform';--> statement-breakpoint
CREATE UNIQUE INDEX "review_requests_competition_uq"
  ON "review_requests" ("person_id", "competition_id") WHERE "subject_type" = 'competition';--> statement-breakpoint

-- "When did this club last ask?" — the once-a-week limit on the organizer's button.
CREATE INDEX "review_requests_competition_idx"
  ON "review_requests" ("competition_id", "created_at" DESC)
  WHERE "competition_id" IS NOT NULL;--> statement-breakpoint

-- --- reviews ------------------------------------------------------------------

ALTER TABLE "reviews" ADD COLUMN "competition_id" char(26);--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "org_id" char(26);--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "organizer_reply" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "organizer_reply_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "organizer_reply_by" char(26);--> statement-breakpoint

ALTER TABLE "reviews" DROP CONSTRAINT "reviews_subject_check";--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subject_check"
  CHECK ("subject_type" IN ('platform', 'competition'));--> statement-breakpoint

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subject_shape_check"
  CHECK (
    ("subject_type" = 'platform' AND "competition_id" IS NULL AND "org_id" IS NULL AND "role" IS NULL)
    OR
    ("subject_type" = 'competition' AND "competition_id" IS NOT NULL AND "org_id" IS NOT NULL
      AND "role" IN ('player', 'owner'))
  );--> statement-breakpoint

-- Only a season has an organizer to reply; the reply and its stamp move together.
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reply_shape_check"
  CHECK (
    ("organizer_reply" IS NULL AND "organizer_reply_at" IS NULL)
    OR
    ("subject_type" = 'competition' AND "organizer_reply" IS NOT NULL
      AND char_length("organizer_reply") BETWEEN 1 AND 1000 AND "organizer_reply_at" IS NOT NULL)
  );--> statement-breakpoint

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_competition_id_competitions_id_fk"
  FOREIGN KEY ("competition_id") REFERENCES "competitions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_organizer_reply_by_people_id_fk"
  FOREIGN KEY ("organizer_reply_by") REFERENCES "people"("id") ON DELETE SET NULL;--> statement-breakpoint

-- The public page: published reviews of one season, newest first.
CREATE INDEX "reviews_competition_published_idx"
  ON "reviews" ("competition_id", "created_at" DESC)
  WHERE "status" = 'published';--> statement-breakpoint

-- --- review_reports -----------------------------------------------------------

CREATE TABLE "review_reports" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "review_id" char(26) NOT NULL,
  "reason" text NOT NULL,
  -- Their words, optional. Rendered to operators as text only.
  "note" text,
  -- Throttling only; cleared by the retention sweep with the problem reports'.
  "reporter_ip" text,
  -- Null for a guest; a signed-in reader is recorded so a pile-on is visible.
  "reporter_person_id" char(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- The operator's answer: the review was hidden, or the report dismissed.
  "resolved_at" timestamp with time zone,
  "resolved_by" char(26),
  CONSTRAINT "review_reports_reason_check"
    CHECK ("reason" IN ('abusive', 'false', 'personal_info', 'spam', 'other')),
  CONSTRAINT "review_reports_note_length_check"
    CHECK ("note" IS NULL OR char_length("note") <= 500),
  CONSTRAINT "review_reports_review_id_reviews_id_fk"
    FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE,
  CONSTRAINT "review_reports_reporter_person_id_people_id_fk"
    FOREIGN KEY ("reporter_person_id") REFERENCES "people"("id") ON DELETE SET NULL,
  CONSTRAINT "review_reports_resolved_by_people_id_fk"
    FOREIGN KEY ("resolved_by") REFERENCES "people"("id") ON DELETE SET NULL
);--> statement-breakpoint

CREATE INDEX "review_reports_open_idx"
  ON "review_reports" ("review_id") WHERE "resolved_at" IS NULL;--> statement-breakpoint

CREATE INDEX "review_reports_ip_idx"
  ON "review_reports" ("reporter_ip", "created_at");

/*
 * ROLE MODEL (see 0031): desiauction_app writes all three by default privilege
 * and `grants:verify` asserts it by name; desiauction_system reads and gains no
 * write; engine and runner have no business here.
 */
