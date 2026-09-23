import { randomInt } from "node:crypto";

import { newId, otpCodes, people, type Db } from "@desiauction/db";
import { normalizePhone } from "@desiauction/core";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";

import { notificationGate } from "../messaging/gate";
import { boundSubject, codeDigest } from "./code-digest";
import type { OtpSender } from "./otp-sender";
import { logSecurityEvent } from "./security-events";

const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_PER_HOUR = 5;
const MAX_PER_HOUR_PER_IP = 20;
const MAX_ATTEMPTS = 5;
/**
 * PLATFORM-WIDE SEND CEILING. The caps above stop one handset and one source;
 * this stops the platform being used as an SMS cannon from rotating addresses
 * (pumping burns money and DLT sender reputation). Sized well above a busy
 * auction night; `OTP_GLOBAL_HOURLY_CAP` overrides it. Hitting it refuses with
 * `busy` and logs loudly — during an attack, legitimate sign-ins wait too,
 * which is the trade-off every ceiling makes.
 */
export const DEFAULT_GLOBAL_PER_HOUR = 2_000;

/**
 * The stored form of a phone code: keyed, and bound to what it proves — the
 * purpose, the phone, and for a change the account that asked (code-digest.ts).
 */
export function phoneCodeDigest(
  purpose: OtpPurpose,
  phone: string,
  code: string,
  boundTo?: string,
): string {
  return codeDigest(
    purpose === "login" ? "otp:login" : "otp:phone_change",
    boundTo === undefined ? phone : boundSubject(boundTo, phone),
    code,
  );
}

/**
 * What a code may prove (PI-1). Minted for one purpose, consumable for that
 * purpose alone — before this, a code sent for sign-in could confirm a number
 * change on the same phone, and vice versa. The default keeps every existing
 * caller (and the protecting suites) on the login path unchanged.
 */
export type OtpPurpose = "login" | "phone_change";

export type RequestOtpResult =
  { ok: true } | { ok: false; reason: "invalid-phone" | "cooldown" | "hourly-limit" | "busy" };

/**
 * Uniform behaviour for every plausible phone (no-enumeration, IP-2 §6):
 * signup is open, so a code goes to any valid Indian mobile; limits apply
 * identically whether or not the person exists. The cooldown and hourly caps
 * stay keyed by PHONE across purposes — a second purpose must never become a
 * second, unthrottled lane to the same handset.
 */
export async function requestOtp(
  db: Db,
  sender: OtpSender,
  rawPhone: string,
  requestIp: string | null = null,
  purpose: OtpPurpose = "login",
  globalPerHour: number = DEFAULT_GLOBAL_PER_HOUR,
  /** The account asking, for a code that proves a CHANGE to that account. */
  boundTo?: string,
): Promise<RequestOtpResult> {
  const normalized = normalizePhone(rawPhone);
  if (!normalized.ok) {
    return { ok: false, reason: "invalid-phone" };
  }
  const phone = normalized.phone;
  const now = Date.now();

  // Cooldown guards spam on a pending code; a consumed code (successful
  // login) never blocks an immediate second-device sign-in. Abuse is still
  // capped by the hourly limits below.
  const [latest] = await db
    .select({ createdAt: otpCodes.createdAt })
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);
  if (latest !== undefined && now - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    return { ok: false, reason: "cooldown" };
  }

  const [{ count }] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(otpCodes)
    .where(
      and(eq(otpCodes.phone, phone), gt(otpCodes.createdAt, new Date(now - 60 * 60 * 1000))),
    )) as [{ count: number }];
  if (count >= MAX_PER_HOUR) {
    return { ok: false, reason: "hourly-limit" };
  }

  if (requestIp !== null) {
    const [{ count: ipCount }] = (await db
      .select({ count: sql<number>`count(*)::int` })
      .from(otpCodes)
      .where(
        and(
          eq(otpCodes.requestIp, requestIp),
          gt(otpCodes.createdAt, new Date(now - 60 * 60 * 1000)),
        ),
      )) as [{ count: number }];
    if (ipCount >= MAX_PER_HOUR_PER_IP) {
      return { ok: false, reason: "hourly-limit" };
    }
  }

  const [{ count: platformCount }] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(otpCodes)
    .where(gt(otpCodes.createdAt, new Date(now - 60 * 60 * 1000)))) as [{ count: number }];
  if (platformCount >= globalPerHour) {
    return { ok: false, reason: "busy" };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(otpCodes).values({
    id: newId(),
    phone,
    codeHash: phoneCodeDigest(purpose, phone, code, boundTo),
    purpose,
    expiresAt: new Date(now + CODE_TTL_MS),
    requestIp,
  });
  /*
   * The gate, for a sign-in code, always says yes (catalogue: `login`, locked —
   * not even a STOP; gate.ts says why). It is asked so the code is one of the
   * sends the gate sees, and so an unlocked entry could never be silently
   * dropped here: a refusal throws rather than leaving somebody waiting.
   */
  const decision = await notificationGate(db, {
    kind: "auth.phone_code",
    channel: sender.channel ?? "sms",
    recipient: { contact: phone },
  });
  if (!decision.send) {
    throw new Error(`sign-in code refused by the notification gate: ${decision.reason}`);
  }
  await sender.send(phone, code);
  // PI-1 audit-gap closure: the request itself becomes ledger evidence — but
  // only where a ledger exists. The lookup runs for every phone (identical
  // path, no response difference, no oracle); only the write differs, exactly
  // as the lockout event below already behaves.
  const [requester] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.phone, phone))
    .limit(1);
  if (requester !== undefined) {
    await logSecurityEvent(requester.id, "auth.otp.requested", { purpose });
  }
  return { ok: true };
}

