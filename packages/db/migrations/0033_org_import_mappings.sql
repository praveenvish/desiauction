-- HOW THIS CLUB'S REGISTRATION FORM IS READ.
--
-- HAND-AUTHORED, like 0022–0032.
--
-- The import parser reads a canonical header row. A club's Google Form exports
-- its QUESTIONS as headers, so until now an organizer renamed columns in the
-- sheet by hand before every import — the most repeated task in the product,
-- done outside the product. `import-mapping.ts` translates the file; this table
-- is where the translation is REMEMBERED, so the second tournament costs one
-- click instead of the same fifteen minutes.
--
-- WHY THE ORG OWNS IT, NOT THE PLATFORM. A club reuses one form season after
-- season; that is exactly the repetition worth eliminating, and the club is the
-- only party who knows what its own questions mean. Platform admin is certified
-- READ-ONLY (PX-9) and must stay that way, so nothing here is administered
-- centrally.
--
-- SCOPE IS ORG-FIRST WITH A PER-SEASON OVERRIDE. `competition_id IS NULL` is
-- the club's default mapping — the answer for every season. A row naming a
-- competition overrides it for that season alone, which is what a club running
-- one differently-shaped form for one tournament actually needs. Two partial
-- unique indexes rather than one over COALESCE: the same idiom as
-- `registrations_team_captain_uq`, and it keeps each rule readable on its own.
--
-- THE SIGNATURE IS A LAYOUT, NOT A SECRET AND NOT DATA. It is the file's
-- headers, normalized and sorted (`signatureOf`) — so the same form recognises
-- itself across a reworded question's capitalisation or a reordered column, and
-- a genuinely different form does not collide with it. It contains no player
-- information: headers are questions, never answers.

CREATE TABLE "org_import_mappings" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "org_id" char(26) NOT NULL,
  -- NULL = this org's default mapping. Set = an override for one season.
  "competition_id" char(26),
  "signature" text NOT NULL,
  -- What the organizer calls this form, for the "using your saved mapping" line.
  "label" text,
  -- field -> source column index, exactly the `ColumnMapping` core defines.
  "mapping" jsonb NOT NULL,
  -- field -> { value as written: value we understand }. Empty is the norm.
  "value_maps" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Which number leads an ambiguous numeric date in THIS form. Stored because
  -- it is a property of the form, and re-asking every season is how a club ends
  -- up with half a roster born in the wrong month.
  "date_order" text NOT NULL DEFAULT 'dmy',
  "created_by" char(26) NOT NULL,
  "updated_by" char(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "org_import_mappings_date_order_check"
    CHECK ("date_order" IN ('dmy', 'mdy')),
  -- A mapping that maps nothing is not a mapping; it would silently produce a
  -- file with no columns and an import that reports every row as invalid.
  CONSTRAINT "org_import_mappings_mapping_check"
    CHECK (jsonb_typeof("mapping") = 'object' AND "mapping" <> '{}'::jsonb),
  CONSTRAINT "org_import_mappings_value_maps_check"
    CHECK (jsonb_typeof("value_maps") = 'object'),
  CONSTRAINT "org_import_mappings_signature_check"
    CHECK (length("signature") BETWEEN 1 AND 4000)
);--> statement-breakpoint

-- One default per (org, form layout).
CREATE UNIQUE INDEX "org_import_mappings_org_default_uq"
  ON "org_import_mappings" ("org_id", "signature")
  WHERE "competition_id" IS NULL;--> statement-breakpoint

-- One override per (org, season, form layout).
CREATE UNIQUE INDEX "org_import_mappings_competition_uq"
  ON "org_import_mappings" ("org_id", "competition_id", "signature")
  WHERE "competition_id" IS NOT NULL;--> statement-breakpoint

CREATE INDEX "org_import_mappings_org_idx"
  ON "org_import_mappings" ("org_id");--> statement-breakpoint

-- Tenanted like every other org table. A mapping names a club's own form and
-- nobody else's business; without RLS one org could read another's layout.
ALTER TABLE "org_import_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_import_mappings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_import_mappings_tenant" ON "org_import_mappings"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

-- NO EXPLICIT GRANT, and that is a claim rather than an omission (the reasoning
-- 0031 wrote down): `ALTER DEFAULT PRIVILEGES` in ops/db/create-app-role.sql
-- already gives desiauction_app SELECT/INSERT/UPDATE/DELETE on tables the
-- migration role creates later, and the web tier is the only writer here — the
-- engine and the runner have no business in an import mapping. RLS above is
-- what scopes the rows. `pnpm --filter @desiauction/web grants:verify` asserts
-- the app role's reach over this table so a recipe rewrite that drops those
-- defaults fails there instead of on a club's import screen.
COMMENT ON TABLE "org_import_mappings" IS
  'Per-org (optionally per-competition) column + value mapping for registration CSV import.';
