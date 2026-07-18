import { createHash, randomInt } from "node:crypto";

import { newId, otpCodes, people, type Db } from "@desiauction/db";
import { normalizePhone } from "@desiauction/core";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";

import type { OtpSender } from "./otp-sender";
import { logSecurityEvent } from "./security-events";

const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_PER_HOUR = 5;
const MAX_PER_HOUR_PER_IP = 20;
const MAX_ATTEMPTS = 5;

export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export type RequestOtpResult =
  { ok: true } | { ok: false; reason: "invalid-phone" | "cooldown" | "hourly-limit" };

/**
 * Uniform behaviour for every plausible phone (no-enumeration, IP-2 §6):
 * signup is open, so a code goes to any valid Indian mobile; limits apply
 * identically whether or not the person exists.
 */
export async function requestOtp(
  db: Db,
  sender: OtpSender,
  rawPhone: string,
  requestIp: string | null = null,
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

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(otpCodes).values({
    id: newId(),
    phone,
    codeHash: hashCode(code),
    expiresAt: new Date(now + CODE_TTL_MS),
    requestIp,
  });
  await sender.send(phone, code);
  return { ok: true };
}

export type VerifyOtpResult = { ok: true; personId: string } | { ok: false; reason: "invalid" };

/**
 * One generic failure reason — wrong code, expired code, unknown phone and
 * exhausted attempts are indistinguishable to a caller (IP-2 §6). First
 * successful verification creates the person (phone-first signup, C-24).
 */
export async function verifyOtp(db: Db, rawPhone: string, code: string): Promise<VerifyOtpResult> {
  const normalized = normalizePhone(rawPhone);
  if (!normalized.ok) {
    return { ok: false, reason: "invalid" };
  }
  const phone = normalized.phone;

  const [candidate] = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (
    candidate === undefined ||
    candidate.expiresAt.getTime() < Date.now() ||
    candidate.attempts >= MAX_ATTEMPTS
  ) {
    return { ok: false, reason: "invalid" };
  }

  if (candidate.codeHash !== hashCode(code)) {
    // Atomic increment guarded by the cap: concurrent wrong guesses serialize
    // on the row lock and only rows still under MAX_ATTEMPTS are bumped, so the
    // 5-attempt ceiling holds under parallelism (RC-4 Finding 3). A no-op
    // update (empty return) means the cap was already reached.
    const [bumped] = await db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(and(eq(otpCodes.id, candidate.id), lt(otpCodes.attempts, MAX_ATTEMPTS)))
      .returning({ attempts: otpCodes.attempts });
    if (bumped !== undefined && bumped.attempts >= MAX_ATTEMPTS) {
      const [lockedPerson] = await db.select().from(people).where(eq(people.phone, phone)).limit(1);
      if (lockedPerson !== undefined) {
        await logSecurityEvent(lockedPerson.id, "auth.otp.lockout");
      }
    }
    return { ok: false, reason: "invalid" };
  }

  await db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, candidate.id));

  const [existing] = await db.select().from(people).where(eq(people.phone, phone)).limit(1);
  if (existing !== undefined) {
    return { ok: true, personId: existing.id };
  }
  const personId = newId();
  await db.insert(people).values({ id: personId, phone });
  return { ok: true, personId };
}
