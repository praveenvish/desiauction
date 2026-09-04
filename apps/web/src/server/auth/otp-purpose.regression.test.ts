// Against real Postgres. PI-1 P2: a code is minted FOR a purpose and
// consumable for that purpose alone. These are the two cross-purpose refusals
// the column exists for, plus the request-side ledger row and the terms
// consent record — none of which may alter the frozen login journey (the
// auth.integration and security.regression suites run UNMODIFIED beside this).
import {
  auditLog,
  consentRecords,
  createDb,
  newId,
  otpCodes,
  otpInbox,
  people,
  type DbHandle,
} from "@desiauction/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { consumeCode, requestOtp, verifyOtp } from "./otp";
import { DevInboxSender } from "./otp-sender";
import { TERMS_CONSENT_PURPOSE, TERMS_NOTICE_VERSION, ensureTermsConsent } from "./terms-consent";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

// Distinct prefixes, run stamp in the tail (the auth.integration pattern) —
// distinctness must live BEFORE the stamp or a slice folds two phones into one.
const RUN = String(Date.now()).slice(-8);
const PHONE_LOGIN = `+9186${RUN}`;
const PHONE_CHANGE = `+9187${RUN}`;
const PHONE_LEDGER = `+9188${RUN}`;
const TEST_PHONES = [PHONE_LOGIN, PHONE_CHANGE, PHONE_LEDGER];

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
    await db.delete(auditLog).where(inArray(auditLog.scopeId, ids));
    await db.delete(consentRecords).where(inArray(consentRecords.personId, ids));
    await db.delete(people).where(inArray(people.id, ids));
  }
  await handle.sql.end();
});

describe("OTP purpose separation (PI-1)", () => {
  it("a login code cannot confirm a phone change", async () => {
    const requested = await requestOtp(db, sender, PHONE_LOGIN);
    expect(requested).toEqual({ ok: true });
    const code = await latestInboxCode(PHONE_LOGIN);
    const crossed = await consumeCode(db, PHONE_LOGIN, code, "phone_change");
    // No phone_change candidate exists at all — the generic refusal, with no
    // attempt burned against the login code it must not see.
    expect(crossed).toEqual({ ok: false, reason: "invalid" });
    const consumed = await consumeCode(db, PHONE_LOGIN, code);
    expect(consumed).toEqual({ ok: true });
  });

  it("a phone-change code cannot sign anybody in", async () => {
    const requested = await requestOtp(db, sender, PHONE_CHANGE, null, "phone_change");
    expect(requested).toEqual({ ok: true });
    const code = await latestInboxCode(PHONE_CHANGE);
    const crossed = await verifyOtp(db, PHONE_CHANGE, code);
    expect(crossed).toEqual({ ok: false, reason: "invalid" });
    // No person was created by the refused sign-in.
    const persons = await db.select().from(people).where(eq(people.phone, PHONE_CHANGE));
    expect(persons).toHaveLength(0);
    // The right purpose still consumes it.
    const consumed = await consumeCode(db, PHONE_CHANGE, code, "phone_change");
    expect(consumed).toEqual({ ok: true });
  });

  it("stamps the purpose on the row, defaulting to login", async () => {
    const rows = await db
      .select({ phone: otpCodes.phone, purpose: otpCodes.purpose })
      .from(otpCodes)
      .where(inArray(otpCodes.phone, [PHONE_LOGIN, PHONE_CHANGE]));
    expect(rows.find((r) => r.phone === PHONE_LOGIN)?.purpose).toBe("login");
    expect(rows.find((r) => r.phone === PHONE_CHANGE)?.purpose).toBe("phone_change");
  });
});

describe("request-side ledger row (PI-1 audit-gap closure)", () => {
  it("writes auth.otp.requested once a person exists to own it", async () => {
    // First request: no person yet, so no ledger — structurally, not by choice.
    await requestOtp(db, sender, PHONE_LEDGER);
    const code = await latestInboxCode(PHONE_LEDGER);
    const verified = await verifyOtp(db, PHONE_LEDGER, code);
    if (!verified.ok) {
      throw new Error("login journey broke under the purpose column");
    }
    // Second request: the person exists; the request becomes evidence.
    const again = await requestOtp(db, sender, PHONE_LEDGER);
    expect(again).toEqual({ ok: true });
    const events = await db
      .select({ meta: auditLog.meta })
      .from(auditLog)
      .where(
        and(eq(auditLog.scopeId, verified.personId), eq(auditLog.action, "auth.otp.requested")),
      );
    expect(events).toHaveLength(1);
    expect((events[0]?.meta as { purpose?: string }).purpose).toBe("login");
  });
});

describe("terms consent record (PI-1 P2 — the pre-GA notice obligation)", () => {
  it("records acceptance once per person per notice version", async () => {
    const personId = newId();
    const phone = `+9189${RUN}`;
    TEST_PHONES.push(phone);
    await db.insert(people).values({ id: personId, phone, name: "Terms Synthetic" });

    await ensureTermsConsent(db, personId);
    await ensureTermsConsent(db, personId);

    const rows = await db
      .select()
      .from(consentRecords)
      .where(
        and(
          eq(consentRecords.personId, personId),
          eq(consentRecords.purpose, TERMS_CONSENT_PURPOSE),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.granted).toBe(true);
    expect(rows[0]?.source).toBe("login");
    expect((rows[0]?.evidence as { noticeVersion?: string }).noticeVersion).toBe(
      TERMS_NOTICE_VERSION,
    );
  });
});
