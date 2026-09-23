import { createHmac } from "node:crypto";

import {
  consentRecords,
  createDb,
  messageOutbox,
  newId,
  people,
  whatsappInbound,
  type DbHandle,
} from "@desiauction/db";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { env } from "../../env";
import { purgeWhatsAppInbound, WHATSAPP_INBOUND_RETENTION_MS } from "../support/report-retention";
import { WHATSAPP_CONSENT_PURPOSE, whatsappOptedIn } from "./whatsapp";
import {
  START_REPLY,
  STOP_REPLY,
  handleWhatsAppCallback,
  parseWhatsAppCallback,
  type WhatsAppReplier,
} from "./whatsapp-webhook";

/**
 * The WhatsApp callback against a real database.
 *
 * Two promises are load-bearing and neither can be read off the code: a
 * delivery status never moves BACKWARD however Meta orders its callbacks, and
 * a STOP is acted on exactly once however many times Meta delivers it. Both
 * are asserted on the rows, not on return values.
 *
 * Runs as the database owner, like every regression suite; the same writes
 * under `desiauction_app` are in posture/webhooks.posture.test.ts.
 */

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;

const RUN = String(Date.now()).slice(-7);
/** Meta's form (digits, no +) and ours (E.164) of the same numbers. */
const KNOWN_DIGITS = `9196${RUN}01`;
const KNOWN_PHONE = `+${KNOWN_DIGITS}`;
const STRANGER_DIGITS = `9196${RUN}02`;
const WAMID = (label: string): string => `wamid.test-${RUN}-${label}`;

let personId = "";
let outboxId = "";

/** A replier that records instead of calling Meta. */
function recordingReplier(): WhatsAppReplier & { sent: { to: string; text: string }[] } {
  const sent: { to: string; text: string }[] = [];
  return {
    sent,
    reply(to, text) {
      sent.push({ to, text });
      return Promise.resolve(true);
    },
  };
}

const envelope = (value: Record<string, unknown>): unknown => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value }] }],
});
const statusCallback = (status: string, at: number, extra: Record<string, unknown> = {}) =>
  parseWhatsAppCallback(
    envelope({
      statuses: [{ id: WAMID("out"), status, timestamp: String(at), ...extra }],
    }),
  );
const textCallback = (id: string, from: string, body: string) =>
  parseWhatsAppCallback(
    envelope({ messages: [{ id, from, type: "text", text: { body }, timestamp: "1" }] }),
  );

async function outboxRow() {
  const [row] = await db.select().from(messageOutbox).where(eq(messageOutbox.id, outboxId));
  return row;
}

async function whatsappConsents() {
  return db
    .select({
      granted: consentRecords.granted,
      source: consentRecords.source,
      evidence: consentRecords.evidence,
    })
    .from(consentRecords)
    .where(
      and(
        eq(consentRecords.personId, personId),
        eq(consentRecords.purpose, WHATSAPP_CONSENT_PURPOSE),
      ),
    )
    .orderBy(consentRecords.createdAt);
}

beforeAll(async () => {
  personId = newId();
  outboxId = newId();
  await db.insert(people).values({ id: personId, phone: KNOWN_PHONE, name: "WhatsApp Synthetic" });
  // What the sender leaves behind on a successful WhatsApp send: the wamid,
  // and `sent` as Meta's first word on it.
  await db.insert(messageOutbox).values({
    id: outboxId,
    personId,
    kind: "auction.sold",
    channel: "whatsapp",
    dedupeKey: `wa-webhook-test:${RUN}`,
    subject: "",
    bodyText: "synthetic",
    bodyHtml: "",
    templateKey: "auction.sold",
    slots: {},
    status: "sent",
    providerMessageId: WAMID("out"),
    deliveryStatus: "sent",
  });
});

afterAll(async () => {
  await db
    .delete(whatsappInbound)
    .where(like(whatsappInbound.providerMessageId, `wamid.test-${RUN}-%`));
  await db.delete(consentRecords).where(eq(consentRecords.personId, personId));
  await db.delete(messageOutbox).where(eq(messageOutbox.id, outboxId));
  await db.delete(people).where(eq(people.id, personId));
  await handle.sql.end();
});

