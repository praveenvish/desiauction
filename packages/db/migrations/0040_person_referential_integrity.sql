-- THE PERSON EVERY ROW SWORE IT HAD.
--
-- HAND-AUTHORED, like 0019-0039: the drizzle snapshots stop at 0018.
--
-- `people` is the identity spine of this platform, and until this migration
-- NOTHING held any row to it. Eleven tables carry a `person_id`, all of them
-- NOT NULL, none of them constrained. The database had exactly two foreign
-- keys in it -- both on `demo_bookings` (0031/0032), the newest feature --
-- while every older relationship, person_id included, was a convention that
-- lived only in application code.
--
-- WHAT THAT COSTS, OBSERVED. A test teardown deleted `people` rows without
-- their children and left 120 of 209 registrations pointing at nobody. The
-- product did not error. It did something worse: every surface that reads
-- `registrations JOIN people` -- the registration desk, the readiness pool,
-- the posters, resolvedLots -- rendered EMPTY, while the stat tiles beside
-- them, which count registrations without joining, went on reporting 12. Five
-- surfaces disagreeing with each other, no exception anywhere, and the cause
-- indistinguishable from a dozen plausible UI bugs. A join to a row that does
-- not exist is not an error in SQL; it is an empty result. That is precisely
-- why the constraint has to live in the database and not in a code review.
--
-- THE ON DELETE SPLIT IS THE PRIVACY POLICY, ENFORCED.
--
-- /account's "Your data" panel makes the platform a promise, in these words:
-- "Where your data appears only in your own profile, we delete it. Where it
-- appears in a shared, permanent record -- an auction you bid in, a receipt
-- issued to you -- we anonymize your name and number instead of destroying the
-- record." That sentence is a specification for ON DELETE, so it is used as
-- one:
--
--   CASCADE  -- "only in your own profile": the row is the person's own and
--               dies with them. Erasure genuinely deletes these.
--   RESTRICT -- "a shared, permanent record": the database REFUSES to destroy
--               it. Erasure must anonymize the `people` row instead, which is
--               what the policy already promises and what the (manual, staffed)
--               DPDP process is instructed to do.
--
-- So this migration does not merely describe the erasure path. It makes the
-- destructive version of it impossible to perform by hand at a psql prompt,
-- which is the only way it can currently be performed at all.
--
-- SAFE TO ADD, VERIFIED: no application code deletes from `people`. The only
-- `delete(people)` callers in the tree are test and perf-harness teardowns. The
-- erasure path itself is a documented manual process ("email privacy@...") with
-- no implementation, so there is no production writer for these rules to break.
--
-- IF THIS MIGRATION FAILS with "violates foreign key constraint", the database
-- already holds orphans and Postgres is naming the first table it found. That
-- is the bug above, already present in that database. Repair the data
-- deliberately -- do not weaken the constraint. On a local machine the honest
-- fix is to recreate the database and reseed.

-- ---------------------------------------------------------------------------
-- The index the RESTRICT checks need.
--
-- Every other person_id column already leads an index; `paddles` was the one
-- that never got one, so deleting a person would have meant a sequential scan
-- of every paddle ever issued to prove the delete was legal.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "paddles_person_idx" ON "paddles" ("person_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- CASCADE -- the person's own profile. Deleted with them, as promised.
-- ---------------------------------------------------------------------------

-- Sign-in state on the person's own devices.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_person_id_people_id_fk"
  FOREIGN KEY ("person_id") REFERENCES "people" ("id") ON DELETE CASCADE;--> statement-breakpoint

-- Short-lived proof-of-address codes; meaningless without their person.
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_person_id_people_id_fk"
  FOREIGN KEY ("person_id") REFERENCES "people" ("id") ON DELETE CASCADE;--> statement-breakpoint

-- A credential belonging to one person's authenticator.
ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_person_id_people_id_fk"
  FOREIGN KEY ("person_id") REFERENCES "people" ("id") ON DELETE CASCADE;--> statement-breakpoint

-- "Send me this, do not send me that." Nobody else's business.
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_person_id_people_id_fk"
  FOREIGN KEY ("person_id") REFERENCES "people" ("id") ON DELETE CASCADE;--> statement-breakpoint

-- The person's durable cricket identity. 0036 already stated the rule in prose
-- -- "erasure = the row is nulled alongside `people` anonymization" -- and this
-- is that sentence made executable.
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_person_id_people_id_fk"
  FOREIGN KEY ("person_id") REFERENCES "people" ("id") ON DELETE CASCADE;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RESTRICT -- shared, permanent records. Anonymize the person; keep the row.
--
-- RESTRICT rather than NO ACTION deliberately: it cannot be deferred, so the
-- refusal arrives at the offending statement rather than at COMMIT, naming the
-- table that actually holds the record.
--
-- Note these checks are exempt from row level security (Postgres runs
-- referential integrity as the table owner, bypassing RLS), which is what makes
-- them trustworthy: a person who appears in ANOTHER tenant's competition still
-- blocks the delete, even though no session could ever read that row.
-- ---------------------------------------------------------------------------

-- The season a player entered. The record five surfaces read, and the one that
-- was silently broken.
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_person_id_people_id_fk"
  FOREIGN KEY ("person_id") REFERENCES "people" ("id") ON DELETE RESTRICT;--> statement-breakpoint

-- "An auction you bid in" -- the policy's own example, verbatim.
ALTER TABLE "paddles" ADD CONSTRAINT "paddles_person_id_people_id_fk"
  FOREIGN KEY ("person_id") REFERENCES "people" ("id") ON DELETE RESTRICT;--> statement-breakpoint

-- Who was permitted to lift that paddle on the night.
ALTER TABLE "paddle_grants" ADD CONSTRAINT "paddle_grants_person_id_people_id_fk"
  FOREIGN KEY ("person_id") REFERENCES "people" ("id") ON DELETE RESTRICT;--> statement-breakpoint

-- Authority, and the audit trail of who held it. Revocation is `revoked_at`;
-- a grant is never deleted, so RESTRICT costs the product nothing.
ALTER TABLE "grants" ADD CONSTRAINT "grants_person_id_people_id_fk"
  FOREIGN KEY ("person_id") REFERENCES "people" ("id") ON DELETE RESTRICT;--> statement-breakpoint

-- Membership of a club. Leaving is a DELETE of THIS row, which stays legal;
-- only deleting the person out from under a live membership is refused.
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_person_id_people_id_fk"
  FOREIGN KEY ("person_id") REFERENCES "people" ("id") ON DELETE RESTRICT;--> statement-breakpoint

-- DPDP consent evidence: the proof that messaging this person was permitted.
-- Deleting it destroys the platform's own defence, so it is a record, not a
-- preference, and it is kept.
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_person_id_people_id_fk"
  FOREIGN KEY ("person_id") REFERENCES "people" ("id") ON DELETE RESTRICT;--> statement-breakpoint

COMMENT ON CONSTRAINT "registrations_person_id_people_id_fk" ON "registrations" IS
  'RESTRICT, not CASCADE: a registration is a shared permanent record. Erasure anonymizes the people row (DPDP), it does not destroy the season.';
