-- WHERE A PERSON HAS READ THEIR INBOX UP TO (email programme PR16).
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- "Read" lived in each browser's localStorage (`da:inbox-seen-at:<person>`):
-- a notice read on the phone stayed unread on the laptop, a cleared browser
-- made everything new again, and the bell could never say HOW MANY. The
-- watermark moves to the person: the time of the newest notice they have
-- seen, set when they open /inbox, only ever moved forward.
--
-- ADDITIVE: one nullable column, no default, no backfill (NULL is "never
-- opened on this build" — the app falls back to the old device watermark
-- once), no new GRANT (a column of a table the roles already read and write).

ALTER TABLE "people" ADD COLUMN "inbox_seen_at" timestamp with time zone;
