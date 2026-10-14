-- C54: distinguish typed single-round results from scored canonical rounds.
ALTER TABLE fixture_participants ADD COLUMN source text;
--> statement-breakpoint
ALTER TABLE fixture_participants ADD CONSTRAINT fixture_participants_source_check CHECK (source IS NULL OR source IN ('typed','scored'));
--> statement-breakpoint
UPDATE fixture_participants SET source = 'typed' WHERE placement IS NOT NULL;
