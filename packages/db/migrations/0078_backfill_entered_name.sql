-- FREEZE THE NAME ON CLUB-ADDED ENTRIES THAT PRE-DATE 0075 (security review,
-- launch Phase 5).
--
-- 0075 began keeping the name an organizer typed when they added a phone that
-- already had an account, and showing it in place of the account's own. Rows
-- added BEFORE it have entered_name NULL, so they still show the account's
-- live name and photo to the club. What the organizer typed back then was never
-- stored and cannot be recovered.
--
-- What can be done is to stop those rows following the account from here on:
-- the name the club has already seen is frozen onto the entry, so a later
-- change to the account's name is not shown to the club, and the account's
-- photo is masked there (shownPhotoKey). The club can attach its own photo to
-- the entry (0077).
--
-- Which rows: added or imported by someone other than the player (the audit
-- row's actor), to an account that existed at least a minute before the entry.
-- An account created BY that add or import is younger than that, and its name
-- IS what the organizer typed. Fills blanks only, so re-running changes nothing.
UPDATE "registrations" AS r
SET "entered_name" = p."name"
FROM "people" AS p
WHERE p."id" = r."person_id"
  AND r."entered_name" IS NULL
  AND p."name" IS NOT NULL
  AND p."created_at" < r."created_at" - interval '1 minute'
  AND EXISTS (
    SELECT 1 FROM "audit_log" AS a
    WHERE a."subject" = r."id"
      AND a."action" IN ('registration.added', 'registration.imported')
      AND a."actor" <> r."person_id"
  );
