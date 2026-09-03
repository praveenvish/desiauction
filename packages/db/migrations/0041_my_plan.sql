-- MY PLAN (WR-1, milestone M1).
--
-- HAND-AUTHORED, like 0019-0040.
--
-- A team owner's PRIVATE pre-auction plan: the players they mean to bid for,
-- the most they mean to pay, a priority, and who they fall back to. Compared
-- against engine truth on the owner's own screen during the auction. It is
-- not auction truth: the engine never reads these tables, the snapshot never
-- carries them, and nothing derived from them can place or refuse a bid.
--
-- THE POLICY HAS A SECOND ARM, AND THIS IS THE FIRST TABLE THAT DOES. Every
-- auction table so far is org-scoped at RLS and participation-gated in the
-- read model. That is right for data every participant may see. A plan is the
-- one thing one org member must never read about another: the organizer who
-- conducts, the rival who bids, the member who merely joined. So the two plan
-- tables require BOTH the org floor AND that `app.person_id` participates in
-- that team of that auction, by exactly the three routes the web tier's
-- `participantTeamIds` unions: a live paddle grant, a held paddle, or an
-- accepted owner invite. USING and WITH CHECK ship together (the RC-4 rule),
-- and both fail closed when either setting is absent. The subqueries read
-- org-scoped tables under the caller's own policies, which is the point: no
-- context, no participation, no rows.
--
-- KEYED BY REGISTRATION, NOT LOT. A lot id dies with an abandoned auction; the
-- registration survives into the recreated one, and so should the plan.
--
-- ON DELETE follows 0040's reading: a plan row is a note ABOUT a team, an
-- auction and a registration, so it dies with any of them (CASCADE); a
-- fallback that disappears simply clears (SET NULL). Revisions carry no
-- foreign keys at all: they are the history that must outlive the row.
--
-- MONEY is integer paise. `max_bid` NULL means "no cap".

CREATE TABLE "auction_team_targets" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "org_id" char(26) NOT NULL,
  "auction_id" char(26) NOT NULL,
  "team_id" char(26) NOT NULL,
  "registration_id" char(26) NOT NULL,
  "max_bid" bigint,
  "priority" smallint DEFAULT 3 NOT NULL,
  "fallback_registration_id" char(26),
  "created_by" char(26) NOT NULL,
  "updated_by" char(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "auction_team_targets_max_bid_check" CHECK ("max_bid" IS NULL OR "max_bid" > 0),
  CONSTRAINT "auction_team_targets_priority_check" CHECK ("priority" IN (1, 2, 3)),
  CONSTRAINT "auction_team_targets_fallback_check"
    CHECK ("fallback_registration_id" IS NULL OR "fallback_registration_id" <> "registration_id")
);--> statement-breakpoint

ALTER TABLE "auction_team_targets"
  ADD CONSTRAINT "auction_team_targets_auction_id_auctions_id_fk"
  FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auction_team_targets"
  ADD CONSTRAINT "auction_team_targets_team_id_teams_id_fk"
  FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auction_team_targets"
  ADD CONSTRAINT "auction_team_targets_registration_id_registrations_id_fk"
  FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auction_team_targets"
  ADD CONSTRAINT "auction_team_targets_fallback_registrations_id_fk"
  FOREIGN KEY ("fallback_registration_id") REFERENCES "registrations"("id") ON DELETE SET NULL;--> statement-breakpoint

-- One row per (auction, team, player): "add" is idempotent by the schema.
CREATE UNIQUE INDEX "auction_team_targets_uq"
  ON "auction_team_targets" ("auction_id", "team_id", "registration_id");--> statement-breakpoint
CREATE INDEX "auction_team_targets_team_idx"
  ON "auction_team_targets" ("org_id", "auction_id", "team_id");--> statement-breakpoint

