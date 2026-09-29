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
import {
  MAX_DEVICES_PER_PERSON,
  isPushable,
  pushInboxNotice,
  pushNoticeFor,
  savePushSubscription,
} from "./push";

/**
 * WEB PUSH (email programme PR18), against a real database: the inbox notice
 * reaches each device, follows the Inbox switch, never pushes the ledger's
 * routine rows, and forgets a device its push service has dropped.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

const person = newId();
const stranger = newId();
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
  await db.insert(people).values([
    { id: person, phone: `+9192${RUN}1`, name: "Pushed" },
    { id: stranger, phone: `+9192${RUN}2`, name: "Stranger" },
  ]);
  await savePushSubscription(db, person, {
    endpoint: ENDPOINT,
    p256dh: browser.getPublicKey().toString("base64url"),
    auth: Buffer.from("0123456789abcdef").toString("base64url"),
    userAgent: "test",
  });
});

afterAll(async () => {
  await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.personId, [person, stranger]));
  await db.delete(notificationPreferences).where(eq(notificationPreferences.personId, person));
  await db.delete(consentRecords).where(inArray(consentRecords.personId, [person]));
  await db.delete(people).where(inArray(people.id, [person, stranger]));
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

describe("whose subscription it is", () => {
  const p256dh = browser.getPublicKey().toString("base64url");
  const auth = Buffer.from("0123456789abcdef").toString("base64url");
  const endpoint = `https://fcm.googleapis.com/fcm/send/owned-${RUN}`;

  const ownerOf = async (): Promise<string | undefined> => {
    const [row] = await db
      .select({ personId: pushSubscriptions.personId })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint));
    return row?.personId;
  };

  it("is not taken by naming its endpoint with keys of your own", async () => {
    expect(
      await savePushSubscription(db, person, { endpoint, p256dh, auth, userAgent: null }),
    ).toBe(true);
    const other = createECDH("prime256v1");
    other.generateKeys();
    expect(
      await savePushSubscription(db, stranger, {
        endpoint,
        p256dh: other.getPublicKey().toString("base64url"),
        auth: Buffer.from("fedcba9876543210").toString("base64url"),
        userAgent: null,
      }),
    ).toBe(false);
    expect(await ownerOf()).toBe(person);
  });

  it("moves with the browser: the same keys under a new sign-in re-home the row", async () => {
    expect(
      await savePushSubscription(db, stranger, { endpoint, p256dh, auth, userAgent: null }),
    ).toBe(true);
    expect(await ownerOf()).toBe(stranger);
  });

  it("keeps the newest devices and no more than the ceiling", async () => {
    for (let i = 0; i < MAX_DEVICES_PER_PERSON + 3; i++) {
      await savePushSubscription(db, person, {
        endpoint: `https://fcm.googleapis.com/fcm/send/cap-${RUN}-${String(i)}`,
        p256dh,
        auth,
        userAgent: null,
      });
    }
    const rows = await db
      .select({ endpoint: pushSubscriptions.endpoint })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.personId, person));
    expect(rows).toHaveLength(MAX_DEVICES_PER_PERSON);
    expect(rows.map((row) => row.endpoint)).toContain(
      `https://fcm.googleapis.com/fcm/send/cap-${RUN}-${String(MAX_DEVICES_PER_PERSON + 2)}`,
    );
  });

  it("forgets a stored address that is not a push service without calling it", async () => {
    // A row from before the allow-list existed: written straight to the table.
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.personId, person));
    await db.insert(pushSubscriptions).values({
      id: newId(),
      personId: person,
      endpoint: `https://attacker.example/${RUN}`,
      p256dh,
      auth,
    });
    const { transport, calls } = recording(201);
    expect(await pushInboxNotice(person, "auction.sold", null, { keys, transport, db })).toEqual({
      sent: 0,
      gone: 1,
    });
    expect(calls).toHaveLength(0);
  });
});
