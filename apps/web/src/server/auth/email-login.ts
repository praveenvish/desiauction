import { createHash, randomInt } from "node:crypto";

import { emailVerifications, newId, people, type Db } from "@desiauction/db";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";

import { normalizeEmail } from "./email-change";

/**
 * SIGNING IN WITH A MAILBOX (Phase 1).
 *
 * A second way to prove you are the same person — not a second identity. The
 * session it produces is the SAME session the phone path produces, keyed on
 * `personId`, and authorization never learns which door was used: grants,
 * roles and capabilities key on `personId` and contain no reference to phone or
 * email at all. So this adds an authentication channel and changes nothing
 * about what anybody is allowed to do.
 *
 * WHY IT EXISTS. Indian SMS needs DLT registration with TRAI before a single
 * transactional message can be sent, and that is a queue measured in days.
 * Email needs no such thing. This unblocks organizers and staff now; the phone
 * path is untouched and remains the route for players, whose registrations and
 * rosters key on a phone number.
 *
 * PHASE 1 IS SIGN-IN ONLY, DELIBERATELY. It authenticates people who ALREADY
 * exist and have a VERIFIED address. It creates nobody: `people.phone` is
 * `NOT NULL`, so an email-first signup needs a schema change, and that is
 * Phase 2's question — along with the harder one Phase 2 really has to answer,
 * which is what happens when one human ends up as two person rows.
 */

/** Fifteen minutes, matching email verification — mail is slower than SMS. */
const CODE_TTL_MS = 15 * 60 * 1000;
/** Per ADDRESS. Mirrors the phone path's per-handset cap. */
const MAX_PER_HOUR = 5;
/** Per IP, so one host cannot enumerate or spray across many addresses. */
const MAX_PER_HOUR_PER_IP = 20;
const MAX_ATTEMPTS = 5;

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * `{ ok: true }` carries NO signal about whether an account exists.
 *
 * The phone path is uniform for the same reason (IP-2 §6) and email needs it
 * more: a mailbox is a far better guess than a phone number, so a login form
 * that answers "no such account" is a membership oracle for anyone with a list
 * of addresses. `sent` says only that the request was accepted.
 */
export type EmailLoginRequest =
  | { ok: true; sent: true; email: string; code?: string; personId?: string }
  | { ok: false; reason: "invalid-email" | "hourly-limit" };

/**
 * Mint a sign-in code for a verified address.
 *
 * Returns `ok` for any well-formed address whether or not it belongs to
 * anybody. `code` and `personId` are present ONLY when there was a real
 * account to mint for — the caller mails a code when it has one and does
 * nothing when it does not, and either way tells the person the same thing.
 */
export async function requestEmailLogin(
  db: Db,
  input: { email: string; requestIp?: string | null },
): Promise<EmailLoginRequest> {
  const email = normalizeEmail(input.email);
  if (email === null) {
    return { ok: false, reason: "invalid-email" };
  }
  const since = new Date(Date.now() - 60 * 60 * 1000);

  /*
   * THROTTLE BEFORE LOOKUP, and throttle the unknown addresses too.
   *
   * If only real accounts consumed the budget, the difference between a
   * throttled and an unthrottled response would itself reveal which addresses
   * are real — the enumeration the uniform result above exists to prevent,
   * leaking through timing instead of wording.
   */
  const [{ count }] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailVerifications)
    .where(
      and(
        eq(emailVerifications.email, email),
        eq(emailVerifications.purpose, "login"),
        gt(emailVerifications.createdAt, since),
      ),
    )) as [{ count: number }];
  if (count >= MAX_PER_HOUR) {
    return { ok: false, reason: "hourly-limit" };
  }
  if (input.requestIp !== undefined && input.requestIp !== null && input.requestIp !== "") {
    const [ip] = (await db
      .select({ count: sql<number>`count(*)::int` })
      .from(emailVerifications)
      .where(
        and(
          eq(emailVerifications.requestIp, input.requestIp),
          eq(emailVerifications.purpose, "login"),
          gt(emailVerifications.createdAt, since),
        ),
      )) as [{ count: number }];
    if (ip.count >= MAX_PER_HOUR_PER_IP) {
      return { ok: false, reason: "hourly-limit" };
    }
  }

  /*
   * VERIFIED addresses only. An unverified `people.email` is a string somebody
   * typed; treating it as proof of a mailbox would let anyone who guessed a
   * colleague's address take their account. The unique index on `lower(email)`
   * means at most one person can match.
   */
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.email, email), sql`${people.emailVerifiedAt} is not null`))
    .limit(1);
  if (person === undefined) {
    return { ok: true, sent: true, email };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(emailVerifications).values({
    id: newId(),
    personId: person.id,
    email,
    codeHash: hashCode(code),
    purpose: "login",
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
    ...(input.requestIp !== undefined && input.requestIp !== null
      ? { requestIp: input.requestIp }
      : {}),
  });
  return { ok: true, sent: true, email, code, personId: person.id };
}

export type EmailLoginResult =
  | { ok: true; personId: string }
  | { ok: false; reason: "invalid" | "expired" | "locked"; attemptsLeft?: number };

/**
 * Consume a sign-in code and say who it proves.
 *
 * Deliberately does NOT create the session — `verifyOtp` does not either. The
 * caller owns session minting, so both doors end at exactly the same place and
 * neither can drift into issuing a session the other would not.
 */
export async function verifyEmailLogin(
  db: Db,
  input: { email: string; code: string },
): Promise<EmailLoginResult> {
  const email = normalizeEmail(input.email);
  if (email === null) {
    return { ok: false, reason: "invalid" };
  }
  const [candidate] = await db
    .select()
    .from(emailVerifications)
    .where(
      and(
        eq(emailVerifications.email, email),
        // PURPOSE-BOUND, and this is the line that matters. Without it a code
        // mailed to confirm an address change would sign the person in.
        eq(emailVerifications.purpose, "login"),
        isNull(emailVerifications.consumedAt),
      ),
    )
    .orderBy(sql`${emailVerifications.createdAt} desc`)
    .limit(1);
  if (candidate === undefined) {
    return { ok: false, reason: "invalid" };
  }
  if (candidate.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (candidate.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: "locked" };
  }
  if (candidate.codeHash !== hashCode(input.code)) {
    /*
     * The bump is CONDITIONAL on the row still being under the cap, so two
     * racing guesses cannot both read four attempts and both write five. The
     * update returns nothing when another request already took the last one.
     */
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
  /*
   * Consumed conditionally too: a correct code presented twice concurrently
   * must sign in once. The second update matches no row and is refused.
   */
  const [consumed] = await db
    .update(emailVerifications)
    .set({ consumedAt: new Date() })
    .where(and(eq(emailVerifications.id, candidate.id), isNull(emailVerifications.consumedAt)))
    .returning({ personId: emailVerifications.personId });
  if (consumed === undefined) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, personId: consumed.personId };
}
