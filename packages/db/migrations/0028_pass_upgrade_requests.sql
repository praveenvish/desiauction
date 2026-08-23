-- ASKING FOR MORE ROOM.
--
-- HAND-AUTHORED, like 0022–0027: the drizzle snapshots stop at 0018.
--
-- 0027 gave seasons a tier and the platform started refusing the fifth team on
-- Free. A refusal that says "upgrade the season's pass" and offers nowhere to do
-- it is a dead end, so this is the somewhere.
--
-- IT IS A REQUEST, NOT A PURCHASE, AND THE SCHEMA SAYS SO. Pro and Association
-- both read "Published at GA" on the pricing page — there is no price for either
-- of them anywhere in this repository, so a checkout here would have to invent
-- one, and inventing the number a customer is charged is the worst line in the
-- product to make up. An organizer asks; somebody answers; the answer is
-- recorded. When prices exist this table is what a payment attaches to.
--
-- ONE OPEN REQUEST PER SEASON. A partial unique index rather than a status
-- column check: a season may ask again after being answered, and the history of
-- what was asked and what was granted stays readable.
CREATE TABLE "pass_upgrade_requests" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "org_id" char(26) NOT NULL,
  "competition_id" char(26) NOT NULL,
  -- The tier as it stood when they asked, so a granted request still explains
  -- what it moved them from after the competition row has changed.
  "from_tier" text NOT NULL,
  "requested_tier" text NOT NULL,
  -- Why they need it, in their words. The single most useful field for whoever
  -- answers, and the one a form would be tempted to leave out.
  "note" text,
  "requested_by" char(26) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- Answered how, by whom, when. Null resolution = still open.
  "resolved_at" timestamp with time zone,
  "resolved_by" char(26),
  "outcome" text,
  CONSTRAINT "pass_upgrade_requests_tiers_check"
    CHECK ("from_tier" IN ('free', 'pro', 'association')
       AND "requested_tier" IN ('free', 'pro', 'association')),
  CONSTRAINT "pass_upgrade_requests_outcome_check"
    CHECK ("outcome" IS NULL OR "outcome" IN ('granted', 'declined'))
);--> statement-breakpoint

CREATE UNIQUE INDEX "pass_upgrade_requests_open_uq"
  ON "pass_upgrade_requests" ("competition_id")
  WHERE "resolved_at" IS NULL;--> statement-breakpoint

CREATE INDEX "pass_upgrade_requests_org_idx"
  ON "pass_upgrade_requests" ("org_id", "created_at");--> statement-breakpoint

-- Tenanted like everything else it sits beside: the org boundary is the one
-- RLS enforces, and a request naming a competition is org data.
ALTER TABLE "pass_upgrade_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pass_upgrade_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "pass_upgrade_requests_tenant" ON "pass_upgrade_requests"
  USING ("org_id" = current_setting('app.org_id', true))
  WITH CHECK ("org_id" = current_setting('app.org_id', true));
