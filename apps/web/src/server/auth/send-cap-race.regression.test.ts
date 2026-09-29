// Against real Postgres, and in parallel — which is the whole point. The send
// caps were each "count, then insert" as separate statements, so requests that
// arrived together all counted zero and all sent (PRR 2026-09-29). These pin
// the caps under the one condition they are for: a script, not a thumb.
import {
  createDb,
  emailVerifications,
  newId,
  otpCodes,
  otpInbox,
  people,
  type DbHandle,
} from "@desiauction/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { requestEmailVerification } from "./email-change";
import { requestEmailLogin } from "./email-login";
import { requestOtp } from "./otp";
import type { OtpSender } from "./otp-sender";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const RUN = String(Date.now()).slice(-8);
const PHONE_BURST = `+9181${RUN}`;
const PHONE_IP_PREFIX = `+9182${RUN.slice(0, 6)}`;
const IP_PHONES = Array.from(
  { length: 30 },
  (_, i) => `${PHONE_IP_PREFIX}${String(i).padStart(2, "0")}`,
);
const EMAIL_BURST = `burst${RUN}@example.test`;
const SOURCE_IP = `203.0.113.${String(Number(RUN.slice(-2)) + 1)}`;
const person = newId();

/** Counts what would have been paid for; never touches a provider. */
function countingSender(): { sender: OtpSender; sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    sender: {
      channel: "sms",
      send: (phone: string) => {
        sent.push(phone);
        return Promise.resolve();
      },
    },
  };
}

beforeAll(async () => {
  await db.insert(people).values({ id: person, phone: `+9183${RUN}`, name: "Burst" });
});

afterAll(async () => {
  const phones = [PHONE_BURST, ...IP_PHONES];
  await db.delete(otpCodes).where(inArray(otpCodes.phone, phones));
  await db.delete(otpInbox).where(inArray(otpInbox.phone, phones));
  await db.delete(emailVerifications).where(eq(emailVerifications.email, EMAIL_BURST));
  await db.delete(emailVerifications).where(eq(emailVerifications.personId, person));
  await db.delete(people).where(eq(people.id, person));
  await handle.sql.end();
});

describe("send caps, under parallel requests", () => {
  it("one handset: twenty requests at once send ONE code — the cooldown holds", async () => {
    const { sender, sent } = countingSender();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => requestOtp(db, sender, PHONE_BURST, null)),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.reason === "cooldown")).toHaveLength(19);
    expect(sent).toEqual([PHONE_BURST]);
    const rows = await db.select().from(otpCodes).where(eq(otpCodes.phone, PHONE_BURST));
    expect(rows).toHaveLength(1);
  });

  it("one source address: thirty handsets at once stop at the per-address cap of 20", async () => {
    const { sender, sent } = countingSender();
    const results = await Promise.all(
      IP_PHONES.map((phone) => requestOtp(db, sender, phone, SOURCE_IP)),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(20);
    expect(sent).toHaveLength(20);
    const rows = await db.select().from(otpCodes).where(eq(otpCodes.requestIp, SOURCE_IP));
    expect(rows).toHaveLength(20);
  });

  it("one mailbox: twenty sign-in requests at once mint five codes — the hourly cap holds", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => requestEmailLogin(db, { email: EMAIL_BURST })),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(5);
    const rows = await db
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.email, EMAIL_BURST));
    expect(rows).toHaveLength(5);
  });

  it("one account: twenty address changes at once, to twenty mailboxes, mint five codes", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        requestEmailVerification(db, {
          personId: person,
          email: `spray${RUN}-${String(i)}@example.test`,
        }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(5);
    const rows = await db
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.personId, person));
    expect(rows).toHaveLength(5);
  });
});
