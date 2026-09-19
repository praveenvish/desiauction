/*
 * SOMEBODY IS TELLING US SOMETHING IS BROKEN (FR-1 Phase 1).
 *
 * HAND-AUTHORED, like 0022 onward: the drizzle snapshots stop at 0018.
 *
 * `/support` and `/contact` printed addresses and said, in their own source,
 * that no form there pretends to file anything. This is the somewhere a report
 * lands, so an operator can see it, answer it and close it — and so "we never
 * heard about that" stops being unfalsifiable.
 *
 * NO ROW LEVEL SECURITY, DELIBERATELY — the same category as `demo_requests`
 * (0031). A report may come from a guest with no session and no tenant, and a
 * signed-in report is still about the PLATFORM, not about an organization. The
 * only readers are platform operators holding `platform:support`.
 *
 * THE SCREENSHOT IS A SEPARATE TABLE, AND IT IS IN THE DATABASE ON PURPOSE.
 *
 *   · The media port serves every stored key from a PUBLIC base URL. A picture
 *     of somebody's console — squads, purses, names — must never be one guessed
 *     key away from the open internet, so it does not go there.
 *   · It is small by construction (the client downsizes to a JPEG and the
 *     server refuses anything over a megabyte) and short-lived (the retention
 *     sweep deletes it after ninety days), so the database is a fine home.
 *   · It lives beside the report rather than in it so the queue can list a
 *     hundred reports without dragging a hundred images off the disk.
 */
CREATE TABLE "problem_reports" (
  "id" char(26) PRIMARY KEY NOT NULL,
  -- Who, when they were signed in. SET NULL, not CASCADE: deleting a person
  -- must not delete the record that the platform was broken for them, only
  -- the link to who they were.
  "person_id" char(26),
  -- Where to reply. Optional for a guest; defaulted from the account for a
  -- signed-in person, who may still clear it.
  "reply_email" text,
  "category" text NOT NULL,
  -- Their words. The column the whole table exists for.
  "description" text NOT NULL,
  -- The page, with the query string dropped and bearer-token path segments
  -- replaced before it ever reaches here (server/support/problem-reports.ts).
  "page_url" text NOT NULL,
  -- Viewport, user agent, theme, build — a closed set of keys, validated and
  -- size-capped by the same module. Never trusted as-is.
  "context" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Throttling only; cleared by the retention sweep.
  "request_ip" text,
  "status" text NOT NULL DEFAULT 'new',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- The last hand that moved it. Null while new.
  "triaged_at" timestamp with time zone,
  "triaged_by" char(26),
  CONSTRAINT "problem_reports_category_check"
    CHECK ("category" IN ('bug', 'confusing', 'idea', 'other')),
  CONSTRAINT "problem_reports_status_check"
    CHECK ("status" IN ('new', 'triaged', 'fixed', 'wont_fix', 'duplicate')),
  -- A status other than new with nobody behind it would be a decision nobody made.
  CONSTRAINT "problem_reports_triaged_together_check"
    CHECK (("status" = 'new') = ("triaged_at" IS NULL)),
  CONSTRAINT "problem_reports_description_length_check"
    CHECK (char_length("description") BETWEEN 1 AND 4000),
  CONSTRAINT "problem_reports_person_id_people_id_fk"
    FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE SET NULL,
  CONSTRAINT "problem_reports_triaged_by_people_id_fk"
    FOREIGN KEY ("triaged_by") REFERENCES "people"("id") ON DELETE SET NULL
);--> statement-breakpoint

CREATE TABLE "problem_report_screenshots" (
  -- One per report, and gone with it.
  "report_id" char(26) PRIMARY KEY NOT NULL
    REFERENCES "problem_reports"("id") ON DELETE CASCADE,
  "content_type" text NOT NULL,
  "bytes" bytea NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "problem_report_screenshots_type_check"
    CHECK ("content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
  -- The server refuses more than this; the database refuses it again.
  CONSTRAINT "problem_report_screenshots_size_check"
    CHECK (octet_length("bytes") BETWEEN 1 AND 1048576)
);--> statement-breakpoint

-- The queue reads open-first, newest-first.
CREATE INDEX "problem_reports_open_idx"
  ON "problem_reports" ("created_at" DESC)
  WHERE "status" IN ('new', 'triaged');--> statement-breakpoint

CREATE INDEX "problem_reports_created_idx"
  ON "problem_reports" ("created_at" DESC);--> statement-breakpoint

-- The two throttle lookups, mirroring demo_requests.
CREATE INDEX "problem_reports_person_idx"
  ON "problem_reports" ("person_id", "created_at");--> statement-breakpoint

CREATE INDEX "problem_reports_ip_idx"
  ON "problem_reports" ("request_ip", "created_at");

/*
 * THE ROLE MODEL, STATED RATHER THAN ASSUMED (see 0031 for the long form).
 *
 *   · desiauction_app — default privileges grant it read and write on tables
 *     created later by the migration role. The public form and the operator
 *     desk both write on this pool; `grants:verify` asserts it by name
 *     (APP_WRITES_UNPROTECTED) so a recipe rewrite fails there, not on /support.
 *   · desiauction_system — reads by default privilege; gains no write.
 *   · desiauction_engine / desiauction_runner — nothing here is auction truth
 *     or money.
 */
