import { createECDH } from "node:crypto";

import {
  consentRecords,
  createDb,
  newId,
  notificationPreferences,
  people,
  pushSubscriptions,
  type DbHandle,
} from "@desiauction/db";
import { generateVapidKeys, type PushTransport } from "@desiauction/messaging/web-push";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { setPreference } from "./consent";
import { isPushable, pushInboxNotice, pushNoticeFor, savePushSubscription } from "./push";

/**
 * WEB PUSH (email programme PR18), against a real database: the inbox notice
 * reaches each device, follows the Inbox switch, never pushes the ledger's
 * routine rows, and forgets a device its push service has dropped.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

const person = newId();
const keys = { ...generateVapidKeys(), subject: "mailto:support@desiauction.in" };
const browser = createECDH("prime256v1");
browser.generateKeys();
const ENDPOINT = `https://fcm.googleapis.com/fcm/send/test-${RUN}`;

function recording(status: number): { transport: PushTransport; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    transport: (url) => {
      calls.push(url);
      return Promise.resolve({ status, body: "" });
    },
  };
}

beforeAll(async () => {
  await db.insert(people).values({ id: person, phone: `+9192${RUN}1`, name: "Pushed" });
  await savePushSubscription(db, person, {
    endpoint: ENDPOINT,
    p256dh: browser.getPublicKey().toString("base64url"),
    auth: Buffer.from("0123456789abcdef").toString("base64url"),
    userAgent: "test",
  });
});

afterAll(async () => {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.personId, person));
  await db.delete(notificationPreferences).where(eq(notificationPreferences.personId, person));
  await db.delete(consentRecords).where(inArray(consentRecords.personId, [person]));
  await db.delete(people).where(eq(people.id, person));
  await handle.sql.end();
});

describe("what pushes", () => {
  it("only the notification kinds — never a sign-in or a renamed passkey", () => {
    expect(isPushable("auction.sold")).toBe(true);
    expect(isPushable("fixture.lineup_announced")).toBe(true);
    expect(isPushable("auth.login.otp")).toBe(false);
    expect(isPushable("auth.passkey.renamed")).toBe(false);
  });

  it("says what the inbox row says, and opens the inbox", () => {
    expect(pushNoticeFor("auction.sold", { team: "Cup Kings", price: "₹75,000" })).toEqual({
      title: "DesiAuction",
      body: "You were sold at auction — Cup Kings · ₹75,000",
      url: "/inbox",
      tag: "auction.sold",
    });
  });
});

describe("pushing a notice", () => {
  it("reaches the person's device and stamps it", async () => {
    const { transport, calls } = recording(201);
    expect(await pushInboxNotice(person, "auction.sold", null, { keys, transport, db })).toEqual({
      sent: 1,
      gone: 0,
    });
    expect(calls).toEqual([ENDPOINT]);
    const [row] = await db
      .select({ lastSentAt: pushSubscriptions.lastSentAt })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.personId, person));
    expect(row?.lastSentAt).not.toBeNull();
  });

  it("does nothing when web push is not configured, or for a routine ledger row", async () => {
    const { transport, calls } = recording(201);
    await pushInboxNotice(person, "auction.sold", null, { keys: null, transport, db });
    await pushInboxNotice(person, "auth.login.otp", null, { keys, transport, db });
    expect(calls).toHaveLength(0);
  });

  it("follows the Inbox switch — a topic hidden from the inbox is not pushed", async () => {
    await setPreference(db, {
      personId: person,
      topic: "auction",
      channel: "in-app",
      allowed: false,
    });
    const { transport, calls } = recording(201);
    expect(await pushInboxNotice(person, "auction.sold", null, { keys, transport, db })).toEqual({
      sent: 0,
      gone: 0,
    });
    expect(calls).toHaveLength(0);
    await setPreference(db, {
      personId: person,
      topic: "auction",
      channel: "in-app",
      allowed: true,
    });
  });

  it("forgets a device its push service says is gone", async () => {
    const { transport } = recording(410);
    expect(await pushInboxNotice(person, "auction.sold", null, { keys, transport, db })).toEqual({
      sent: 0,
      gone: 1,
    });
    const rows = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.personId, person));
    expect(rows).toHaveLength(0);
  });
});
