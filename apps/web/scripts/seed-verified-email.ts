// Attach a VERIFIED email address to an account, so that person can sign in
// without SMS.
//
// WHY THIS SCRIPT HAS TO EXIST. Email sign-in (Phase 1) authenticates anybody
// whose address is verified — but the only way to verify one is `/account`,
// which needs a session, which needs SMS. Until DLT registration clears with
// TRAI, nobody can get that first session, so nobody can reach the door that
// was built to work without it. This is the bootstrap out of that loop.
//
// It is DELIBERATELY A SCRIPT AND NOT A UI. Setting `email_verified_at` without
// a code proves nothing about the mailbox — it asserts, on the operator's
// authority, that the address is right. That authority belongs to someone with
// database access and a reason, not to a form on the internet: a UI for this
// would be an account-takeover button. Same reasoning as `seed:admin`, which is
// the only way a platform administrator comes into existence.
//
// Every run writes an audit row naming what was asserted and for whom, because
// "this address can now open that account" is exactly the kind of change an
// aggrieved person is entitled to see the provenance of.
//
// Run: pnpm --filter @desiauction/web seed:verified-email -- <phone> <email>
//   e.g. pnpm --filter @desiauction/web seed:verified-email -- +919999000001 me@example.com
//        pnpm --filter @desiauction/web seed:verified-email -- --revoke +919999000001
import { auditLog, createDb, newId, people } from "@desiauction/db";
import { eq } from "drizzle-orm";

import { PLATFORM_SCOPE_ID, PLATFORM_SCOPE_TYPE } from "../src/server/admin/capabilities.js";
import { normalizeEmail } from "../src/server/auth/email-change.js";

const URL_ = process.env["SYSTEM_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (URL_ === undefined) {
  throw new Error(
    "DATABASE_URL is required (run via pnpm --filter @desiauction/web seed:verified-email)",
  );
}
// Asserting a verified address IS a production act when you are bootstrapping
// the first operators, so it is not forbidden there — only made deliberate,
// exactly as seed:admin is.
if (process.env["NODE_ENV"] === "production" && process.env["ALLOW_SEED_IN_PRODUCTION"] !== "1") {
  throw new Error(
    "refusing to assert a verified email with NODE_ENV=production without ALLOW_SEED_IN_PRODUCTION=1 — set it to bootstrap deliberately.",
  );
}
const handle = createDb(URL_);
const db = handle.db;

function normalizePhone(input: string): string {
  const trimmed = input.trim();
  return trimmed.startsWith("+") ? trimmed : `+91${trimmed.replace(/^0+/, "")}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const revoke = args.includes("--revoke");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const phoneArg = positional[0];
  const emailArg = positional[1];
  if (phoneArg === undefined || (!revoke && emailArg === undefined)) {
    throw new Error(
      "Usage: pnpm --filter @desiauction/web seed:verified-email -- [--revoke] <phone> [email]\n" +
        "  e.g. pnpm --filter @desiauction/web seed:verified-email -- +919999000001 me@example.com\n" +
        "       pnpm --filter @desiauction/web seed:verified-email -- --revoke +919999000001",
    );
  }
  const phone = normalizePhone(phoneArg);

  const [person] = await db
    .select({ id: people.id, name: people.name, email: people.email })
    .from(people)
    .where(eq(people.phone, phone))
    .limit(1);
  if (person === undefined) {
    // Refuses rather than creating: `people.phone` is the identity anchor, and
    // inventing an account here would be a second, unaudited signup path.
    throw new Error(`no account with phone ${phone} — they must sign in once first`);
  }

  if (revoke) {
    await db
      .update(people)
      .set({ email: null, emailVerifiedAt: null })
      .where(eq(people.id, person.id));
    await db.insert(auditLog).values({
      id: newId(),
      actor: person.id,
      action: "auth.email.verification_revoked_by_operator",
      // Platform-scoped: an operator acting out-of-band with no session and no
      // org, exactly as seed:admin records itself.
      scopeType: PLATFORM_SCOPE_TYPE,
      scopeId: PLATFORM_SCOPE_ID,
      subject: person.id,
      meta: { phone, previousEmail: person.email ?? null },
    });
    console.log(`revoked the verified address on ${person.name ?? phone}`);
    return;
  }

  const email = normalizeEmail(emailArg ?? "");
  if (email === null) {
    throw new Error(`"${emailArg ?? ""}" does not look like an email address`);
  }
  /*
   * The unique index is on `lower(email)` WHERE email IS NOT NULL, so a second
   * account claiming the same address is refused by the database. Checked here
   * too, to fail with a sentence instead of a constraint name.
   */
  const [taken] = await db
    .select({ id: people.id, phone: people.phone })
    .from(people)
    .where(eq(people.email, email))
    .limit(1);
  if (taken !== undefined && taken.id !== person.id) {
    throw new Error(`${email} is already on the account for ${taken.phone}`);
  }

  await db
    .update(people)
    .set({ email, emailVerifiedAt: new Date() })
    .where(eq(people.id, person.id));
  await db.insert(auditLog).values({
    id: newId(),
    actor: person.id,
    action: "auth.email.verified_by_operator",
    scopeType: PLATFORM_SCOPE_TYPE,
    scopeId: PLATFORM_SCOPE_ID,
    subject: person.id,
    meta: { phone, email },
  });
  console.log(`${email} can now sign in as ${person.name ?? phone}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => handle.sql.end({ timeout: 5 }));
