-- THE GOOGLE SHEET A SEASON'S REGISTRATIONS KEEP ARRIVING IN.
--
-- A club running registration on a Google Form re-imported the whole
-- download every few days for the life of the window: Forms → Responses →
-- Download → drop the zip → Import. The rows were already sitting in the
-- form's linked Sheet. The organizer now picks that Sheet once (Google's own
-- picker, drive.file — access to that one file, granted in their browser),
-- and "Sync new players" reads it again whenever they ask, through the same
-- mapping, preview and diff as a dropped file.
--
-- A POINTER, NOT A COPY. We keep the Sheet's Drive file id and its name (to
-- say which sheet on screen); the rows are read live, in the organizer's
-- browser, only when they press Sync. Nothing here grants access: without the
-- organizer's own Google sign-in the id opens nothing.
--
-- ADDITIVE: three nullable columns, no default, no backfill; no new GRANT
-- (columns of an existing table the roles already read and write).

ALTER TABLE "competitions" ADD COLUMN "import_sheet_id" text;--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "import_sheet_name" text;--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN "import_sheet_synced_at" timestamp with time zone;--> statement-breakpoint

COMMENT ON COLUMN "competitions"."import_sheet_id" IS
  'Google Drive file id of the Form responses Sheet this season syncs players from. A pointer; access stays with the organizer''s own Google sign-in.';