/**
 * Consume a pending code for a phone, without deciding what it means.
 *
 * Extracted from `verifyOtp` so the phone-change flow can reuse it. That flow
 * needs the identical attempt cap, expiry order and concurrent-guess race
 * handling — all three are delicate — but it must NOT create or attach a
 * person, which is exactly what `verifyOtp` does next. Copying the logic to get
 * one different ending is how the cap quietly stops holding on one of the two
 * paths.
 */
export async function consumeCode(
  db: Db,
  phone: string,
  code: string,
  purpose: OtpPurpose = "login",
  /** Must match the `boundTo` the code was requested with (a change code). */
  boundTo?: string,
): Promise<ConsumeResult> {
  const [candidate] = await db
    .select()
    .from(otpCodes)
    .where(
      and(eq(otpCodes.phone, phone), eq(otpCodes.purpose, purpose), isNull(otpCodes.consumedAt)),
    )
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (candidate === undefined) {
    return { ok: false, reason: "invalid" };
  }
  // Burned before expired: a code killed by five wrong guesses inside its five
  // minutes is a thing the user DID, and "too many attempts" is the sentence
  // that explains why the code in their hand stopped working.
  if (candidate.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: "locked" };
  }
  if (candidate.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  // RESERVE AN ATTEMPT BEFORE COMPARING — for right and wrong guesses alike.
  // The guarded increment serializes on the row lock, so a parallel burst gets
  // at most the remaining budget of reservations; everyone else is refused
  // without their guess ever being compared. Checking the cap only on the
  // WRONG branch (as this once did) let a thousand parallel guesses all pass
  // the snapshot read above, and the right one consume the code past the cap.
  const [reserved] = await db
    .update(otpCodes)
    .set({ attempts: sql`${otpCodes.attempts} + 1` })
    .where(
      and(
        eq(otpCodes.id, candidate.id),
        lt(otpCodes.attempts, MAX_ATTEMPTS),
        isNull(otpCodes.consumedAt),
      ),
    )
    .returning({ attempts: otpCodes.attempts });
  if (reserved === undefined) {
    // Lost the race: a parallel guess took the last attempt, or consumed it.
    return { ok: false, reason: "locked" };
  }

  if (candidate.codeHash !== phoneCodeDigest(purpose, phone, code, boundTo)) {
    if (reserved.attempts >= MAX_ATTEMPTS) {
      return { ok: false, reason: "locked", lockedOut: true };
    }
    return { ok: false, reason: "invalid", attemptsLeft: MAX_ATTEMPTS - reserved.attempts };
  }

  // Consumed conditionally: the same correct code presented twice at once
  // signs in once. The loser matches no row.
  const [consumed] = await db
    .update(otpCodes)
    .set({ consumedAt: new Date() })
    .where(and(eq(otpCodes.id, candidate.id), isNull(otpCodes.consumedAt)))
    .returning({ id: otpCodes.id });
  if (consumed === undefined) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true };
}

export type ConsumeResult =
  | { ok: true }
  | { ok: false; reason: "invalid"; attemptsLeft?: number }
  | { ok: false; reason: "expired" }
  | { ok: false; reason: "locked"; lockedOut?: boolean };

export type VerifyOtpResult =
  | { ok: true; personId: string; name: string | null }
  /** No pending code for this phone — the ONE reason that must stay generic. */
  | { ok: false; reason: "invalid"; attemptsLeft?: number }
  | { ok: false; reason: "expired" }
  | { ok: false; reason: "locked" };

/**
 * Verification, with reasons the person on the other end can act on.
 *
 * The no-enumeration rule (IP-2 §6) is about what a STRANGER can learn from a
 * phone they do not own, and it still holds where it matters: a phone with no
 * pending code — never requested, already consumed, unknown to the platform —
 * returns the bare `invalid`, identical in every case. There is no signal to
 * mine there.
 *
 * `expired`, `locked` and the remaining-attempt count are only ever reachable
 * for a phone that HAS a live code, which means someone just asked for one and
 * the SMS went to the handset. Telling that person "this code is burned, get a
 * fresh one" leaks nothing they did not cause; withholding it is how the old
 * single message stranded a user holding the correct code and told them, five
 * times over, that they had typed it wrong.
 */
export async function verifyOtp(db: Db, rawPhone: string, code: string): Promise<VerifyOtpResult> {
  const normalized = normalizePhone(rawPhone);
  if (!normalized.ok) {
    return { ok: false, reason: "invalid" };
  }
  const phone = normalized.phone;

  const consumed = await consumeCode(db, phone, code);
  if (!consumed.ok) {
    if (consumed.reason === "locked" && consumed.lockedOut === true) {
      const [lockedPerson] = await db.select().from(people).where(eq(people.phone, phone)).limit(1);
      if (lockedPerson !== undefined) {
        await logSecurityEvent(lockedPerson.id, "auth.otp.lockout");
      }
      return { ok: false, reason: "locked" };
    }
    return consumed;
  }

  // The name rides back with the identity so the caller can route a nameless
  // account straight to /onboarding instead of bouncing it off /home first.
  const [existing] = await db.select().from(people).where(eq(people.phone, phone)).limit(1);
  if (existing !== undefined) {
    return { ok: true, personId: existing.id, name: existing.name };
  }
  const personId = newId();
  await db.insert(people).values({ id: personId, phone });
  return { ok: true, personId, name: null };
}
