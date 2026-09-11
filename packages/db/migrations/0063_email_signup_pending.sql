/*
 * A SIGN-IN CODE FOR AN ADDRESS THAT HAS NO ACCOUNT YET.
 *
 * 0062 made a person anchorable by an email, which makes email SIGN-UP
 * possible. But the sign-up code has to exist before the person does, and
 * `person_id` was NOT NULL — so the only ways to mint one were to create the
 * account up front or to invent a placeholder person, and both are worse than
 * this column change:
 *
 *   CREATE UP FRONT would let anybody manufacture `people` rows by typing
 *   addresses into a public form, unauthenticated, one row per guess. It also
 *   creates an account for a person who has not yet proved they can read the
 *   mailbox — and if they never do, that address is now taken, by nobody.
 *
 * So a login row may carry a null `person_id`, meaning "nobody yet". The row
 * that CONSUMES it is what creates the person, inside the same transaction, at
 * the moment the code is proved. Until then nothing exists.
 *
 * AN email_change CODE STILL MUST NAME ITS PERSON, and the CHECK says so. That
 * code proves "this mailbox belongs to the account you are already signed in
 * to"; a null person there would be a code that changes an address on nobody,
 * and the only reason to allow it would be that this column is nullable now.
 * The constraint keeps the loosening confined to the one purpose that needs it.
 */
ALTER TABLE "email_verifications" ALTER COLUMN "person_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_verifications"
  ADD CONSTRAINT "email_verifications_person_required_check"
  CHECK ("person_id" IS NOT NULL OR "purpose" = 'login');
