import { createHash, randomInt } from "node:crypto";

import {
  emailVerifications,
  newId,
  people,
  writeSurvivingConstraint,
  type Db,
} from "@desiauction/db";
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
 * PHASE 2 ADDS SIGN-UP. 0062 made `people.phone` nullable behind a CHECK that
 * an account is anchored by a phone, an email, or both — never neither — and
 * 0063 let a login code exist before its person does. So an address nobody has
 * used now gets a code like any other, and the request that PROVES that code
 * is what creates the account. Nothing exists until the mailbox answers.
 *
 * WHAT PHASE 2 DOES NOT DO IS MERGE. Both credentials stay unique, and the two
 * doors never fold two person rows into one: attaching a phone that already
 * signs somebody else in is REFUSED (`confirmPhoneChange` → `taken`), and so is
 * attaching such an address. Merging is not something this product can do
 * safely — two rows may hold registrations in the same competition, paddles in
 * the same auction, or opposing sides of a settlement, and no automatic rule
 * decides which of those survives. Refusing is the only honest answer, and it
 * leaves the person a support path instead of a silently wrong account.
 *
 * A PLAYER STILL NEEDS A PHONE. Not an authentication rule — an account with no
 * number signs in perfectly well — but a product one, enforced in
 * `submitRegistration`: a season reaches its players by SMS and by nothing
 * else, so entering one we cannot text would approve, auction and sell somebody
 * without ever telling them.
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
  | {
      ok: true;
      sent: true;
      email: string;
      code?: string;
      personId?: string;
      /**
       * Whether this code will CREATE an account rather than open one.
       *
       * Present so the mail can say the right thing — "create your account"
       * reads as an intrusion to somebody who already has one, and "sign in"
       * reads as a mistake to somebody who does not. It travels to the mailbox
       * and NOWHERE ELSE: the server action must never echo it to the browser,
       * because a caller who does not own the address would learn from it
       * exactly what the uniform result above exists to hide.
       */
      isNew?: boolean;
    }
  | { ok: false; reason: "invalid-email" | "hourly-limit" };

/**
 * Mint a code for an address — to sign in, or to sign up.
 *
 * Returns `ok` for any well-formed address, and since Phase 2 it mints a code
 * for every one of them: a known VERIFIED address gets a sign-in code carrying
 * its `personId`, an unknown one gets a sign-up code carrying null, and the
 * account is created only when that code comes back proved.
 *
 * The one address that gets NO code is a known but UNVERIFIED one. It cannot
 * sign in (an unverified `people.email` is a string somebody typed, not proof
 * of a mailbox) and it must not sign up either, because creating a second
 * account on an address already sitting on a first one is the merge this
 * product refuses to do. The caller says nothing different about it.
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
    .select({ id: people.id, verifiedAt: people.emailVerifiedAt })
    .from(people)
    .where(eq(people.email, email))
    .limit(1);
  if (person !== undefined && person.verifiedAt === null) {
    // Claimed but unproved — see the doc above. Silent, and indistinguishable
    // from every other outcome.
    return { ok: true, sent: true, email };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(emailVerifications).values({
    id: newId(),
    // Null means "nobody yet" (0063). `verifyEmailLogin` creates the person
    // when the code comes back proved, and not one moment sooner: minting the
    // account here would let anyone manufacture `people` rows from a public
    // form, and would take an address on behalf of somebody who never replies.
    personId: person?.id ?? null,
    email,
    codeHash: hashCode(code),
    purpose: "login",
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
    ...(input.requestIp !== undefined && input.requestIp !== null
      ? { requestIp: input.requestIp }
      : {}),
  });
  return person === undefined
    ? { ok: true, sent: true, email, code, isNew: true }
    : { ok: true, sent: true, email, code, personId: person.id, isNew: false };
}

export type EmailLoginResult =
  | { ok: true; personId: string; created: boolean }
  | { ok: false; reason: "invalid" | "expired" | "locked" | "taken"; attemptsLeft?: number };

/**
 * Consume a code and say who it proves — creating that person if this is a
 * sign-up.
 *
 * Deliberately does NOT create the SESSION — `verifyOtp` does not either. The
 * caller owns session minting, so both doors end at exactly the same place and
 * neither can drift into issuing a session the other would not. Creating the
 * PERSON is different: it has to happen in the same breath as consuming the
 * code, or a crash between the two would burn the proof and leave no account.
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
  if (consumed.personId !== null) {
    return { ok: true, personId: consumed.personId, created: false };
  }

  /*
   * A SIGN-UP CODE, NOW PROVED (0063). The mailbox answered, so the account it
   * asked for gets made.
   *
   * The address is re-read rather than trusted from mint time, because minutes
   * passed: somebody may have signed up on it through the other door, or an
   * existing account may have attached and verified it. Either way that person
   * is who this code proves, and signing them in is right — the code went to
   * their mailbox. What must NOT happen is a second `people` row on the same
   * address, which `people_email_unique` would refuse anyway; this exists so
   * the refusal is a decision rather than a database error.
   */
  const [already] = await db
    .select({ id: people.id, verifiedAt: people.emailVerifiedAt })
    .from(people)
    .where(eq(people.email, email))
    .limit(1);
  if (already !== undefined) {
    // Claimed but never proved, by somebody who is not standing here: this code
    // proves the MAILBOX, not that account. Refused rather than adopted — see
    // the merge note at the top of this file.
    return already.verifiedAt === null
      ? { ok: false, reason: "taken" }
      : { ok: true, personId: already.id, created: false };
  }

  const personId = newId();
  const inserted = await writeSurvivingConstraint(db, (tx) =>
    tx.insert(people).values({
      id: personId,
      // NO PHONE, and this is the whole point of 0062: `people_reachable_check`
      // is satisfied by the verified address alone. They can attach a number
      // later from the account page — and must, before registering as a player.
      phone: null,
      email,
      emailVerifiedAt: new Date(),
    }),
  );
  if (!inserted) {
    // Lost a race with another sign-up on the same address between the read
    // above and this insert. Whoever won holds the account; this code proved
    // the same mailbox, so it opens it rather than failing the person.
    const [winner] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.email, email))
      .limit(1);
    return winner === undefined
      ? { ok: false, reason: "invalid" }
      : { ok: true, personId: winner.id, created: false };
  }
  return { ok: true, personId, created: true };
}
