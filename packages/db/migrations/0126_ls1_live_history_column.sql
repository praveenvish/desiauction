-- F05: the betting-delay ring moves out of the live snapshot, so a hot read
-- fetches the one released entry instead of thirty full snapshots.
ALTER TABLE "match_live_state" ADD COLUMN "history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "match_live_state"
  SET "history" = CASE WHEN jsonb_typeof("state" -> 'history') = 'array' THEN "state" -> 'history' ELSE '[]'::jsonb END,
      "state" = "state" - 'history';