ALTER TABLE "auction_team_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auction_team_targets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "auction_team_targets_tenant" ON "auction_team_targets"
  USING (
    "org_id" = current_setting('app.org_id', true)
    AND EXISTS (
      SELECT 1 FROM "paddle_grants" g
       WHERE g."auction_id" = "auction_team_targets"."auction_id"
         AND g."team_id" = "auction_team_targets"."team_id"
         AND g."person_id" = current_setting('app.person_id', true)
         AND g."revoked_at" IS NULL
      UNION ALL
      SELECT 1 FROM "paddles" p
       WHERE p."auction_id" = "auction_team_targets"."auction_id"
         AND p."team_id" = "auction_team_targets"."team_id"
         AND p."person_id" = current_setting('app.person_id', true)
         AND p."released_at" IS NULL
      UNION ALL
      SELECT 1 FROM "auction_owner_invites" i
       WHERE i."auction_id" = "auction_team_targets"."auction_id"
         AND i."team_id" = "auction_team_targets"."team_id"
         AND i."accepted_by" = current_setting('app.person_id', true)
         AND i."revoked_at" IS NULL
    )
  )
  WITH CHECK (
    "org_id" = current_setting('app.org_id', true)
    AND EXISTS (
      SELECT 1 FROM "paddle_grants" g
       WHERE g."auction_id" = "auction_team_targets"."auction_id"
         AND g."team_id" = "auction_team_targets"."team_id"
         AND g."person_id" = current_setting('app.person_id', true)
         AND g."revoked_at" IS NULL
      UNION ALL
      SELECT 1 FROM "paddles" p
       WHERE p."auction_id" = "auction_team_targets"."auction_id"
         AND p."team_id" = "auction_team_targets"."team_id"
         AND p."person_id" = current_setting('app.person_id', true)
         AND p."released_at" IS NULL
      UNION ALL
      SELECT 1 FROM "auction_owner_invites" i
       WHERE i."auction_id" = "auction_team_targets"."auction_id"
         AND i."team_id" = "auction_team_targets"."team_id"
         AND i."accepted_by" = current_setting('app.person_id', true)
         AND i."revoked_at" IS NULL
    )
  );--> statement-breakpoint

-- WHAT THE PLAN LOOKED LIKE, EVERY TIME IT CHANGED. Append-only: one row per
-- add / update / remove, in the same transaction, carrying the state AFTER the
-- change. `at_seq` is the snapshot version the owner was viewing when known.
-- The append-only teeth (revoke update/delete from every runtime role) live in
-- ops/db/create-app-role.sql, like the ledgers, and grants:verify pins them.
CREATE TABLE "auction_team_target_revisions" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "org_id" char(26) NOT NULL,
  "auction_id" char(26) NOT NULL,
  "team_id" char(26) NOT NULL,
  "target_id" char(26) NOT NULL,
  "kind" text NOT NULL,
  "registration_id" char(26) NOT NULL,
  "max_bid" bigint,
  "priority" smallint NOT NULL,
  "fallback_registration_id" char(26),
  "at_seq" integer,
  "by" char(26) NOT NULL,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "auction_team_target_revisions_kind_check"
    CHECK ("kind" IN ('added', 'updated', 'removed'))
);--> statement-breakpoint

CREATE INDEX "auction_team_target_revisions_team_idx"
  ON "auction_team_target_revisions" ("org_id", "auction_id", "team_id");--> statement-breakpoint

