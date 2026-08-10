import { createDb, newId, otpCodes, otpInbox, people, type DbHandle } from "@desiauction/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { hashCode } from "./otp";
import { DevInboxSender } from "./otp-sender";
import { confirmPhoneChange, requestPhoneChange } from "./phone-change";

/**
 * Changing the one credential this product has.
 *
 * Sign-in is phone-first, so `people.phone` IS the password — and nothing in
 * the product ever changed it. That made a lost number an unrecoverable lockout
 * and a recycled number an account takeover. What is asserted here is not the
 * happy path (one line) but the four properties that make the flow safe to
 * ship: the code is required, a number belonging to somebody else is refused,
 * the OLD number stops signing in, and the code is burned before the collision
 * is answered so the form cannot be used as a registry oracle.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
// EXACTLY ten digits after +91. `+91` + 7-char RUN + 2 = 9 needs one lead
// digit prefix plus a suffix — an eleven-digit fixture makes every case fail on the test's
// own bad data rather than on the code, which is how the last one wasted a run.
const OLD = `+9198${RUN}1`;
const NEW = `+9198${RUN}2`;
const OTHERS = `+9198${RUN}3`;
const SPARE = `+9198${RUN}4`;
const PHONES = [OLD, NEW, OTHERS, SPARE];

let personId = "";
let otherId = "";

/** The code the dev sender just wrote, read back the only way a handset could. */
async function latestCode(phone: string): Promise<string> {
  const [row] = await db
    .select({ codeHash: otpCodes.codeHash })
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);
  if (row === undefined) {
    throw new Error(`no pending code for ${phone}`);
  }
  // The dev inbox holds the plaintext; matching it against the hash proves the
  // row and the message are the same code rather than assuming it.
  const [message] = await db
    .select({ code: otpInbox.code })
    .from(otpInbox)
    .where(eq(otpInbox.phone, phone))
    .orderBy(desc(otpInbox.createdAt))
    .limit(1);
  const code = message?.code ?? "";
  if (hashCode(code) !== row.codeHash) {
    throw new Error("dev inbox and otp_codes disagree about the code");
  }
  return code;
}

beforeAll(async () => {
  await db.delete(otpCodes).where(inArray(otpCodes.phone, PHONES));
  await db.delete(people).where(inArray(people.phone, PHONES));
  personId = newId();
  otherId = newId();
  await db.insert(people).values([
    { id: personId, phone: OLD, name: "Moving Person" },
    { id: otherId, phone: OTHERS, name: "Somebody Else" },
  ]);
});

afterAll(async () => {
  await db.delete(otpCodes).where(inArray(otpCodes.phone, PHONES));
  await db.delete(people).where(inArray(people.id, [personId, otherId]));
  await handle.sql.end({ timeout: 5 });
});

describe("requesting the change", () => {
  it("refuses a number that is not an Indian mobile", async () => {
    const result = await requestPhoneChange(db, sender, {
      personId,
      newPhone: "12345",
    });
    expect(result).toEqual({ ok: false, reason: "invalid-phone" });
  });

  it("refuses the number already on the account", async () => {
    // Otherwise a person could re-verify the handset they are holding and the
    // product would record it as a change.
    const result = await requestPhoneChange(db, sender, { personId, newPhone: OLD });
    expect(result).toEqual({ ok: false, reason: "same-number" });
  });

  it("sends for a number that belongs to somebody ELSE, rather than refusing", async () => {
    // The no-oracle property. Refusing here would let anyone with an account
    // type numbers and learn which are registered. The collision is answered
    // only after a code is burned, which costs possession of the handset.
    const result = await requestPhoneChange(db, sender, { personId, newPhone: OTHERS });
    expect(result).toEqual({ ok: true });
  });
});

describe("confirming the change", () => {
  it("refuses a wrong code and does NOT move the number", async () => {
    await requestPhoneChange(db, sender, { personId, newPhone: NEW });
    const result = await confirmPhoneChange(db, { personId, newPhone: NEW, code: "000000" });
    expect(result.ok).toBe(false);
    const [row] = await db
      .select({ phone: people.phone })
      .from(people)
      .where(eq(people.id, personId));
    expect(row?.phone, "a wrong code must leave the credential alone").toBe(OLD);
  });

  it("refuses a number that already signs in to another account", async () => {
    const code = await latestCode(OTHERS);
    const result = await confirmPhoneChange(db, { personId, newPhone: OTHERS, code });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("taken");
    }
    const [mine] = await db
      .select({ phone: people.phone })
      .from(people)
      .where(eq(people.id, personId));
    const [theirs] = await db
      .select({ phone: people.phone })
      .from(people)
      .where(eq(people.id, otherId));
    expect(mine?.phone).toBe(OLD);
    expect(theirs?.phone, "the other account is untouched").toBe(OTHERS);
  });

  it("burns the code BEFORE answering the collision", async () => {
    // The oracle closes here or not at all: if the collision were checked
    // first, the refusal above would have cost nothing and could be repeated
    // against any number. The code from that attempt must now be spent.
    const [pending] = await db
      .select({ id: otpCodes.id })
      .from(otpCodes)
      .where(and(eq(otpCodes.phone, OTHERS), isNull(otpCodes.consumedAt)))
      .limit(1);
    expect(pending, "the refused attempt consumed its code").toBeUndefined();
  });

  it("moves the number, and the OLD one stops signing in to the account", async () => {
    await db.delete(otpCodes).where(eq(otpCodes.phone, SPARE));
    await requestPhoneChange(db, sender, { personId, newPhone: SPARE });
    const result = await confirmPhoneChange(db, {
      personId,
      newPhone: SPARE,
      code: await latestCode(SPARE),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.previousPhone).toBe(OLD);
      expect(result.newPhone).toBe(SPARE);
    }
    const [moved] = await db
      .select({ phone: people.phone })
      .from(people)
      .where(eq(people.id, personId));
    expect(moved?.phone).toBe(SPARE);
    // The half that makes this a takeover mitigation rather than a convenience:
    // the released number must no longer resolve to this person, so whoever the
    // carrier gives it to next cannot sign in as them.
    const [orphan] = await db.select({ id: people.id }).from(people).where(eq(people.phone, OLD));
    expect(orphan, "the released number belongs to nobody").toBeUndefined();
  });
});
