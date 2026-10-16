-- LS-1 D-10: self-reported person history; never a scoring projection.
CREATE TABLE "player_previous_careers" (
  "person_id" char(26) NOT NULL,
  "sport" text NOT NULL,
  "summary" jsonb NOT NULL,
  "screenshot_key" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "player_previous_careers_pkey" PRIMARY KEY ("person_id","sport")
);--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['desiauction_engine','desiauction_runner'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON player_previous_careers FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
