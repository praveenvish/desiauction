// PERMANENT SECURITY REGRESSION SUITE (M-IP2-2). These tests are engineering
// assets: they encode the security contract of the identity system and must
// never be weakened without an RC-4-grade review. Real Postgres; unique
// phones per run; passkey CEREMONIES are covered by e2e with a virtual
// authenticator — here we prove the server-side glue fails closed.
import {
  auditLog,
  createDb,
  otpCodes,
  otpInbox,
  people,
  sessions,
  type DbHandle,
} from "@desiauction/db";
import { desc, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { consumeCode, requestOtp, verifyOtp } from "./otp";
import { DevInboxSender } from "./otp-sender";
import { finishAuthentication, finishEnrollment } from "./passkeys";
import { createSession, getSessionByToken, listSessions, revokeSession } from "./sessions";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_A = `+9196${RUN}0`;
const PHONE_B = `+9197${RUN}1`;
const PHONE_C = `+9198${RUN}2`;
const PHONE_D = `+9199${RUN}3`;
const PHONE_E = `+9196${RUN}4`;
const TEST_PHONES = [PHONE_A, PHONE_B, PHONE_C, PHONE_D, PHONE_E];

async function loginFresh(phone: string): Promise<string> {
  await requestOtp(db, sender, phone);
  const [row] = await db
    .select()
    .from(otpInbox)
    .where(eq(otpInbox.phone, phone))
    .orderBy(desc(otpInbox.createdAt))
    .limit(1);
  if (row === undefined) {
    throw new Error("no code");
  }
  const verified = await verifyOtp(db, phone, row.code);
  if (!verified.ok) {
    throw new Error("login failed");
  }
  return verified.personId;
}

afterAll(async () => {
  const persons = await db.select().from(people).where(inArray(people.phone, TEST_PHONES));
  const ids = persons.map((p) => p.id);
  if (ids.length > 0) {
    await db.delete(sessions).where(inArray(sessions.personId, ids));
    await db.delete(auditLog).where(inArray(auditLog.actor, ids));
    await db.delete(people).where(inArray(people.id, ids));
  }
  await db.delete(otpCodes).where(inArray(otpCodes.phone, TEST_PHONES));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, TEST_PHONES));
  await handle.sql.end();
});