describe("delivery statuses only move forward", () => {
  it("records delivered, then read, with Meta's own timestamps", async () => {
    const delivered = await handleWhatsAppCallback(
      db,
      statusCallback("delivered", 1_727_000_100),
      null,
    );
    expect(delivered.statusesApplied).toBe(1);
    let row = await outboxRow();
    expect(row?.deliveryStatus).toBe("delivered");
    expect(row?.deliveredAt?.getTime()).toBe(1_727_000_100_000);

    await handleWhatsAppCallback(db, statusCallback("read", 1_727_000_200), null);
    row = await outboxRow();
    expect(row?.deliveryStatus).toBe("read");
    expect(row?.readAt?.getTime()).toBe(1_727_000_200_000);
    // The delivery time is not overwritten by the read.
    expect(row?.deliveredAt?.getTime()).toBe(1_727_000_100_000);
    // The outbox's own status is the provider's acceptance, and stays so.
    expect(row?.status).toBe("sent");
  });

  it("refuses a late 'delivered', a replayed 'sent' and a contradictory 'failed' after 'read'", async () => {
    const late = await handleWhatsAppCallback(db, statusCallback("delivered", 1_727_000_050), null);
    const replay = await handleWhatsAppCallback(db, statusCallback("sent", 1_727_000_000), null);
    const failed = await handleWhatsAppCallback(
      db,
      statusCallback("failed", 1_727_000_300, {
        errors: [{ code: 131026, title: "Message undeliverable" }],
      }),
      null,
    );
    expect([late.statusesStale, replay.statusesStale, failed.statusesStale]).toEqual([1, 1, 1]);
    const row = await outboxRow();
    expect(row?.deliveryStatus).toBe("read");
    expect(row?.deliveredAt?.getTime()).toBe(1_727_000_100_000);
    expect(row?.deliveryError).toBeNull();
  });

  it("fills the delivery time from 'read' when 'delivered' never came first", async () => {
    await db
      .update(messageOutbox)
      .set({ deliveryStatus: "sent", deliveredAt: null, readAt: null })
      .where(eq(messageOutbox.id, outboxId));
    await handleWhatsAppCallback(db, statusCallback("read", 1_727_000_400), null);
    // …and the 'delivered' that arrives afterwards is stale.
    await handleWhatsAppCallback(db, statusCallback("delivered", 1_727_000_390), null);
    const row = await outboxRow();
    expect(row?.deliveryStatus).toBe("read");
    expect(row?.deliveredAt?.getTime()).toBe(1_727_000_400_000);
  });

  it("records a failure's code and title, and nothing moves it afterwards", async () => {
    await db
      .update(messageOutbox)
      .set({ deliveryStatus: "sent", deliveredAt: null, readAt: null })
      .where(eq(messageOutbox.id, outboxId));
    await handleWhatsAppCallback(
      db,
      statusCallback("failed", 1_727_000_500, {
        errors: [
          { code: 131026, title: "Message undeliverable", error_data: { details: KNOWN_PHONE } },
        ],
      }),
      null,
    );
    await handleWhatsAppCallback(db, statusCallback("delivered", 1_727_000_510), null);
    const row = await outboxRow();
    expect(row?.deliveryStatus).toBe("failed");
    expect(row?.deliveryError).toBe("131026 Message undeliverable");
    expect(row?.deliveredAt).toBeNull();
  });

  it("ignores a wamid that is not in the outbox (a sign-in code, say)", async () => {
    const summary = await handleWhatsAppCallback(
      db,
      parseWhatsAppCallback(
        envelope({
          statuses: [{ id: WAMID("otp-not-ours"), status: "delivered", timestamp: "1" }],
        }),
      ),
      null,
    );
    expect(summary).toMatchObject({ statusesApplied: 0, statusesUnknown: 1 });
  });
});

