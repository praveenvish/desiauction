import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createWhatsAppReplier,
  inboundText,
  mayAdvance,
  normaliseWhatsAppNumber,
  parseWhatsAppCallback,
  verifyHandshake,
  verifyWhatsAppSignature,
  type DeliveryStatus,
} from "./whatsapp-webhook";

/**
 * The parts of the WhatsApp callback that decide things, without a server or
 * a database: whether Meta signed it, what it says, and which status may follow
 * which. The writes are proven against a real database in
 * whatsapp-webhook.regression.test.ts, and under the production roles in
 * posture/webhooks.posture.test.ts.
 */

const SECRET = "unit-app-secret-0123456789abcdef";
const sign = (body: string | Uint8Array, secret = SECRET): string =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("verifyWhatsAppSignature", () => {
  const body = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));

  it("accepts the body Meta signed", () => {
    expect(verifyWhatsAppSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("accepts an upper-case digest — hex is hex", () => {
    expect(
      verifyWhatsAppSignature(body, sign(body).toUpperCase().replace("SHA256", "sha256"), SECRET),
    ).toBe(true);
  });

  it("refuses a body altered after signing", () => {
    const tampered = Buffer.from(body.toString().replace("[]", "[{}]"));
    expect(verifyWhatsAppSignature(tampered, sign(body), SECRET)).toBe(false);
  });

  it("refuses a signature made with another secret", () => {
    expect(verifyWhatsAppSignature(body, sign(body, "someone-elses-app-secret"), SECRET)).toBe(
      false,
    );
  });

  it("refuses a missing header", () => {
    expect(verifyWhatsAppSignature(body, null, SECRET)).toBe(false);
  });

  it("refuses the SHA-1 header's prefix, and a bare digest", () => {
    const hex = sign(body).slice("sha256=".length);
    expect(verifyWhatsAppSignature(body, `sha1=${hex}`, SECRET)).toBe(false);
    expect(verifyWhatsAppSignature(body, hex, SECRET)).toBe(false);
  });

  it("refuses a digest of the wrong length without throwing", () => {
    expect(verifyWhatsAppSignature(body, "sha256=abcd", SECRET)).toBe(false);
    expect(verifyWhatsAppSignature(body, `${sign(body)}00`, SECRET)).toBe(false);
  });

  it("signs BYTES: a non-ASCII body verifies exactly as sent", () => {
    // Meta escapes non-ASCII, but the rule must not depend on it doing so.
    const hindi = Buffer.from('{"text":"रुको"}', "utf8");
    expect(verifyWhatsAppSignature(hindi, sign(hindi), SECRET)).toBe(true);
  });
});

describe("verifyHandshake", () => {
  const TOKEN = "unit-verify-token-0123456789";
  const params = (values: Record<string, string>): URLSearchParams => new URLSearchParams(values);

  it("echoes the challenge for a subscribe with our token", () => {
    expect(
      verifyHandshake(
        params({
          "hub.mode": "subscribe",
          "hub.verify_token": TOKEN,
          "hub.challenge": "1158201444",
        }),
        TOKEN,
      ),
    ).toBe("1158201444");
  });

  it("refuses the wrong token, a wrong mode, and a missing challenge", () => {
    expect(
      verifyHandshake(
        params({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "1" }),
        TOKEN,
      ),
    ).toBeNull();
    expect(
      verifyHandshake(
        params({ "hub.mode": "unsubscribe", "hub.verify_token": TOKEN, "hub.challenge": "1" }),
        TOKEN,
      ),
    ).toBeNull();
    expect(
      verifyHandshake(params({ "hub.mode": "subscribe", "hub.verify_token": TOKEN }), TOKEN),
    ).toBeNull();
  });
});

/** Meta's envelope, around whatever `value` a test needs. */
const envelope = (...values: Record<string, unknown>[]): unknown => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA_ID",
      changes: values.map((value) => ({ field: "messages", value })),
    },
  ],
});

