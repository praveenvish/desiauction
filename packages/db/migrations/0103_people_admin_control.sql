-- AC-1.2 PEOPLE: SUSPENSION (2026-10-02). docs/product/AC-1_ADMIN_CONTROL.md
--
-- HAND-AUTHORED, like 0019 onward: the drizzle snapshots stop at 0018.
--
-- A platform operator can suspend an account: every session stops on its next
-- request (the session lookup joins this column) and every sign-in path —
-- phone, email, passkey — refuses it. Grants are KEPT, so unsuspending
-- restores the account exactly. Who did it and why is on the row as well as in
-- the audit log, so the person page can say it without a log search.
--
-- No new grant: `people` has no RLS and the web tier already writes it on the
-- app role (app-layer scoping is the lock); the admin writer lives behind
-- `server/platform-ops`'s operatorFor. The BYPASSRLS system role gains nothing.
ALTER TABLE "people" ADD COLUMN "suspended_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "suspended_reason" text;
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "suspended_by" char(26) REFERENCES "people"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- All three together or none: a suspension always says who and why.
ALTER TABLE "people" ADD CONSTRAINT "people_suspension_complete_check"
  CHECK (("suspended_at" IS NULL) = ("suspended_reason" IS NULL));
--> statement-breakpoint
CREATE INDEX "people_suspended_idx" ON "people" ("suspended_at") WHERE "suspended_at" IS NOT NULL;
--> statement-breakpoint
-- PLATFORM INVITATIONS (AC-1.2). A superadmin invites someone by phone or
-- email with the roles they will hold. Nothing is created for them: the
-- invitation waits, and the moment that phone or email is PROVEN at sign-in
-- (a code to it, or its verified address) the roles attach and the row is
-- marked accepted. A role never sits on an unproven contact, and an account is
-- never made on somebody's behalf. Platform-level, no tenant, no RLS — written
-- by the web tier behind `server/platform-ops`'s operatorFor; the grants it
-- turns into are written on the system role, as every platform grant is.
CREATE TABLE "platform_invites" (
  "id" char(26) PRIMARY KEY NOT NULL,
  "phone" text,
  "email" text,
  "name" text NOT NULL,
  "capability_sets" text[] NOT NULL,
  "invited_by" char(26) NOT NULL REFERENCES "people"("id") ON DELETE RESTRICT,
  "reason" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "accepted_by" char(26) REFERENCES "people"("id") ON DELETE SET NULL,
  "accepted_at" timestamptz,
  "revoked_at" timestamptz,
  CONSTRAINT "platform_invites_contact_check" CHECK (("phone" IS NULL) <> ("email" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "platform_invites_phone_idx" ON "platform_invites" ("phone")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "platform_invites_email_idx" ON "platform_invites" (lower("email"))
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;