ALTER TABLE "auction_team_target_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auction_team_target_revisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "auction_team_target_revisions_tenant" ON "auction_team_target_revisions"
  USING (
    "org_id" = current_setting('app.org_id', true)
    AND EXISTS (
      SELECT 1 FROM "paddle_grants" g
       WHERE g."auction_id" = "auction_team_target_revisions"."auction_id"
         AND g."team_id" = "auction_team_target_revisions"."team_id"
         AND g."person_id" = current_setting('app.person_id', true)
         AND g."revoked_at" IS NULL
      UNION ALL
      SELECT 1 FROM "paddles" p
       WHERE p."auction_id" = "auction_team_target_revisions"."auction_id"
         AND p."team_id" = "auction_team_target_revisions"."team_id"
         AND p."person_id" = current_setting('app.person_id', true)
         AND p."released_at" IS NULL
      UNION ALL
      SELECT 1 FROM "auction_owner_invites" i
       WHERE i."auction_id" = "auction_team_target_revisions"."auction_id"
         AND i."team_id" = "auction_team_target_revisions"."team_id"
         AND i."accepted_by" = current_setting('app.person_id', true)
         AND i."revoked_at" IS NULL
    )
  )
  WITH CHECK (
    "org_id" = current_setting('app.org_id', true)
    AND EXISTS (
      SELECT 1 FROM "paddle_grants" g
       WHERE g."auction_id" = "auction_team_target_revisions"."auction_id"
         AND g."team_id" = "auction_team_target_revisions"."team_id"
         AND g."person_id" = current_setting('app.person_id', true)
         AND g."revoked_at" IS NULL
      UNION ALL
      SELECT 1 FROM "paddles" p
       WHERE p."auction_id" = "auction_team_target_revisions"."auction_id"
         AND p."team_id" = "auction_team_target_revisions"."team_id"
         AND p."person_id" = current_setting('app.person_id', true)
         AND p."released_at" IS NULL
      UNION ALL
      SELECT 1 FROM "auction_owner_invites" i
       WHERE i."auction_id" = "auction_team_target_revisions"."auction_id"
         AND i."team_id" = "auction_team_target_revisions"."team_id"
         AND i."accepted_by" = current_setting('app.person_id', true)
         AND i."revoked_at" IS NULL
    )
  );--> statement-breakpoint

-- WHICH FEATURES ARE SWITCHED OFF, AND WHERE. The platform's first flag table
-- (docs/63 asked for one; none existed). One row per (scope, feature); absence
-- means the code default; layers are ANDed so any of platform / org / auction
-- can switch a feature off and none can force it on over a higher layer's no.
-- `org_id` is the RLS floor: set on org and auction rows, NULL on platform rows,
-- which the app pool therefore never sees (the system pool reads them).
CREATE TABLE "feature_settings" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "org_id" char(26),
  "scope_type" text NOT NULL,
  "scope_id" char(26) NOT NULL,
  "feature" text NOT NULL,
  "enabled" boolean NOT NULL,
  "updated_by" char(26),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "feature_settings_scope_type_check" CHECK ("scope_type" IN ('platform', 'org', 'auction')),
  CONSTRAINT "feature_settings_org_check" CHECK (("scope_type" = 'platform') = ("org_id" IS NULL))
);--> statement-breakpoint

CREATE UNIQUE INDEX "feature_settings_uq"
  ON "feature_settings" ("scope_type", "scope_id", "feature");--> statement-breakpoint
CREATE INDEX "feature_settings_org_idx" ON "feature_settings" ("org_id");--> statement-breakpoint

-- Tenant lock, the ordinary shape (0003/0005 pattern): a switch is org data.
ALTER TABLE "feature_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feature_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "feature_settings_tenant" ON "feature_settings"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));--> statement-breakpoint

-- ADDITIVE AND BACKWARDS COMPATIBLE: three new tables, no row rewritten, no
-- lifecycle change. The app role reaches them via default privileges. The
-- engine and runner would receive SELECT by default privilege and must NOT:
-- ops/db/create-app-role.sql revokes it (re-run per its header), and
-- grants:verify fails until that has happened.
COMMENT ON TABLE "auction_team_targets" IS
  'A team owner''s private plan for one auction (WR-1). Never auction truth; participant-scoped at RLS.';--> statement-breakpoint
COMMENT ON TABLE "auction_team_target_revisions" IS
  'Append-only history of a private plan (WR-1). Same participant scope as the targets.';--> statement-breakpoint
COMMENT ON TABLE "feature_settings" IS
  'Per-scope feature switches (platform / org / auction). Absence = code default; layers only subtract.';
