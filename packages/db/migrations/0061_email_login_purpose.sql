-- EMAIL CODES GET A PURPOSE, for the reason phone codes got one.
--
-- `email_verifications` was built for one job: confirming an address a signed-in
-- person just typed. Sign-in by email adds a SECOND job to the same table, and
-- without separation a code minted for one would satisfy the other — a
-- confirmation code mailed to an address could sign somebody in, and a sign-in
-- code could silently confirm an address change.
--
-- That exact bug already happened on the phone side and `otp_codes.purpose`
-- (PI-1) is the fix: "before this, a code sent for sign-in could confirm a
-- number change on the same phone, and vice versa." `otp-purpose.regression.test.ts`
-- holds it. Repeating the mistake in the email path, with the fix sitting in the
-- next table, would be indefensible.
--
-- DEFAULT 'email_change' on purpose: every existing row was minted for that job,
-- and every existing caller keeps working untouched. Login has to ASK for the
-- login purpose, which is the safer direction for the new path to fail in.
ALTER TABLE "email_verifications"
  ADD COLUMN "purpose" text NOT NULL DEFAULT 'email_change';
--> statement-breakpoint
ALTER TABLE "email_verifications"
  ADD CONSTRAINT "email_verifications_purpose_check"
  CHECK ("purpose" IN ('email_change', 'login'));
--> statement-breakpoint
-- AND THE IP THE REQUEST CAME FROM, for the throttle that makes the uniform
-- "we sent a code" answer actually uniform.
--
-- `otp_codes` has carried this since PI-1 with a matching index; the email
-- table did not, because its only caller was a signed-in person changing their
-- own address — already rate-limited per PERSON, and not an enumeration
-- surface. Sign-in is: the form is public, a mailbox is a far better guess than
-- a phone number, and without a per-IP cap one host can walk a list of
-- addresses. Nullable, because a request with no resolvable IP is still a
-- request worth serving.
ALTER TABLE "email_verifications" ADD COLUMN "request_ip" text;
--> statement-breakpoint
CREATE INDEX "email_verifications_ip_idx"
  ON "email_verifications" ("request_ip", "created_at");
