import { randomInt } from "node:crypto";

import { emailVerifications, newId, people, sessions, type Db } from "@desiauction/db";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";

import { maskContact } from "../admin/format";
import { boundSubject, codeDigest } from "./code-digest";
import { DEFAULT_GLOBAL_PER_HOUR, consumeCode, requestOtp } from "./otp";
import type { OtpSender } from "./otp-sender";
import { withSendLock } from "./send-lock";

/*
 * STEP-UP: "CONFIRM IT'S YOU" BEFORE A RISKY ADMIN ACT (AC-1.1, 0102).
 *
 * The 15-minute `signedInRecently` rule (sessions.ts) guards a person's own
 * credentials and reads the session's AGE. An admin console is different: an
 * operator signs in once in the morning and works all day, so age says nothing
 * about who is at the keyboard at 4 pm. A risky admin act therefore asks for a
 * FRESH code, sent to the operator's own sign-in channel, and records the
 * moment on the SESSION that entered it (`sessions.stepped_up_at`):
 *
 * - good for ten minutes, so a run of related actions asks once;
 * - bound to this session — a second, stolen session does not inherit it;
 * - its own purpose (`step_up`), hashed and bound to the person like a change
 *   code, so it can never sign anybody in and no sign-in code can satisfy it;
 * - the same throttles as every other code: per person, per address, platform.
 */

/** How long a step-up lasts on the session that entered it. */
export const STEP_UP_FRESH_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_PER_HOUR = 5;
const MAX_PER_HOUR_PER_IP = 20;
const MAX_ATTEMPTS = 5;

export function steppedUpRecently(
  session: { steppedUpAt: Date | null },
  now: number = Date.now(),
): boolean {
  return session.steppedUpAt !== null && now - session.steppedUpAt.getTime() <= STEP_UP_FRESH_MS;
}

interface Channel {
  kind: "email" | "phone";
  destination: string;
}

/**
 * Where a step-up code goes: the verified email if there is one — it is the
 * sign-in method production defaults to — else the phone. Deterministic, so
 * the confirm step looks in the same place the request wrote.
 */
async function channelOf(db: Db, personId: string): Promise<Channel | null> {
  const [person] = await db
    .select({ email: people.email, verifiedAt: people.emailVerifiedAt, phone: people.phone })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1);
  if (person === undefined) {
    return null;
  }
  if (person.email !== null && person.verifiedAt !== null) {
    return { kind: "email", destination: person.email };
  }
  return person.phone === null ? null : { kind: "phone", destination: person.phone };
}

export type StepUpRequest =
  | {
      ok: true;
      /** Where it went, masked, for "We sent a code to b•••@gmail.com". */
      sentTo: string;
      /** For an email channel the caller sends the mail; null when already sent (phone). */
      mail: { email: string; code: string } | null;
    }
  | { ok: false; reason: "no-channel" | "cooldown" | "hourly-limit" | "busy" | "invalid-phone" };

