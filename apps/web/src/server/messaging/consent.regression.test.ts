import {
  consentRecords,
  createDb,
  newId,
  notificationPreferences,
  orgMessagingSettings as orgMessagingSettingsTable,
  people,
  suppressions as suppressionsTable,
  withTenantDb,
  type DbHandle,
} from "@desiauction/db";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import {
  liftSuppression,
  maySend,
  orgMessagingSettingsFor,
  preferencesFor,
  recordConsent,
  setOrgMessagingSetting,
  setPreference,
  suppress,
} from "./consent";
import { applyInbound } from "./inbound";

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

/** The club used by the org-settings block, hoisted so cleanup can find it. */
const ORG = newId();
const ACTOR = newId();

beforeAll(async () => {
  await db.delete(people).where(inArray(people.phone, PHONES));
  plainId = newId();
  await db.insert(people).values({ id: plainId, phone: PHONE_PLAIN, name: "Consent Synthetic" });
});

afterAll(async () => {
  await db.delete(notificationPreferences).where(eq(notificationPreferences.personId, plainId));
  await db.delete(consentRecords).where(eq(consentRecords.personId, plainId));
  await db.delete(suppressionsTable).where(like(suppressionsTable.contact, `%${RUN}%`));
  await db.delete(orgMessagingSettingsTable).where(eq(orgMessagingSettingsTable.updatedBy, ACTOR));
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

describe("an inbound STOP closes the loop", () => {
  // The property the whole feature exists for: a person replies STOP to a
  // message, and the next send to that number does not happen. Everything else
  // in this file is a component; this is the outcome.
  const PHONE_INBOUND = `+9195${RUN}04`;

  it("silences a number that texts STOP, and START brings it back", async () => {
    const before = await maySend(db, {
      contact: PHONE_INBOUND,
      channel: "sms",
      category: "transactional",
      scope: "registration",
    });
    expect(before.send, "a number with no history receives messages").toBe(true);

    const stopped = await applyInbound(db, { from: PHONE_INBOUND, body: "STOP" });
    expect(stopped).toEqual({ handled: true, intent: "stop" });

    const after = await maySend(db, {
      contact: PHONE_INBOUND,
      channel: "sms",
      category: "transactional",
      scope: "registration",
    });
    expect(after.send, "a transactional message must not survive a STOP").toBe(false);

    await applyInbound(db, { from: PHONE_INBOUND, body: "START" });
    const resumed = await maySend(db, {
      contact: PHONE_INBOUND,
      channel: "sms",
      category: "transactional",
      scope: "registration",
    });
    expect(resumed.send, "START is the way back in").toBe(true);
  });

  it("normalises a bare number onto the same key a send uses", async () => {
    // The failure this guards: an operator delivers `9512345678`, the send
    // addresses `+919512345678`, and the STOP is recorded against a key nothing
    // ever matches. The person keeps receiving messages having done as told.
    // Exactly ten digits, because that is what a real Indian mobile is and what
    // the normaliser is entitled to assume. An eleven-digit fixture made this
    // test fail on its own bad data, not on the code.
    const bare = `9${RUN}05`;
    await applyInbound(db, { from: bare, body: "STOP" });
    const decision = await maySend(db, {
      contact: `+91${bare}`,
      channel: "sms",
      category: "transactional",
      scope: "registration",
    });
    expect(decision.send).toBe(false);
  });

  it("is idempotent, so a retried STOP does not grow the list", async () => {
    const repeated = `+9195${RUN}06`;
    await applyInbound(db, { from: repeated, body: "STOP" });
    await applyInbound(db, { from: repeated, body: "stop" });
    await applyInbound(db, { from: repeated, body: "STOP!" });
    const rows = await db
      .select({ id: suppressionsTable.id })
      .from(suppressionsTable)
      .where(eq(suppressionsTable.contact, repeated));
    expect(rows.length, "three STOPs, one row").toBe(1);
  });

  it("ignores a message with no instruction rather than acting on it", async () => {
    const chatty = `+9195${RUN}07`;
    const result = await applyInbound(db, { from: chatty, body: "who is this?" });
    expect(result).toEqual({ handled: false, reason: "unknown_keyword" });
    const decision = await maySend(db, {
      contact: chatty,
      channel: "sms",
      category: "transactional",
      scope: "registration",
    });
    expect(decision.send, "an unrecognised reply must not silence anyone").toBe(true);
  });
});

describe("the per-topic switch on /account", () => {
  it("stops a transactional message for the topic it names, and nothing else", async () => {
    // The correction to the original design: the plan said transactional
    // ignores preferences, which would have made every switch on /account
    // decorative, since transactional is all this product sends.
    await setPreference(db, {
      personId: plainId,
      topic: "registration",
      channel: "sms",
      allowed: false,
    });
    const off = await maySend(db, {
      contact: PHONE_PLAIN,
      channel: "sms",
      category: "transactional",
      scope: "registration",
      personId: plainId,
    });
    const other = await maySend(db, {
      contact: PHONE_PLAIN,
      channel: "sms",
      category: "transactional",
      scope: "auction",
      personId: plainId,
    });
    expect(off.send).toBe(false);
    if (!off.send) {
      expect(off.reason).toBe("opted_out");
    }
    expect(other.send, "switching off registrations must not silence auctions").toBe(true);
  });

  it("defaults to ON, so nobody has to opt in to their own decision", async () => {
    const current = await preferencesFor(db, plainId, "sms");
    expect(current["auction"], "a topic with no row is allowed").toBe(true);
    expect(current["registration"], "the one switched off stays off").toBe(false);
  });

  it("turns back on, and leaves consent evidence for both changes", async () => {
    await setPreference(db, {
      personId: plainId,
      topic: "registration",
      channel: "sms",
      allowed: true,
    });
    const back = await maySend(db, {
      contact: PHONE_PLAIN,
      channel: "sms",
      category: "transactional",
      scope: "registration",
      personId: plainId,
    });
    expect(back.send).toBe(true);
    // The setting is upserted — one row — but each change leaves its own
    // consent record, because "when did they turn this off?" is a question
    // about the past that a setting cannot answer.
    const evidence = await db
      .select({ granted: consentRecords.granted })
      .from(consentRecords)
      .where(
        and(eq(consentRecords.personId, plainId), eq(consentRecords.purpose, "sms.registration")),
      );
    expect(evidence.length, "off and on both recorded").toBe(2);
  });
});

describe("the club's own switch", () => {
  /*
   * The third layer of the gate, and the one that could most easily have been
   * built wrong. A club deciding it does not text people is legitimate. A club
   * being able to decide that it DOES, for someone who said otherwise, is not —
   * so the ordering is asserted, not assumed.
   *
   * Tenant-scoped throughout, because unlike the other two tables this one is
   * owned by an org and carries FORCE row level security. A bare handle cannot
   * write it at all, which is the isolation working.
   */
  const tenant = { personId: ACTOR, orgId: ORG };

  it("is inert until a club opens the screen", async () => {
    const decision = await maySend(db, {
      contact: PHONE_PLAIN,
      channel: "sms",
      category: "transactional",
      scope: "registration",
      personId: plainId,
      orgId: ORG,
    });
    expect(decision.send, "no row means the club sends what it sends today").toBe(true);
  });

  it("stops the topic it names for that club, and only that club", async () => {
    await withTenantDb(handle, tenant, (tx) =>
      setOrgMessagingSetting(tx, {
        orgId: ORG,
        topic: "registration",
        channel: "sms",
        enabled: false,
        actorId: ACTOR,
      }),
    );
    const off = await maySend(db, {
      contact: PHONE_PLAIN,
      channel: "sms",
      category: "transactional",
      scope: "registration",
      personId: plainId,
      orgId: ORG,
    });
    expect(off.send).toBe(false);
    if (!off.send) {
      expect(off.reason).toBe("org_disabled");
    }
    const elsewhere = await maySend(db, {
      contact: PHONE_PLAIN,
      channel: "sms",
      category: "transactional",
      scope: "registration",
      personId: plainId,
      orgId: newId(),
    });
    expect(elsewhere.send, "one club's silence is not another's").toBe(true);
    const otherTopic = await maySend(db, {
      contact: PHONE_PLAIN,
      channel: "sms",
      category: "transactional",
      scope: "auction",
      personId: plainId,
      orgId: ORG,
    });
    expect(otherTopic.send, "switching off registrations must not silence auctions").toBe(true);
  });

  it("cannot switch a message back ON for a person who switched it OFF", async () => {
    // The property this whole table is shaped around. A club must never be able
    // to write into somebody's consent, so the person's answer is read first
    // and independently — and the reason reported stays theirs.
    await setPreference(db, {
      personId: plainId,
      topic: "auction",
      channel: "sms",
      allowed: false,
    });
    await withTenantDb(handle, tenant, (tx) =>
      setOrgMessagingSetting(tx, {
        orgId: ORG,
        topic: "auction",
        channel: "sms",
        enabled: true,
        actorId: ACTOR,
      }),
    );
    const decision = await maySend(db, {
      contact: PHONE_PLAIN,
      channel: "sms",
      category: "transactional",
      scope: "auction",
      personId: plainId,
      orgId: ORG,
    });
    expect(decision.send, "the person outranks the club").toBe(false);
    if (!decision.send) {
      expect(decision.reason).toBe("opted_out");
    }
    await setPreference(db, {
      personId: plainId,
      topic: "auction",
      channel: "sms",
      allowed: true,
    });
  });

  it("reads back defaulted, so an untouched topic shows as on", async () => {
    const current = await withTenantDb(handle, tenant, (tx) =>
      orgMessagingSettingsFor(tx, ORG, "sms"),
    );
    expect(current["registration"], "the one switched off stays off").toBe(false);
    expect(current["money"], "a topic with no row is on").toBe(true);
  });

  it("upserts rather than accumulating, so a club has one live answer", async () => {
    await withTenantDb(handle, tenant, async (tx) => {
      await setOrgMessagingSetting(tx, {
        orgId: ORG,
        topic: "registration",
        channel: "sms",
        enabled: true,
        actorId: ACTOR,
      });
      await setOrgMessagingSetting(tx, {
        orgId: ORG,
        topic: "registration",
        channel: "sms",
        enabled: false,
        actorId: ACTOR,
      });
    });
    const rows = await db
      .select({ id: orgMessagingSettingsTable.id })
      .from(orgMessagingSettingsTable)
      .where(
        and(
          eq(orgMessagingSettingsTable.orgId, ORG),
          eq(orgMessagingSettingsTable.topic, "registration"),
        ),
      );
    expect(rows.length, "three writes, one row").toBe(1);
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
    // Scoped to THIS purpose. It used to count every row for the person, which
    // was only ever right by accident — the account switches write consent rows
    // of their own, so an unscoped count measures unrelated agreements.
    const rows = await db
      .select({ granted: consentRecords.granted })
      .from(consentRecords)
      .where(
        and(eq(consentRecords.personId, plainId), eq(consentRecords.purpose, "sms.promotional")),
      );
    expect(rows.length, "append-only: the grant and the withdrawal both survive").toBe(2);
  });
});

describe("quiet hours", () => {
  it("refuses at 2am and allows at 2pm, on the RECIPIENT's clock", async () => {
    // Re-granted first: the withdrawal above would otherwise be the reason, and
    // a test that passes for the wrong reason is worse than no test.
    await recordConsent(db, {
      personId: plainId,
      purpose: "sms.promotional",
      granted: true,
      source: "account",
    });
    const promotional = (now: Date) =>
      maySend(db, {
        contact: PHONE_PLAIN,
        channel: "sms",
        category: "promotional",
        scope: "marketing",
        personId: plainId,
        now,
      });
    // 20:30 UTC is 02:00 IST the next day — the case a naive server-local
    // implementation gets wrong, and the reason the offset is pinned.
    const night = await promotional(new Date("2026-08-10T20:30:00.000Z"));
    expect(night.send).toBe(false);
    if (!night.send) {
      expect(night.reason).toBe("quiet_hours");
    }
    const day = await promotional(new Date("2026-08-10T08:30:00.000Z"));
    expect(day.send, "14:00 IST is inside the window").toBe(true);
  });

  it("never applies quiet hours to a transactional message", async () => {
    // The important asymmetry. With no deferral queue, refusing a decision
    // notice at night would mean the person is never told at all — worse than a
    // text at an awkward time.
    const decision = await maySend(db, {
      contact: PHONE_PLAIN,
      channel: "sms",
      category: "transactional",
      scope: "money",
      personId: plainId,
      now: new Date("2026-08-10T20:30:00.000Z"),
    });
    expect(decision.send).toBe(true);
  });
});