describe("parseWhatsAppCallback", () => {
  it("reads statuses: id, status, Meta's timestamp, and only the code+title of an error", () => {
    const parsed = parseWhatsAppCallback(
      envelope({
        messaging_product: "whatsapp",
        statuses: [
          {
            id: "wamid.A",
            status: "delivered",
            timestamp: "1727000000",
            recipient_id: "919800000001",
          },
          {
            id: "wamid.B",
            status: "failed",
            timestamp: "1727000060",
            errors: [
              {
                code: 131026,
                title: "Message undeliverable",
                message: "Message undeliverable",
                error_data: { details: "recipient +919800000001 is not on WhatsApp" },
              },
            ],
          },
        ],
      }),
    );
    expect(parsed.messages).toEqual([]);
    expect(parsed.statuses).toEqual([
      { id: "wamid.A", status: "delivered", at: new Date(1727000000 * 1000), error: null },
      {
        id: "wamid.B",
        status: "failed",
        at: new Date(1727000060 * 1000),
        error: "131026 Message undeliverable",
      },
    ]);
    // The details quote the number; they must not survive parsing.
    expect(JSON.stringify(parsed)).not.toContain("919800000001");
  });

  it("reads text, quick-reply button and interactive replies as words", () => {
    const parsed = parseWhatsAppCallback(
      envelope({
        messages: [
          { id: "wamid.T", from: "919800000002", type: "text", text: { body: "STOP please" } },
          {
            id: "wamid.Q",
            from: "919800000002",
            type: "button",
            button: { text: "Stop updates", payload: "STOP" },
          },
          { id: "wamid.P", from: "919800000002", type: "button", button: { payload: "START" } },
          {
            id: "wamid.I",
            from: "919800000002",
            type: "interactive",
            interactive: { type: "button_reply", button_reply: { id: "start", title: "Start" } },
          },
          {
            id: "wamid.L",
            from: "919800000002",
            type: "interactive",
            interactive: { type: "list_reply", list_reply: { id: "stop" } },
          },
        ],
      }),
    );
    expect(parsed.messages.map((m) => [m.id, m.text])).toEqual([
      ["wamid.T", "STOP please"],
      ["wamid.Q", "Stop updates"],
      ["wamid.P", "START"],
      ["wamid.I", "Start"],
      ["wamid.L", "stop"],
    ]);
  });

  it("keeps a message with no words (media) so it is recorded, with empty text", () => {
    const parsed = parseWhatsAppCallback(
      envelope({
        messages: [{ id: "wamid.IMG", from: "919800000003", type: "image", image: { id: "m1" } }],
      }),
    );
    expect(parsed.messages).toEqual([{ id: "wamid.IMG", from: "919800000003", text: "" }]);
    expect(inboundText({ type: "reaction", reaction: { emoji: "👍" } })).toBe("");
  });

  it("reads every entry and every change, and skips fields that are not `messages`", () => {
    const parsed = parseWhatsAppCallback({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: { statuses: [{ id: "wamid.1", status: "sent", timestamp: "1" }] },
            },
            { field: "message_template_status_update", value: { event: "APPROVED" } },
          ],
        },
        {
          changes: [
            {
              field: "messages",
              value: { statuses: [{ id: "wamid.2", status: "read", timestamp: "2" }] },
            },
          ],
        },
      ],
    });
    expect(parsed.statuses.map((s) => s.id)).toEqual(["wamid.1", "wamid.2"]);
  });

  it("drops what it cannot read instead of throwing", () => {
    expect(parseWhatsAppCallback(null)).toEqual({ statuses: [], messages: [] });
    expect(parseWhatsAppCallback({ entry: "nope" })).toEqual({ statuses: [], messages: [] });
    const parsed = parseWhatsAppCallback(
      envelope({
        statuses: [
          { id: "wamid.X", status: "deleted", timestamp: "1" }, // not a status we know
          { status: "sent", timestamp: "1" }, // no id
          { id: "wamid.Y", status: "sent" }, // no timestamp
          "garbage",
        ],
        messages: [{ id: "wamid.Z", type: "text", text: { body: "STOP" } }], // no sender
      }),
    );
    expect(parsed).toEqual({ statuses: [], messages: [] });
  });
});

describe("normaliseWhatsAppNumber", () => {
  it("turns Meta's digits into the E.164 people.phone holds", () => {
    expect(normaliseWhatsAppNumber("919876543210")).toBe("+919876543210");
    expect(normaliseWhatsAppNumber("+919876543210")).toBe("+919876543210");
    expect(normaliseWhatsAppNumber("14155550123")).toBe("+14155550123");
  });

  it("refuses what is not a whole international number — no guessing +91", () => {
    expect(normaliseWhatsAppNumber("9876543")).toBeNull();
    expect(normaliseWhatsAppNumber("")).toBeNull();
    expect(normaliseWhatsAppNumber("0919876543210")).toBeNull();
    expect(normaliseWhatsAppNumber("91-98765-43210")).toBeNull();
    expect(normaliseWhatsAppNumber("1234567890123456")).toBeNull();
  });
});

describe("mayAdvance — status only moves forward", () => {
  const ALL: (DeliveryStatus | null)[] = [null, "sent", "delivered", "read", "failed"];
  const table = (next: DeliveryStatus): (DeliveryStatus | null)[] =>
    ALL.filter((current) => mayAdvance(current, next));

  it("sent → delivered → read, from any earlier point", () => {
    expect(table("sent")).toEqual([null]);
    expect(table("delivered")).toEqual([null, "sent"]);
    expect(table("read")).toEqual([null, "sent", "delivered"]);
  });

  it("failed only before a delivery, and nothing follows failed", () => {
    expect(table("failed")).toEqual([null, "sent"]);
    for (const next of ["sent", "delivered", "read", "failed"] as const) {
      expect(mayAdvance("failed", next), `failed → ${next}`).toBe(false);
    }
  });

  it("an out-of-order 'delivered' after 'read' is refused, not applied", () => {
    expect(mayAdvance("read", "delivered")).toBe(false);
    expect(mayAdvance("read", "sent")).toBe(false);
  });
});

describe("createWhatsAppReplier", () => {
  it("posts a free-form text to Meta's digits, never the +", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const replier = createWhatsAppReplier({
      phoneNumberId: "PNID",
      accessToken: "TOKEN",
      transport: (url, init) => {
        calls.push({ url, body: JSON.parse(init.body ?? "{}") });
        return Promise.resolve({ status: 200, body: '{"messages":[{"id":"wamid.R"}]}' });
      },
    });
    await expect(replier.reply("919800000004", "hello")).resolves.toBe(true);
    expect(calls[0]?.url).toBe("https://graph.facebook.com/v21.0/PNID/messages");
    expect(calls[0]?.body).toMatchObject({
      messaging_product: "whatsapp",
      to: "919800000004",
      type: "text",
      text: { body: "hello", preview_url: false },
    });
  });

  it("reports a refusal or a dead network as false, and never throws", async () => {
    const refused = createWhatsAppReplier({
      phoneNumberId: "P",
      accessToken: "T",
      transport: () => Promise.resolve({ status: 200, body: '{"error":{"code":131047}}' }),
    });
    await expect(refused.reply("919800000004", "x")).resolves.toBe(false);
    const dead = createWhatsAppReplier({
      phoneNumberId: "P",
      accessToken: "T",
      transport: () => Promise.reject(new Error("ECONNRESET")),
    });
    await expect(dead.reply("919800000004", "x")).resolves.toBe(false);
  });
});