describe("inbound: STOP and START, each acted on once", () => {
  it("a STOP from a known number withdraws WhatsApp consent and is confirmed", async () => {
    const replier = recordingReplier();
    const summary = await handleWhatsAppCallback(
      db,
      textCallback(WAMID("stop-1"), KNOWN_DIGITS, "STOP"),
      replier,
    );
    expect(summary).toMatchObject({ inboundNew: 1, consentsRecorded: 1, repliesSent: 1 });
    expect(replier.sent).toEqual([{ to: KNOWN_DIGITS, text: STOP_REPLY }]);
    const consents = await whatsappConsents();
    expect(consents).toHaveLength(1);
    expect(consents[0]?.granted).toBe(false);
    expect(consents[0]?.evidence).toMatchObject({ channel: "whatsapp", keyword: "STOP" });
    expect(await whatsappOptedIn(db, personId)).toBe(false);

    const [inbound] = await db
      .select()
      .from(whatsappInbound)
      .where(eq(whatsappInbound.providerMessageId, WAMID("stop-1")));
    expect(inbound).toMatchObject({ phone: KNOWN_PHONE, intent: "stop", personId });
  });

  it("the SAME message delivered again writes nothing and sends nothing", async () => {
    const replier = recordingReplier();
    const summary = await handleWhatsAppCallback(
      db,
      textCallback(WAMID("stop-1"), KNOWN_DIGITS, "STOP"),
      replier,
    );
    expect(summary).toMatchObject({ inboundNew: 0, inboundRepeat: 1, consentsRecorded: 0 });
    expect(replier.sent).toEqual([]);
    expect(await whatsappConsents()).toHaveLength(1);
  });

  it("START afterwards turns WhatsApp back on — the latest row wins", async () => {
    const replier = recordingReplier();
    await handleWhatsAppCallback(
      db,
      textCallback(WAMID("start-1"), KNOWN_DIGITS, "start"),
      replier,
    );
    expect(replier.sent).toEqual([{ to: KNOWN_DIGITS, text: START_REPLY }]);
    const consents = await whatsappConsents();
    expect(consents.map((row) => row.granted)).toEqual([false, true]);
    expect(await whatsappOptedIn(db, personId)).toBe(true);
  });

  it("anything else is recorded and not answered — this is not a chatbot", async () => {
    const replier = recordingReplier();
    const summary = await handleWhatsAppCallback(
      db,
      textCallback(WAMID("chat-1"), KNOWN_DIGITS, "thanks, see you at the auction"),
      replier,
    );
    expect(summary).toMatchObject({ inboundNew: 1, consentsRecorded: 0, repliesSent: 0 });
    expect(replier.sent).toEqual([]);
    expect(await whatsappConsents()).toHaveLength(2);
    const [inbound] = await db
      .select({ intent: whatsappInbound.intent })
      .from(whatsappInbound)
      .where(eq(whatsappInbound.providerMessageId, WAMID("chat-1")));
    expect(inbound?.intent).toBe("unknown");
  });

  it("a STOP from a number nobody holds is recorded and confirmed; a START is not", async () => {
    const replier = recordingReplier();
    await handleWhatsAppCallback(
      db,
      textCallback(WAMID("stranger-stop"), STRANGER_DIGITS, "STOP"),
      replier,
    );
    await handleWhatsAppCallback(
      db,
      textCallback(WAMID("stranger-start"), STRANGER_DIGITS, "START"),
      replier,
    );
    expect(replier.sent).toEqual([{ to: STRANGER_DIGITS, text: STOP_REPLY }]);
    const rows = await db
      .select({ personId: whatsappInbound.personId })
      .from(whatsappInbound)
      .where(like(whatsappInbound.providerMessageId, `${WAMID("stranger")}%`));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.personId === null)).toBe(true);
  });
});

describe("the route, end to end, with a signed request", () => {
  const SECRET = "regression-whatsapp-app-secret-0123456789";

  it("verifies Meta's signature, applies the STOP, and answers 200", async () => {
    vi.resetModules();
    vi.stubEnv("WHATSAPP_APP_SECRET", SECRET);
    vi.stubEnv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "regression-verify-token-0123456789");
    // No sender credentials: the route records, and has nobody to reply with.
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", undefined);
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", undefined);
    try {
      const { POST } = await import("../../app/api/webhooks/whatsapp/route");
      const body = JSON.stringify(
        envelope({
          messages: [
            { id: WAMID("route-stop"), from: KNOWN_DIGITS, type: "text", text: { body: "Stop" } },
          ],
        }),
      );
      const signature = `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
      const send = () =>
        POST(
          new Request("https://example.test/api/webhooks/whatsapp", {
            method: "POST",
            headers: { "content-type": "application/json", "x-hub-signature-256": signature },
            body,
          }),
        );
      expect((await send()).status).toBe(200);
      // Meta retrying the same callback changes nothing.
      expect((await send()).status).toBe(200);

      const consents = await whatsappConsents();
      expect(consents.map((row) => row.granted)).toEqual([false, true, false]);
      expect(await whatsappOptedIn(db, personId)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("retention — inbound rows go after ninety days", () => {
  it("deletes an expired row and keeps a recent one", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - WHATSAPP_INBOUND_RETENTION_MS - 60_000);
    await db.insert(whatsappInbound).values([
      { providerMessageId: WAMID("aged"), phone: KNOWN_PHONE, intent: "unknown", receivedAt: old },
      { providerMessageId: WAMID("fresh"), phone: KNOWN_PHONE, intent: "unknown", receivedAt: now },
    ]);
    expect(await purgeWhatsAppInbound(now)).toBeGreaterThanOrEqual(1);
    const left = await db
      .select({ id: whatsappInbound.providerMessageId })
      .from(whatsappInbound)
      .where(like(whatsappInbound.providerMessageId, `${WAMID("")}%`));
    const ids = left.map((row) => row.id);
    expect(ids).not.toContain(WAMID("aged"));
    expect(ids).toContain(WAMID("fresh"));
  });
});
