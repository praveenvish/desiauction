-- C42 Astra amendment: preserve player registration identity and store scorer person identity explicitly.
ALTER TABLE "match_awards" ADD COLUMN "computed_person_id" char(26);
--> statement-breakpoint
ALTER TABLE "match_awards" ADD COLUMN "winner_person_id" char(26);
--> statement-breakpoint
ALTER TABLE "match_awards" ADD CONSTRAINT "match_awards_identity_check" CHECK (
  CASE WHEN "scope" = 'season' AND "kind" = 'scorer_of_season'
    THEN "computed_registration_id" IS NULL AND "winner_registration_id" IS NULL
    ELSE "computed_person_id" IS NULL AND "winner_person_id" IS NULL
  END
);