describe("SECURITY REGRESSION — identity contract", () => {
  it("OTP replay: a consumed code is dead forever", async () => {
    await loginFresh(PHONE_A);
    const [row] = await db
      .select()
      .from(otpInbox)
      .where(eq(otpInbox.phone, PHONE_A))
      .orderBy(desc(otpInbox.createdAt))
      .limit(1);
    expect(await verifyOtp(db, PHONE_A, row?.code ?? "")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("enumeration resistance: unknown and known phones fail identically", async () => {
    const unknown = await verifyOtp(db, "+919111111111", "123456");
    const known = await verifyOtp(db, PHONE_A, "123456");
    expect(unknown).toEqual(known);
  });

  it("lockout: five wrong attempts kill the code AND leave a security event", async () => {
    // Fresh code for A (cooldown has passed within test flow? force by direct request)
    await db.delete(otpCodes).where(eq(otpCodes.phone, PHONE_A));
    await requestOtp(db, sender, PHONE_A);
    for (let i = 0; i < 5; i++) {
      await verifyOtp(db, PHONE_A, "999999");
    }
    const [row] = await db
      .select()
      .from(otpInbox)
      .where(eq(otpInbox.phone, PHONE_A))
      .orderBy(desc(otpInbox.createdAt))
      .limit(1);
    // "locked", not the generic "invalid": only a phone that HAS a live code
    // can ever see this reason, so there is nothing here to enumerate — and the
    // person holding the correct code is finally told why it stopped working.
    expect(await verifyOtp(db, PHONE_A, row?.code ?? "")).toEqual({
      ok: false,
      reason: "locked",
    });
    const [person] = await db.select().from(people).where(eq(people.phone, PHONE_A));
    const events = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.actor, person?.id ?? ""));
    expect(events.some((event) => event.action === "auth.otp.lockout")).toBe(true);
  });

  it("attempt cap holds under CONCURRENCY: parallel wrong guesses cannot exceed MAX (RC-4 F3)", async () => {
    await requestOtp(db, sender, PHONE_C);
    const [row] = await db
      .select()
      .from(otpCodes)
      .where(eq(otpCodes.phone, PHONE_C))
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);
    if (row === undefined) {
      throw new Error("no code");
    }
    // Fire many more wrong guesses than the cap, all at once. The atomic
    // guarded increment must ceiling the counter at MAX — a read-modify-write
    // would let concurrent readers collapse into far fewer increments.
    await Promise.all(Array.from({ length: 12 }, () => verifyOtp(db, PHONE_C, "000000")));
    const [after] = await db.select().from(otpCodes).where(eq(otpCodes.id, row.id)).limit(1);
    expect(after?.attempts).toBe(5);
    // And the real code is dead — the cap was genuinely reached, not skipped.
    const [live] = await db
      .select()
      .from(otpInbox)
      .where(eq(otpInbox.phone, PHONE_C))
      .orderBy(desc(otpInbox.createdAt))
      .limit(1);
    expect(await verifyOtp(db, PHONE_C, live?.code ?? "")).toEqual({
      ok: false,
      reason: "locked",
    });
  });

  it("a CORRECT guess inside a parallel burst still spends an attempt — no evaluation past the cap", async () => {
    // The wrong-guess increment was already atomic (above), but the success
    // branch only checked a snapshot read taken BEFORE the burst's increments
    // landed. A thousand parallel guesses therefore all saw attempts=0 and the
    // right one consumed the code regardless of the cap. Every evaluation must
    // reserve an attempt first, so at most the remaining budget is ever compared.
    await requestOtp(db, sender, PHONE_D);
    const [row] = await db
      .select()
      .from(otpCodes)
      .where(eq(otpCodes.phone, PHONE_D))
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);
    const [inbox] = await db
      .select()
      .from(otpInbox)
      .where(eq(otpInbox.phone, PHONE_D))
      .orderBy(desc(otpInbox.createdAt))
      .limit(1);
    if (row === undefined || inbox === undefined) {
      throw new Error("no code");
    }
    // One attempt left, then a burst of wrong guesses with the right code last.
    await db.update(otpCodes).set({ attempts: 4 }).where(eq(otpCodes.id, row.id));
    const wrong = inbox.code === "000000" ? "111111" : "000000";
    const results = await Promise.all([
      ...Array.from({ length: 20 }, () => consumeCode(db, PHONE_D, wrong)),
      consumeCode(db, PHONE_D, inbox.code),
    ]);
    const evaluated = results.filter(
      (r) => r.ok || r.reason === "invalid" || (r.reason === "locked" && r.lockedOut === true),
    );
    expect(evaluated.length).toBeLessThanOrEqual(1);
    const [after] = await db.select().from(otpCodes).where(eq(otpCodes.id, row.id)).limit(1);
    expect(after?.attempts).toBe(5);
  });

  it("the platform-wide ceiling refuses a send once the last hour's codes reach it", async () => {
    // Earlier tests in this file minted codes within the hour, so a ceiling of
    // one is already reached: the send is refused as `busy` and nothing is minted.
    const before = await db.select().from(otpCodes).where(eq(otpCodes.phone, PHONE_E));
    expect(await requestOtp(db, sender, PHONE_E, null, "login", 1)).toEqual({
      ok: false,
      reason: "busy",
    });
    const after = await db.select().from(otpCodes).where(eq(otpCodes.phone, PHONE_E));
    expect(after.length).toBe(before.length);
  });

  it("session rotation: every login mints a distinct token; both are independently revocable", async () => {
    const [person] = await db.select().from(people).where(eq(people.phone, PHONE_A));
    expect(person).toBeDefined();
    if (person === undefined) {
      return;
    }
    const first = await createSession(db, person.id, "device-1");
    const second = await createSession(db, person.id, "device-2");
    expect(first.token).not.toBe(second.token);
    const info = await getSessionByToken(db, first.token);
    if (info !== null) {
      await revokeSession(db, info.sessionId);
    }
    expect(await getSessionByToken(db, first.token)).toBeNull();
    expect(await getSessionByToken(db, second.token)).not.toBeNull();
  });

  it("person isolation: session listings never cross accounts", async () => {
    const personB = await loginFresh(PHONE_B);
    const [personA] = await db.select().from(people).where(eq(people.phone, PHONE_A));
    if (personA === undefined) {
      return;
    }
    await createSession(db, personB, "b-device");
    const aSessions = await listSessions(db, personA.id);
    const bSessions = await listSessions(db, personB);
    expect(bSessions.length).toBeGreaterThan(0);
    expect(aSessions.every((s) => !bSessions.some((b) => b.id === s.id))).toBe(true);
  });

  it("passkey auth fails closed: unknown credential, garbage payloads", async () => {
    const unknown = await finishAuthentication(db, "challenge", {
      id: "nonexistent-credential",
      rawId: "nonexistent-credential",
      response: {},
      type: "public-key",
      clientExtensionResults: {},
    } as never);
    expect(unknown).toEqual({ ok: false });
  });

  it("passkey enrollment fails closed on a forged challenge", async () => {
    const [person] = await db.select().from(people).where(eq(people.phone, PHONE_A));
    if (person === undefined) {
      return;
    }
    await expect(
      finishEnrollment(
        db,
        person.id,
        "forged-challenge",
        {
          id: "x",
          rawId: "x",
          response: { clientDataJSON: "e30", attestationObject: "e30" },
          type: "public-key",
          clientExtensionResults: {},
        } as never,
        "Fake device",
      ),
    ).rejects.toThrow();
  });
});
