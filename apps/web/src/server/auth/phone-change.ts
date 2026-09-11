import { normalizePhone } from "@desiauction/core";
import { people, type Db } from "@desiauction/db";
import { eq } from "drizzle-orm";

import { consumeCode, requestOtp } from "./otp";
import type { OtpSender } from "./otp-sender";

/**
 * CHANGING THE ONE CREDENTIAL THIS PRODUCT HAS.
 *
 * A phone number was, until now, permanent. `people.phone` is written once at
 * first sign-in and no path in the product ever changed it, which produced two
 * failures at opposite ends of the same fact — sign-in is phone-first, so the
 * number IS the credential:
 *
 *   LOCKOUT. Lose the number and you lose the account. Not "until support fixes
 *   it" — there was no support path either, because there is no other proof of
 *   who you are. Every squad, receipt and registration attached to that person
 *   becomes unreachable.
 *
 *   TAKEOVER. Indian carriers recycle disconnected numbers, typically after 90
 *   days. Whoever receives yours next signs in and IS you: the OTP arrives on
 *   their handset, `verifyOtp` finds the existing person, and they land in your
 *   account holding your club's money screens.
 *
 * This module fixes the first outright and is the honest mitigation for the
 * second: it is the way to move off a number BEFORE the carrier gives it away.
 * It cannot fix recycling itself. Nothing can, without a second factor the
 * person controls — which is what passkeys are for, and why the account page
 * offers them.
 *
 * WHAT IS VERIFIED, AND WHAT IS NOT. The change needs a live session plus
 * possession of the NEW number. It deliberately does NOT require the old one: a
 * person who still has their old handset does not need this flow, and demanding
 * it would leave the lockout exactly where it was. The residual risk is that a
 * stolen session can move the number, so the change is announced to the old
 * number and written to the person's security ledger, where they will see it.
 */

export type PhoneChangeRequest =
  | { ok: true }
  | {
      ok: false;
      reason: "invalid-phone" | "same-number" | "cooldown" | "hourly-limit";
    };

/**
 * Send a code to the number the person wants to move to.
 *
 * Note what is NOT checked here: whether that number already belongs to
 * somebody else. Refusing at this point would turn the form into an oracle —
 * anyone with an account could type numbers and learn which are registered.
 * The collision is refused at CONFIRM time instead, which an attacker can only
 * reach by holding the number, at which point they have learned a fact about a
 * handset in their own hand.
 */
export async function requestPhoneChange(
  db: Db,
  sender: OtpSender,
  input: { personId: string; newPhone: string; requestIp?: string | null },
): Promise<PhoneChangeRequest> {
  const normalized = normalizePhone(input.newPhone);
  if (!normalized.ok) {
    return { ok: false, reason: "invalid-phone" };
  }
  const [person] = await db
    .select({ phone: people.phone })
    .from(people)
    .where(eq(people.id, input.personId))
    .limit(1);
  if (person !== undefined && person.phone === normalized.phone) {
    // Not an error worth a code: sending one would let somebody re-verify the
    // number they already hold and call it a change.
    return { ok: false, reason: "same-number" };
  }
  // The same throttles sign-in uses, on the same table, deliberately. A separate
  // code path here would be a second, unthrottled way to make this platform send
  // SMS to an arbitrary number. The PURPOSE differs (PI-1): this code can only
  // confirm a phone change — a login code on the same handset cannot, and this
  // one cannot sign anybody in.
  const sent = await requestOtp(
    db,
    sender,
    normalized.phone,
    input.requestIp ?? null,
    "phone_change",
  );
  return sent.ok ? { ok: true } : { ok: false, reason: sent.reason };
}

export type PhoneChangeResult =
  /**
   * `previousPhone` is NULL when there was no previous phone — this same flow
   * is how an email-anchored account (0062) ATTACHES its first number. Nothing
   * is announced in that case, because there is no old handset to warn.
   */
  | { ok: true; previousPhone: string | null; newPhone: string }
  | {
      ok: false;
      reason: "invalid-phone" | "invalid" | "expired" | "locked" | "taken" | "no-person";
      attemptsLeft?: number;
    };

/**
 * Complete the change — or the first ATTACH.
 *
 * The code proves the handset; the session proves the account. Since 0062 a
 * person may arrive here holding no phone at all, having signed in by email:
 * every step below already reads correctly for that case (`same-number` cannot
 * match a null, the collision check is unchanged, the update writes the first
 * number rather than the next one), so attaching needs no second flow — which
 * is the point. A parallel "attach" path would have been a second place for the
 * collision rule to drift out of step with this one.
 *
 * THE COLLISION IS REFUSED, NEVER MERGED. Both credentials stay unique: if the
 * number already signs somebody in, this returns `taken` and nothing moves.
 * Folding two accounts together is not something this product can do safely —
 * they may hold registrations in the same competition, paddles in the same
 * auction, or opposing sides of a settlement.
 */
export async function confirmPhoneChange(
  db: Db,
  input: { personId: string; newPhone: string; code: string },
): Promise<PhoneChangeResult> {
  const normalized = normalizePhone(input.newPhone);
  if (!normalized.ok) {
    return { ok: false, reason: "invalid-phone" };
  }
  const phone = normalized.phone;
  const [person] = await db
    .select({ phone: people.phone })
    .from(people)
    .where(eq(people.id, input.personId))
    .limit(1);
  if (person === undefined) {
    return { ok: false, reason: "no-person" };
  }

  /*
   * The code is consumed BEFORE the collision is checked, and the order matters.
   *
   * Checking the collision first would answer "is this number registered?"
   * without any code at all — the oracle the request step was shaped to avoid,
   * rebuilt one function later. Burning the code first means the answer costs a
   * message to a handset the asker must be holding.
   */
  const consumed = await consumeCode(db, phone, input.code, "phone_change");
  if (!consumed.ok) {
    return consumed.reason === "invalid" && consumed.attemptsLeft !== undefined
      ? { ok: false, reason: "invalid", attemptsLeft: consumed.attemptsLeft }
      : { ok: false, reason: consumed.reason };
  }

  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.phone, phone))
    .limit(1);
  if (owner !== undefined && owner.id !== input.personId) {
    /*
     * Somebody already signs in with this number, and merging two accounts is
     * not a thing this product can do safely — they may hold registrations in
     * the same competition, paddles in the same auction, opposing sides of a
     * settlement. Refusing is the only honest answer.
     *
     * The unique index on `people.phone` would refuse anyway; this exists so
     * the person is told why rather than meeting a database error.
     */
    return { ok: false, reason: "taken" };
  }

  await db.update(people).set({ phone }).where(eq(people.id, input.personId));
  return { ok: true, previousPhone: person.phone, newPhone: phone };
}
