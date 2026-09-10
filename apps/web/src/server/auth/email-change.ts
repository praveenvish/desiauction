import { createHash, randomInt } from "node:crypto";

import { emailVerifications, newId, people, type Db } from "@desiauction/db";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";

/**
 * ADDING AN ADDRESS THE PLATFORM MAY ACTUALLY SEND TO.
 *
 * The email delivery adapter refuses every document with `no_email_on_file`,
 * and it is right to: `people` carried a phone and a name, sign-in is
 * phone-first, and nothing in the product ever asked for an address. Its own
 * comment named what was missing — "a column, a form field and a verification
 * flow, because an unverified address is a liability rather than a channel".
 * This is the third of those.
 *
 * VERIFIED OR ABSENT. `people.email` is written only once a code sent to that
 * mailbox comes back, and the resolver reads `email_verified_at`, never the
 * column alone. The failure this prevents is not hypothetical: a player
 * mistypes a domain, a club issues them a receipt, and the receipt — with a
 * name, an amount and a competition on it — lands in a stranger's inbox.
 *
 * The address is stored case-folded. Mailbox comparison is case-insensitive in
 * practice, so `A@x.com` and `a@x.com` are one address; storing both would let
 * two accounts each believe they held it, and the unique index is on
 * `lower(email)` for the same reason.
 */

const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

/**
 * Deliberately permissive, and that is the point: the code decides.
 *
 * An address that passes a strict regex is not more likely to be the person's
 * own, and every strict pattern rejects mail that works — plus addressing,
 * long TLDs, unicode domains. The only real test of an address is whether a
 * message sent to it comes back, so this rejects the shapes that cannot be an
 * address at all and lets the mailbox answer the rest.
 */
export function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length < 3 || trimmed.length > 254 || /\s/.test(trimmed)) {
    return null;
  }
  const at = trimmed.indexOf("@");
  if (at <= 0 || at !== trimmed.lastIndexOf("@") || at === trimmed.length - 1) {
    return null;
  }
  const domain = trimmed.slice(at + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) {
    return null;
  }
  return trimmed;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export type EmailVerificationRequest =
  | { ok: true; email: string; code: string }
  | { ok: false; reason: "invalid-email" | "same-email" | "hourly-limit" };

/**
 * Mint a code for an address. Returns it so the CALLER sends it — this module
 * does no IO beyond the database, the same shape the OTP path uses, so the
 * transport stays swappable and testable.
 *
 * As with the phone change, a collision with somebody else's verified address
 * is NOT checked here. Refusing at this point would answer "does this address
 * have an account?" for any address typed, to anyone with an account. It is
 * answered at confirm time instead, which costs a code delivered to the mailbox
 * being asked about.
 */
export async function requestEmailVerification(
  db: Db,
  input: { personId: string; email: string },
): Promise<EmailVerificationRequest> {
  const email = normalizeEmail(input.email);
  if (email === null) {
    return { ok: false, reason: "invalid-email" };
  }
  const [person] = await db
    .select({ email: people.email, verifiedAt: people.emailVerifiedAt })
    .from(people)
    .where(eq(people.id, input.personId))
    .limit(1);
  if (person?.email === email && person.verifiedAt !== null) {
    return { ok: false, reason: "same-email" };
  }
  const [{ count }] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailVerifications)
    .where(
      and(
        eq(emailVerifications.personId, input.personId),
        gt(emailVerifications.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
      ),
    )) as [{ count: number }];
  if (count >= MAX_PER_HOUR) {
    // Per PERSON, not per address: the abuse this stops is using a signed-in
    // account to spray verification mail at arbitrary mailboxes, and rotating
    // the address is exactly what that looks like.
    return { ok: false, reason: "hourly-limit" };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(emailVerifications).values({
    id: newId(),
    personId: input.personId,
    email,
    codeHash: hashCode(code),
    // Explicit, though it matches the column default: this flow's codes must
    // never be consumable by sign-in, and saying so here means a future change
    // to the default cannot silently widen what they prove.
    purpose: "email_change",
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  return { ok: true, email, code };
}

export type EmailVerificationResult =
  | { ok: true; email: string }
  | {
      ok: false;
      reason: "invalid" | "expired" | "locked" | "taken";
      attemptsLeft?: number;
    };

/** Complete verification. The code proves the mailbox; the session proves the account. */
export async function confirmEmailVerification(
  db: Db,
  input: { personId: string; code: string },
): Promise<EmailVerificationResult> {
  const [candidate] = await db
    .select()
    .from(emailVerifications)
    .where(
      and(
        eq(emailVerifications.personId, input.personId),
        // PURPOSE-BOUND. Without this a sign-in code mailed to the person
        // would confirm an address change they never asked for.
        eq(emailVerifications.purpose, "email_change"),
        isNull(emailVerifications.consumedAt),
      ),
    )
    .orderBy(desc(emailVerifications.createdAt))
    .limit(1);
  if (candidate === undefined) {
    return { ok: false, reason: "invalid" };
  }
  if (candidate.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: "locked" };
  }
  if (candidate.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (candidate.codeHash !== hashCode(input.code)) {
    // Same atomic increment as the sign-in path: concurrent wrong guesses
    // serialize on the row lock and only rows still under the cap are bumped,
    // so the ceiling holds under parallelism.
    const [bumped] = await db
      .update(emailVerifications)
      .set({ attempts: sql`${emailVerifications.attempts} + 1` })
      .where(
        and(eq(emailVerifications.id, candidate.id), lt(emailVerifications.attempts, MAX_ATTEMPTS)),
      )
      .returning({ attempts: emailVerifications.attempts });
    if (bumped === undefined || bumped.attempts >= MAX_ATTEMPTS) {
      return { ok: false, reason: "locked" };
    }
    return { ok: false, reason: "invalid", attemptsLeft: MAX_ATTEMPTS - bumped.attempts };
  }

  await db
    .update(emailVerifications)
    .set({ consumedAt: new Date() })
    .where(eq(emailVerifications.id, candidate.id));

  // Collision answered only now, after the code was spent — see the request
  // step. Merging two accounts is not something this product can do safely.
  const [holder] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.email, candidate.email))
    .limit(1);
  if (holder !== undefined && holder.id !== input.personId) {
    return { ok: false, reason: "taken" };
  }

  await db
    .update(people)
    .set({ email: candidate.email, emailVerifiedAt: new Date() })
    .where(eq(people.id, input.personId));
  return { ok: true, email: candidate.email };
}

/**
 * The address the delivery adapter may use, or null.
 *
 * Reads `email_verified_at`, never the column alone. An address a person typed
 * and never confirmed is a string, and the adapter refusing `no_email_on_file`
 * is the correct outcome for it.
 */
export async function verifiedEmailOf(db: Db, personId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: people.email, verifiedAt: people.emailVerifiedAt })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);
  return row?.verifiedAt == null ? null : (row.email ?? null);
}
