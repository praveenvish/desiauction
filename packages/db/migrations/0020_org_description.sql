-- The organization's own description — the "About" banner on Org Detail, which
-- an owner edits in place. Nullable and un-backfilled: it is the club's own
-- words, empty until someone writes them, never fabricated by the platform.
ALTER TABLE "organizations" ADD COLUMN "description" text;
