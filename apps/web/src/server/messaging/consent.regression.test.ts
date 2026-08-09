import { consentRecords, createDb, newId, people, type DbHandle } from "@desiauction/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { liftSuppression, maySend, recordConsent, suppress } from "./consent";

/**
 * The consent gate, against a real database.
 *
 * This is the logic that decides whether a person receives a message they did
 * not ask for, so none of it is asserted from reading the code. Two properties
 * are load-bearing and neither is obvious: a STOP outranks a category we would
 * otherwise be entitled to send, and consent is append-only so the LATEST row
 * wins — an ascending read here would honour a withdrawn opt-in for ever.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const RUN = String(Date.now()).slice(-7);
const PHONE_PLAIN = `+9195${RUN}01`;
const PHONE_STOPPED = `+9195${RUN}02`;
const PHONE_TOPIC = `+9195${RUN}03`;
const PHONES = [PHONE_PLAIN, PHONE_STOPPED, PHONE_TOPIC];

let plainId = "";

beforeAll(async () => {
  await db.delete(people).where(inArray(people.phone, PHONES));
  plainId = newId();
  await db.insert(people).values({ id: plainId, phone: PHONE_PLAIN, name: "Consent Synthetic" });
});

afterAll(async () => {
  await db.delete(people).where(inArray(people.phone, PHONES));
  await handle.sql.end({ timeout: 5 });
});

describe("suppression outranks everything", () => {
  it("lets a transactional message through to a contact with no history", async () => {
    const decision = await maySend(db, {
      contact: PHONE_PLAIN,
      channel: "sms",
      category: "transactional",
      scope: "registration",
      personId: plainId,
    });
    expect(decision.send).toBe(true);
  });

  it("stops a TRANSACTIONAL message after a global STOP", async () => {
    // The property that matters most. A decision notice is transactional and
    // needs no opt-in, but a person who texted STOP must still not receive it.
    await suppress(db, { contact: PHONE_STOPPED, channel: "sms", reason: "stop" });
    const decision = await maySend(db, {
      contact: PHONE_STOPPED,
      channel: "sms",
      category: "transactional",
      scope: "registration",
    });
    expect(decision.send).toBe(false);
    if (!decision.send) {
      expect(decision.reason).toBe("suppressed");
    }
  });

  it("does not leak a suppression across channels", async () => {
    // The STOP above was on SMS. Email is a different address space and a
    // different consent; suppressing one must not silently suppress the other.
    const decision = await maySend(db, {
      contact: PHONE_STOPPED,
      channel: "email",
      category: "transactional",
      scope: "registration",
    });
    expect(decision.send).toBe(true);
  });

  it("scopes a topic suppression to that topic", async () => {
    await suppress(db, {
      contact: PHONE_TOPIC,
      channel: "sms",
      scope: "registration",
      reason: "manual",
    });
    const blocked = await maySend(db, {
      contact: PHONE_TOPIC,
      channel: "sms",
      category: "transactional",
      scope: "registration",
    });
    const other = await maySend(db, {
      contact: PHONE_TOPIC,
      channel: "sms",
      category: "transactional",
      scope: "auction",
    });
    expect(blocked.send).toBe(false);
    expect(other.send, "a registration STOP must not silence auction notices").toBe(true);
  });

  it("sends again once a STOP is lifted by START", async () => {
    await liftSuppression(db, { contact: PHONE_STOPPED, channel: "sms" });
    const decision = await maySend(db, {
      contact: PHONE_STOPPED,
      channel: "sms",
      category: "transactional",
      scope: "registration",
    });
    expect(decision.send).toBe(true);
  });
});

describe("promotional needs a recorded opt-in", () => {
  it("refuses without one", async () => {
    const decision = await maySend(db, {
      contact: PHONE_PLAIN,
      channel: "sms",
      category: "promotional",
      scope: "marketing",
      personId: plainId,
    });
    expect(decision.send).toBe(false);
    if (!decision.send) {
      expect(decision.reason).toBe("no_consent");
    }
  });

  it("refuses when the contact maps to no person at all", async () => {
    const decision = await maySend(db, {
      contact: PHONE_PLAIN,
      channel: "sms",
      category: "promotional",
      scope: "marketing",
    });
    expect(decision.send).toBe(false);
  });

  it("allows it once consent is recorded", async () => {
    await recordConsent(db, {
      personId: plainId,
      purpose: "sms.promotional",
      granted: true,
      source: "account",
      evidence: { wording: "Send me tournament news" },
    });
    const decision = await maySend(db, {
      contact: PHONE_PLAIN,
      channel: "sms",
      category: "promotional",
      scope: "marketing",
      personId: plainId,
    });
    expect(decision.send).toBe(true);
  });

  it("honours a WITHDRAWAL, which is a newer row and not an edit", async () => {
    // The bug this test was written for: the lookup ordered ascending, so it
    // read the original opt-in for ever and a withdrawal changed nothing.
    await recordConsent(db, {
      personId: plainId,
      purpose: "sms.promotional",
      granted: false,
      source: "account",
    });
    const decision = await maySend(db, {
      contact: PHONE_PLAIN,
      channel: "sms",
      category: "promotional",
      scope: "marketing",
      personId: plainId,
    });
    expect(decision.send, "the latest consent row must win").toBe(false);
  });

  it("keeps both rows, so what they agreed to and when stays answerable", async () => {
    const rows = await db
      .select({ granted: consentRecords.granted })
      .from(consentRecords)
      .where(eq(consentRecords.personId, plainId));
    expect(rows.length, "append-only: the grant and the withdrawal both survive").toBe(2);
  });
});
