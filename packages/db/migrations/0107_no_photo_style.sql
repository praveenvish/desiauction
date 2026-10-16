-- PLAYERS WITHOUT A PHOTO (2026-10-05).
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- A player with no photo has always been drawn as their initials on a branded
-- mark (C-25). A club whose roster is mostly photo-less (BPL4: 109 of 156) asked
-- for the other common choice: one cricketer silhouette for every such player.
--
-- `no_photo_style` is the season's choice: 'initials' (the default — every
-- season keeps what it had) or 'silhouette'. It changes how a missing photo is
-- drawn, never whether a real photo shows: consent and the age rule still
-- decide that, exactly as before.
ALTER TABLE "competitions"
  ADD COLUMN "no_photo_style" text NOT NULL DEFAULT 'initials';
--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_no_photo_style_check"
  CHECK ("no_photo_style" IN ('initials', 'silhouette'));
