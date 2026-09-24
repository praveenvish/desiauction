-- WHERE A GOOGLE FORM PUT THIS PLAYER'S PHOTO.
--
-- A club's Google Form stores each uploaded photo in the owner's Drive and
-- writes only a link into the responses sheet. Matching those files to
-- players by NAME fails on real forms: Google names every upload after the
-- uploader's Google ACCOUNT ("IMG_0837 - masiva solution.jpeg"), which on the
-- first real export matched 1 photo in 13. The link in the player's own row is
-- the exact key, so the import keeps its Drive file id and the photo step
-- fetches by it.
--
-- A POINTER, NOT A PHOTO. Nothing is fetched at import time; the organizer
-- grants access to the files in their own browser later (drive.file scope),
-- and the photo that lands goes through the same consent-recording upload as
-- any other. Cleared by erasure along with the other entry fields.
--
-- ADDITIVE: nullable, no default, no backfill; no new GRANT is needed (column
-- of an existing table the roles already read and write).

ALTER TABLE "registrations" ADD COLUMN "photo_drive_id" text;--> statement-breakpoint

COMMENT ON COLUMN "registrations"."photo_drive_id" IS
  'Google Drive file id of the photo a Google Form import linked for this entry; the photo step fetches by it. A pointer only; erased with the entry fields.';
