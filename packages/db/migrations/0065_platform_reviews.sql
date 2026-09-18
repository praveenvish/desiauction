/*
 * HOW DID IT GO? (FR-1 Phase 2 — platform reviews.)
 *
 * HAND-AUTHORED, like 0022 onward.
 *
 * The landing page is uniformly no-fabrication, enforced by a test: no invented
 * customers, no testimonials. That rule is right, and it leaves the product with
 * no honest way to show that anybody has used it. These two tables are that way:
 * a review is asked for by name, written by the person asked, and held until an
 * operator publishes it. Phase 5 may quote a published review only when its
 * author ticked the box that allows it.
 *
 * PHASE 2 IS THE PLATFORM ONLY. `subject_type` is a column now, pinned to
 * 'platform' by a CHECK, so Phase 4's tournament reviews widen a constraint
 * rather than reshape two tables that already hold people's words.
 *
 * NO ROW LEVEL SECURITY, and the reason is the same as `demo_bookings`: the
 * principal on the review page is a TOKEN in the URL, not a session and not a
 * tenant, and a platform review belongs to no organization. Writes ride the app
 * pool; operators read on the system pool.
 */
CREATE TABLE "review_requests" (
  "id" char(26) PRIMARY KEY NOT NULL,
  -- Who was asked. CASCADE, and it carries the review with it: when a person is
  -- deleted, the words they wrote about us go too. A review is theirs, not ours.
  "person_id" char(26) NOT NULL,
  "subject_type" text NOT NULL DEFAULT 'platform',
  -- Why it was asked. Phase 3 adds the automatic sources; the CHECK already
  -- names them so the column's meaning does not change underneath old rows.
  "source" text NOT NULL,
  "requested_by" char(26),
  -- SHA-256 of the link token. The token itself is an HMAC of this row's id
  -- under REVIEW_TOKEN_SECRET — reproducible for a resend, absent from here.
  "token_hash" text NOT NULL,
  -- The address the ask went to, as it was then. Null when the person had no
  -- address and the operator shared the link by hand.
  "sent_to" text,
  "sent_at" timestamp with time zone,
  -- The first time the link was opened. "Did they ever see it?" is the
  -- question an operator deciding whether to nudge actually has.
  "opened_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "review_requests_subject_check" CHECK ("subject_type" IN ('platform')),
  CONSTRAINT "review_requests_source_check"
    CHECK ("source" IN ('manual_admin', 'manual_org', 'auction_completed', 'season_completed')),
  CONSTRAINT "review_requests_token_hash_uq" UNIQUE ("token_hash"),
  CONSTRAINT "review_requests_person_id_people_id_fk"
    FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE,
  CONSTRAINT "review_requests_requested_by_people_id_fk"
    FOREIGN KEY ("requested_by") REFERENCES "people"("id") ON DELETE SET NULL
);--> statement-breakpoint

-- ONE ASK PER PERSON PER SUBJECT. Asking again re-sends the same link; it never
-- mints a second request. Enforced here, not by a check-then-insert that two
-- operators pressing at once would both pass.
CREATE UNIQUE INDEX "review_requests_person_subject_uq"
  ON "review_requests" ("person_id", "subject_type");--> statement-breakpoint

CREATE INDEX "review_requests_created_idx"
  ON "review_requests" ("created_at" DESC);--> statement-breakpoint

CREATE TABLE "reviews" (
  "id" char(26) PRIMARY KEY NOT NULL,
  -- One review per request; the request is how the page found its author.
  "request_id" char(26) NOT NULL,
  -- Denormalised from the request for the desk's reads; CASCADE matches it.
  "person_id" char(26) NOT NULL,
  "subject_type" text NOT NULL DEFAULT 'platform',
  "rating" smallint NOT NULL,
  "went_well" text,
  "improve" text,
  -- Permission to quote it publicly, and the words to sign it with. Absent
  -- permission, the review is still useful to us and is never shown.
  "may_quote" boolean NOT NULL DEFAULT false,
  "display_name" text,
  "display_org" text,
  "status" text NOT NULL DEFAULT 'pending',
  "moderated_at" timestamp with time zone,
  "moderated_by" char(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "reviews_subject_check" CHECK ("subject_type" IN ('platform')),
  CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "reviews_status_check" CHECK ("status" IN ('pending', 'published', 'hidden')),
  CONSTRAINT "reviews_moderated_together_check"
    CHECK (("status" = 'pending') = ("moderated_at" IS NULL)),
  CONSTRAINT "reviews_went_well_length_check"
    CHECK ("went_well" IS NULL OR char_length("went_well") <= 2000),
  CONSTRAINT "reviews_improve_length_check"
    CHECK ("improve" IS NULL OR char_length("improve") <= 2000),
  -- A quote needs a name to sign it with; no name, no quote.
  CONSTRAINT "reviews_quote_signed_check"
    CHECK (NOT "may_quote" OR ("display_name" IS NOT NULL AND char_length("display_name") BETWEEN 1 AND 80)),
  CONSTRAINT "reviews_display_org_length_check"
    CHECK ("display_org" IS NULL OR char_length("display_org") <= 120),
  CONSTRAINT "reviews_request_uq" UNIQUE ("request_id"),
  CONSTRAINT "reviews_request_id_review_requests_id_fk"
    FOREIGN KEY ("request_id") REFERENCES "review_requests"("id") ON DELETE CASCADE,
  CONSTRAINT "reviews_person_id_people_id_fk"
    FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE,
  CONSTRAINT "reviews_moderated_by_people_id_fk"
    FOREIGN KEY ("moderated_by") REFERENCES "people"("id") ON DELETE SET NULL
);--> statement-breakpoint

-- The desk reads pending first, newest first.
CREATE INDEX "reviews_status_created_idx"
  ON "reviews" ("status", "created_at" DESC);

/*
 * ROLE MODEL (see 0031): desiauction_app writes both tables by default
 * privilege and `grants:verify` asserts it by name; desiauction_system reads and
 * gains no write; engine and runner have no business here.
 */
