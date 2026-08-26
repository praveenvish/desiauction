// Against real Postgres (docker locally, service container in CI).
// Each run uses unique phone numbers; rows are cleaned up afterwards.
import { createDb, otpCodes, otpInbox, people, sessions, type DbHandle } from "@desiauction/db";
import { desc, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { requestOtp, verifyOtp } from "./otp";
import { DevInboxSender } from "./otp-sender";
import { createSession, getSessionByToken, revokeSession } from "./sessions";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-8);
const PHONE_A = `+9198${RUN}00`.slice(0, 13);
const PHONE_B = `+9197${RUN}11`.slice(0, 13);
const TEST_PHONES = [PHONE_A, PHONE_B];

async function latestInboxCode(phone: string): Promise<string> {
  const [row] = await db
    .select()
    .from(otpInbox)
    .where(eq(otpInbox.phone, phone))
    .orderBy(desc(otpInbox.createdAt))
    .limit(1);
  if (row === undefined) {
    throw new Error("no code delivered");
  }
  return row.code;
}

afterAll(async () => {
  await db.delete(otpCodes).where(inArray(otpCodes.phone, TEST_PHONES));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, TEST_PHONES));
  const persons = await db.select().from(people).where(inArray(people.phone, TEST_PHONES));
  const ids = persons.map((p) => p.id);
  if (ids.length > 0) {
    await db.delete(sessions).where(inArray(sessions.personId, ids));
    await db.delete(people).where(inArray(people.id, ids));
  }
  await handle.sql.end();
});

describe("OTP login against real Postgres", () => {
  it("full journey: request → dev inbox → verify → person created", async () => {
    const requested = await requestOtp(db, sender, PHONE_A);
    expect(requested).toEqual({ ok: true });
    const code = await latestInboxCode(PHONE_A);
    expect(code).toMatch(/^\d{6}$/);
    const verified = await verifyOtp(db, PHONE_A, code);
    expect(verified.ok).toBe(true);
    const [person] = await db.select().from(people).where(eq(people.phone, PHONE_A));
    expect(person).toBeDefined();
  });

  it("a consumed code cannot be replayed", async () => {
    const code = await latestInboxCode(PHONE_A);
    const replay = await verifyOtp(db, PHONE_A, code);
    expect(replay).toEqual({ ok: false, reason: "invalid" });
  });

  it("resend inside the 30s cooldown is refused", async () => {
    await requestOtp(db, sender, PHONE_B);
    const second = await requestOtp(db, sender, PHONE_B);
    expect(second).toEqual({ ok: false, reason: "cooldown" });
  });

  it("wrong codes burn attempts; the 5th lockout survives even the right code", async () => {
    const code = await latestInboxCode(PHONE_B);
    // Each rejection now says how much rope is left — the count is what turns
    // "that code didn't work" from a shrug into something actionable.
    for (const attemptsLeft of [4, 3, 2, 1]) {
      expect(await verifyOtp(db, PHONE_B, "000000")).toEqual({
        ok: false,
        reason: "invalid",
        attemptsLeft,
      });
    }
    // The fifth exhausts it, and every call after that names the real reason.
    expect(await verifyOtp(db, PHONE_B, "000000")).toEqual({ ok: false, reason: "locked" });
    expect(await verifyOtp(db, PHONE_B, code)).toEqual({ ok: false, reason: "locked" });
  });

  it("no-enumeration: unknown and known phones fail verification identically", async () => {
    const unknown = await verifyOtp(db, "+919000000001", "123456");
    const known = await verifyOtp(db, PHONE_A, "123456");
    expect(unknown).toEqual(known);
  });

  it("sessions: create → fetch → revoke → gone", async () => {
    const [person] = await db.select().from(people).where(eq(people.phone, PHONE_A));
    expect(person).toBeDefined();
    if (person === undefined) {
      return;
    }
    const { token } = await createSession(db, person.id, "vitest");
    const info = await getSessionByToken(db, token);
    expect(info?.phone).toBe(PHONE_A);
    if (info === null) {
      return;
    }
    await revokeSession(db, info.sessionId);
    expect(await getSessionByToken(db, token)).toBeNull();
  });

  // The sliding window renews `expires_at` on every visit, so before the
  // absolute ceiling a session that was used once a month never expired at all.
  // The row this test builds is the exact shape that used to survive: seen
  // seconds ago, thirty days from expiry, and older than the product has any
  // business trusting a single authentication for.
  it("absolute lifetime: a session past the cap is refused however recently it was used", async () => {
    const [person] = await db.select().from(people).where(eq(people.phone, PHONE_A));
    expect(person).toBeDefined();
    if (person === undefined) {
      return;
    }
    const { token } = await createSession(db, person.id, "vitest-absolute");
    const fresh = await getSessionByToken(db, token);
    expect(fresh?.personId).toBe(person.id);
    if (fresh === null) {
      return;
    }
    const DAY = 24 * 60 * 60 * 1000;
    await db
      .update(sessions)
      .set({
        createdAt: new Date(Date.now() - 100 * DAY),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * DAY),
      })
      .where(eq(sessions.id, fresh.sessionId));
    expect(await getSessionByToken(db, token)).toBeNull();

    // …and the ceiling is a ceiling, not a kill switch: a session inside it
    // still authenticates, including one old enough that the read slides it.
    const { token: current } = await createSession(db, person.id, "vitest-current");
    const opened = await getSessionByToken(db, current);
    expect(opened?.personId).toBe(person.id);
    if (opened === null) {
      return;
    }
    await db
      .update(sessions)
      .set({
        // 80 days old and two days since the last visit: inside the ceiling, so
        // it opens — and stale enough that the read slides it, so the clamp is
        // the thing under test (an unclamped slide would ask for 30 more days
        // when only 10 remain).
        createdAt: new Date(Date.now() - 80 * DAY),
        lastSeenAt: new Date(Date.now() - 2 * DAY),
      })
      .where(eq(sessions.id, opened.sessionId));
    expect((await getSessionByToken(db, current))?.personId).toBe(person.id);
    const [slid] = await db
      .select({ expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.id, opened.sessionId));
    expect(slid).toBeDefined();
    expect(slid?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(slid?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 11 * DAY);
  });

  it("garbage tokens never resolve", async () => {
    expect(await getSessionByToken(db, "not-a-real-token")).toBeNull();
  });
});
