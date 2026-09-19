-- WHO DID IT, HELD TO SOMEBODY (final readiness audit S-3).
--
-- 0040 bound every `person_id` to `people` and made the erasure policy the
-- ON DELETE rule. It left the attribution columns — `created_by`,
-- `granted_by`, `reviewed_by` and the rest — as conventions in application
-- code. This migration constrains every one of them that only ever names a
-- real person: 30 columns, each checked against its writers and against the
-- live values before it was listed here.
--
-- ON DELETE RESTRICT, for the reason 0040 gives. People are never deleted in
-- production: erasure (server/privacy/erasure.ts) ANONYMIZES the `people` row,
-- so a season still says who created it — "an erased person" — rather than
-- pointing at nobody. RESTRICT makes the destructive alternative impossible
-- to perform by hand, and no application path attempts it (the only
-- `delete(people)` callers are test and perf-harness teardowns).
--
-- NOT VALID, deliberately. A NOT VALID foreign key is fully enforced for every
-- new INSERT and UPDATE, and for every DELETE of a referenced person; it only
-- skips proving the rows that already exist. Long-lived development databases
-- carry test-teardown residue (organizations and fixture results whose creator
-- was deleted before them), and a validating ADD would refuse to run there.
-- A production database created from these migrations has no such rows; once
-- a deployment's data is confirmed clean, each constraint can be promoted with
-- `ALTER TABLE … VALIDATE CONSTRAINT …`, which takes only a light lock.
--
-- DELIBERATELY NOT CONSTRAINED — the columns that may name the SYSTEM actor
-- (`00000000000000000000000000`), which is not a person and never will be:
--   audit_log.actor, auction_events.actor      the append-only logs; the engine
--                                             and webhooks write as the system
--   settlement_events.actor, payments.attested_by, settlement_cases.created_by
--                                             the certified settlement writer;
--                                             sweeps act as the system
--   finops_events.actor, finops_documents.issued_by, finops_exports.requested_by,
--   finops_dispatches.requested_by, finops_periods.opened_by,
--   finops_profiles.declared_by               IP-6 (frozen); the follower and
--                                             governance act as the system
-- Those are ledgers whose integrity is proven by replay, not by a key, and two
-- of the three domains are frozen packages whose changes go through their own
-- amendment ledgers.

ALTER TABLE "auction_owner_invites" ADD CONSTRAINT "auction_owner_invites_accepted_by_people_fk"
  FOREIGN KEY ("accepted_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "auction_owner_invites" ADD CONSTRAINT "auction_owner_invites_created_by_people_fk"
  FOREIGN KEY ("created_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "auction_team_targets" ADD CONSTRAINT "auction_team_targets_created_by_people_fk"
  FOREIGN KEY ("created_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "auction_team_targets" ADD CONSTRAINT "auction_team_targets_updated_by_people_fk"
  FOREIGN KEY ("updated_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_created_by_people_fk"
  FOREIGN KEY ("created_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_created_by_people_fk"
  FOREIGN KEY ("created_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "demo_availability" ADD CONSTRAINT "demo_availability_created_by_people_fk"
  FOREIGN KEY ("created_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "demo_blackouts" ADD CONSTRAINT "demo_blackouts_created_by_people_fk"
  FOREIGN KEY ("created_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD CONSTRAINT "demo_requests_contacted_by_people_fk"
  FOREIGN KEY ("contacted_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "erasure_requests" ADD CONSTRAINT "erasure_requests_decided_by_people_fk"
  FOREIGN KEY ("decided_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "feature_settings" ADD CONSTRAINT "feature_settings_updated_by_people_fk"
  FOREIGN KEY ("updated_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "fixture_results" ADD CONSTRAINT "fixture_results_recorded_by_people_fk"
  FOREIGN KEY ("recorded_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_created_by_people_fk"
  FOREIGN KEY ("created_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "franchises" ADD CONSTRAINT "franchises_created_by_people_fk"
  FOREIGN KEY ("created_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_granted_by_people_fk"
  FOREIGN KEY ("granted_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "grounds" ADD CONSTRAINT "grounds_created_by_people_fk"
  FOREIGN KEY ("created_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_accepted_by_people_fk"
  FOREIGN KEY ("accepted_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_people_fk"
  FOREIGN KEY ("created_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "org_import_mappings" ADD CONSTRAINT "org_import_mappings_created_by_people_fk"
  FOREIGN KEY ("created_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "org_import_mappings" ADD CONSTRAINT "org_import_mappings_updated_by_people_fk"
  FOREIGN KEY ("updated_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "org_messaging_settings" ADD CONSTRAINT "org_messaging_settings_updated_by_people_fk"
  FOREIGN KEY ("updated_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_people_fk"
  FOREIGN KEY ("created_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "paddle_grants" ADD CONSTRAINT "paddle_grants_granted_by_people_fk"
  FOREIGN KEY ("granted_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "pass_upgrade_requests" ADD CONSTRAINT "pass_upgrade_requests_requested_by_people_fk"
  FOREIGN KEY ("requested_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "pass_upgrade_requests" ADD CONSTRAINT "pass_upgrade_requests_resolved_by_people_fk"
  FOREIGN KEY ("resolved_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_reviewed_by_people_fk"
  FOREIGN KEY ("reviewed_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_people_fk"
  FOREIGN KEY ("created_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_created_by_people_fk"
  FOREIGN KEY ("created_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_created_by_people_fk"
  FOREIGN KEY ("created_by") REFERENCES "people" ("id") ON DELETE RESTRICT NOT VALID;