export async function requestStepUpCode(
  db: Db,
  sender: OtpSender,
  input: { personId: string; requestIp: string | null; globalPerHour?: number },
): Promise<StepUpRequest> {
  const channel = await channelOf(db, input.personId);
  if (channel === null) {
    return { ok: false, reason: "no-channel" };
  }
  if (channel.kind === "phone") {
    // The sign-in path's own throttles and delivery, purpose-bound and bound
    // to the asking account (the phone-change precedent).
    const sent = await requestOtp(
      db,
      sender,
      channel.destination,
      input.requestIp,
      "step_up",
      input.globalPerHour,
      input.personId,
    );
    return sent.ok
      ? { ok: true, sentTo: maskContact(channel.destination), mail: null }
      : { ok: false, reason: sent.reason };
  }
  const email = channel.destination;
  return withSendLock(
    db,
    { subject: `person:${input.personId}`, requestIp: input.requestIp },
    async (tx): Promise<StepUpRequest> => {
      const since = new Date(Date.now() - 60 * 60 * 1000);
      const [mine] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(emailVerifications)
        .where(
          and(
            eq(emailVerifications.personId, input.personId),
            eq(emailVerifications.purpose, "step_up"),
            gt(emailVerifications.createdAt, since),
          ),
        )) as [{ count: number }];
      if (mine.count >= MAX_PER_HOUR) {
        return { ok: false, reason: "hourly-limit" };
      }
      if (input.requestIp !== null) {
        const [ip] = (await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(emailVerifications)
          .where(
            and(
              eq(emailVerifications.requestIp, input.requestIp),
              gt(emailVerifications.createdAt, since),
            ),
          )) as [{ count: number }];
        if (ip.count >= MAX_PER_HOUR_PER_IP) {
          return { ok: false, reason: "hourly-limit" };
        }
      }
      const [platform] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(emailVerifications)
        .where(gt(emailVerifications.createdAt, since))) as [{ count: number }];
      if (platform.count >= (input.globalPerHour ?? DEFAULT_GLOBAL_PER_HOUR)) {
        return { ok: false, reason: "busy" };
      }
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      await tx.insert(emailVerifications).values({
        id: newId(),
        personId: input.personId,
        email,
        codeHash: codeDigest("email:step_up", boundSubject(input.personId, email), code),
        purpose: "step_up",
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
        ...(input.requestIp === null ? {} : { requestIp: input.requestIp }),
      });
      return { ok: true, sentTo: maskContact(email), mail: { email, code } };
    },
    () => ({ ok: false, reason: "busy" }),
  );
}

export type StepUpConfirm =
  | { ok: true; steppedUpAt: Date }
  | { ok: false; reason: "invalid" | "expired" | "locked" | "no-channel"; attemptsLeft?: number };

/**
 * Check the code and, if it is right, stamp THIS session. The attempt is
 * reserved before the comparison, right guess or wrong — the sign-in path's
 * rule, for its reason: guarding only the wrong branch lets a parallel burst
 * past the cap.
 */
export async function confirmStepUpCode(
  db: Db,
  input: { personId: string; sessionId: string; code: string },
): Promise<StepUpConfirm> {
  const channel = await channelOf(db, input.personId);
  if (channel === null) {
    return { ok: false, reason: "no-channel" };
  }
  const code = input.code.trim();
  if (channel.kind === "phone") {
    const consumed = await consumeCode(db, channel.destination, code, "step_up", input.personId);
    if (!consumed.ok) {
      return consumed.reason === "invalid" && consumed.attemptsLeft !== undefined
        ? { ok: false, reason: "invalid", attemptsLeft: consumed.attemptsLeft }
        : { ok: false, reason: consumed.reason };
    }
  } else {
    const [candidate] = await db
      .select()
      .from(emailVerifications)
      .where(
        and(
          eq(emailVerifications.personId, input.personId),
          eq(emailVerifications.purpose, "step_up"),
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
    const [reserved] = await db
      .update(emailVerifications)
      .set({ attempts: sql`${emailVerifications.attempts} + 1` })
      .where(
        and(
          eq(emailVerifications.id, candidate.id),
          lt(emailVerifications.attempts, MAX_ATTEMPTS),
          isNull(emailVerifications.consumedAt),
        ),
      )
      .returning({ attempts: emailVerifications.attempts });
    if (reserved === undefined) {
      return { ok: false, reason: "locked" };
    }
    if (
      candidate.codeHash !==
      codeDigest("email:step_up", boundSubject(input.personId, candidate.email), code)
    ) {
      return reserved.attempts >= MAX_ATTEMPTS
        ? { ok: false, reason: "locked" }
        : { ok: false, reason: "invalid", attemptsLeft: MAX_ATTEMPTS - reserved.attempts };
    }
    const [spent] = await db
      .update(emailVerifications)
      .set({ consumedAt: new Date() })
      .where(and(eq(emailVerifications.id, candidate.id), isNull(emailVerifications.consumedAt)))
      .returning({ id: emailVerifications.id });
    if (spent === undefined) {
      return { ok: false, reason: "invalid" };
    }
  }
  const steppedUpAt = new Date();
  await db
    .update(sessions)
    .set({ steppedUpAt })
    .where(and(eq(sessions.id, input.sessionId), eq(sessions.personId, input.personId)));
  return { ok: true, steppedUpAt };
}
