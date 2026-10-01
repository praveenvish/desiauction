import { createHmac } from "node:crypto";

import { parseEmailCallback } from "@desiauction/messaging/email-adapter";
import { describe, expect, it, vi } from "vitest";

import {
  handleZeptomailWebhook,
  parseProducerSignature,
  verifyZeptomailSignature,
  zeptomailEventActions,
  zeptomailKeyMatches,
  ZEPTOMAIL_SIGNATURE_MAX_AGE_MS,
  type ZeptomailWebhookDeps,
} from "./zeptomail-webhook";

const KEY = "zm-webhook-auth-key-0123456789";
const NOW = Date.UTC(2026, 9, 1, 6, 0, 0);

/** Two recipients, as in Zoho's preview — only one of them is the event's. */
const TO = [
  { email_address: { address: "bouncerecipient@zylker.com", name: "BounceRecipient" } },
  { email_address: { address: "testrecipient@zylker.com", name: "TestRecipient" } },
];

/**
 * The payloads Zoho's "Add webhook" preview shows (2026-10-01), trimmed to the
 * fields that decide anything — `event_name` a list, the address the event is
 * about in `event_data[].details[]`.
 */
function hardBounce(clientReference?: string) {
  return JSON.stringify({
    event_name: ["hardbounce"],
    event_message: [
      {
        email_info: {
          ...(clientReference === undefined ? {} : { client_reference: clientReference }),
          email_reference: "2518b.566de397c0d9ee76.m1.907867@zylker.com",
          to: TO,
          object: "email",
        },
        event_data: [
          {
            details: [
              {
                reason: "relaying-issues",
                bounced_recipient: "bouncerecipient@zylker.com",
                diagnostic_message: "bad-mailbox",
              },
            ],
            object: "hardbounce",
          },
        ],
      },
    ],
    webhook_request_id: "2518b.566de397c0d9ee76.w1.907b4d",
  });
}

function complaint() {
  return JSON.stringify({
    event_name: ["fbl_compliant"],
    event_message: [
      {
        email_info: { email_reference: "2518b.m1.88e222@zylker.com", to: TO, object: "email" },
        event_data: [
          {
            details: [
              {
                fblFrom: "mail.zylker.com",
                returnPath: "bouncerecipient@zylker.com",
                from: "webhooktest@zylker.com",
                to: "testrecipient@zylker.com",
              },
            ],
            object: "fbl_compliant",
          },
        ],
      },
    ],
  });
}

function softBounce() {
  return JSON.stringify({
    event_name: ["softbounce"],
    event_message: [
      {
        email_info: { email_reference: "r", to: TO },
        event_data: [{ details: [{ bounced_recipient: "x@zylker.com" }], object: "softbounce" }],
      },
    ],
  });
}

const sign = (data: string, key = KEY) =>
  createHmac("sha256", key).update(data, "utf8").digest("base64");

/** The help pages' signed form: a form-encoded body, the MAC over its value. */
function signedForm(json: string, at = NOW, key = KEY) {
  return {
    body: `event=${encodeURIComponent(json)}`,
    header: `ts=${String(at)};s=${encodeURIComponent(sign(json, key))};s-algorithm=HmacSHA256`,
  };
}

function deps() {
  const suppress = vi.fn(() => Promise.resolve("suppressed"));
  const report = vi.fn(() => Promise.resolve({ ok: true }));
  const wired: ZeptomailWebhookDeps = {
    key: KEY,
    now: () => NOW,
    suppress,
    report,
    log: vi.fn(),
  };
  return { ...wired, suppress, report };
}

const keyed = { key: KEY, signature: null };

describe("zeptomailKeyMatches — the X-Webhook-Key header", () => {
  it("accepts exactly the key, ignoring surrounding whitespace", () => {
    expect(zeptomailKeyMatches(KEY, KEY)).toBe(true);
    expect(zeptomailKeyMatches(` ${KEY} `, KEY)).toBe(true);
  });

  it("refuses another value, a prefix, no header, and an empty configured key", () => {
    expect(zeptomailKeyMatches("wrong-key-0123456789abcdefgh", KEY)).toBe(false);
    expect(zeptomailKeyMatches(KEY.slice(0, -1), KEY)).toBe(false);
    expect(zeptomailKeyMatches(null, KEY)).toBe(false);
    expect(zeptomailKeyMatches("", "")).toBe(false);
  });
});

describe("verifyZeptomailSignature — the producer-signature HMAC, still accepted", () => {
  const json = hardBounce();

  it("accepts the documented form body and a raw JSON body", () => {
    const form = signedForm(json);
    expect(verifyZeptomailSignature(form.body, form.header, KEY, NOW)).toBe(json);
    const header = `ts=${String(NOW)};s=${encodeURIComponent(sign(json))};s-algorithm=HmacSHA256`;
    expect(verifyZeptomailSignature(json, header, KEY, NOW)).toBe(json);
  });

  it("refuses another key, a tampered body, a stale timestamp and another algorithm", () => {
    const forged = signedForm(json, NOW, "someone-elses-key-0123456789");
    expect(verifyZeptomailSignature(forged.body, forged.header, KEY, NOW)).toBeNull();
    const { body, header } = signedForm(json);
    expect(verifyZeptomailSignature(body.replace("relaying", "x"), header, KEY, NOW)).toBeNull();
    const stale = signedForm(json, NOW - ZEPTOMAIL_SIGNATURE_MAX_AGE_MS - 1);
    expect(verifyZeptomailSignature(stale.body, stale.header, KEY, NOW)).toBeNull();
    expect(
      verifyZeptomailSignature(body, header.replace("HmacSHA256", "HmacSHA1"), KEY, NOW),
    ).toBeNull();
  });

  it("parses the header, URL-decoding the signature", () => {
    expect(parseProducerSignature("ts=1596109465823;s=ZG9n%3D;s-algorithm=HmacSHA256")).toEqual({
      ts: 1596109465823,
      signature: Buffer.from("ZG9n=", "base64"),
      algorithm: "HmacSHA256",
    });
    expect(parseProducerSignature("s=abc")).toBeNull();
  });
});

describe("zeptomailEventActions — Zoho's real payloads", () => {
  it("suppresses ONLY the bounced recipient, not every address on the message", () => {
    const { type, actions } = zeptomailEventActions(hardBounce("01J9XYZ"));
    expect(type).toBe("hardbounce");
    expect(actions).toEqual([
      {
        kind: "suppress",
        recipient: "bouncerecipient@zylker.com",
        reason: "bounce",
        note: "zeptomail hard bounce: relaying-issues",
      },
      {
        kind: "report",
        raw: JSON.stringify({
          event: "bounced",
          providerRef: "email:01J9XYZ",
          eventId:
            "zeptomail:2518b.566de397c0d9ee76.m1.907867@zylker.com:bounced:bouncerecipient@zylker.com",
          recipient: "bouncerecipient@zylker.com",
        }),
      },
    ]);
    const report = actions[1];
    expect(report?.kind === "report" ? parseEmailCallback(report.raw)?.dispatchId : null).toBe(
      "01J9XYZ",
    );
  });

  it("suppresses the person who complained — `fbl_compliant`, as Zoho spells it", () => {
    const { type, actions } = zeptomailEventActions(complaint());
    expect(type).toBe("fblcompliant");
    expect(actions).toEqual([
      {
        kind: "suppress",
        recipient: "testrecipient@zylker.com",
        reason: "complaint",
        note: "zeptomail complaint: feedback loop",
      },
    ]);
  });

  it("still reads the help pages' spellings", () => {
    const named = (name: string) =>
      zeptomailEventActions(
        JSON.stringify({
          event_name: name,
          event_message: [{ email_info: { to: [{ email_address: { address: "a@x.in" } }] } }],
        }),
      ).actions.map((a) => (a.kind === "suppress" ? `${a.reason}:${a.recipient}` : null));
    expect(named("hard bounce")).toEqual(["bounce:a@x.in"]);
    expect(named("feedback loop")).toEqual(["complaint:a@x.in"]);
  });

  it("leaves soft bounces, opens and clicks alone", () => {
    expect(zeptomailEventActions(softBounce()).actions).toEqual([]);
    expect(zeptomailEventActions(JSON.stringify({ event_name: ["email opens"] })).actions).toEqual(
      [],
    );
  });

  it("names an unreadable body as such", () => {
    expect(zeptomailEventActions("not json").type).toBe("unparseable");
  });
});

describe("handleZeptomailWebhook — one POST, start to finish", () => {
  it("with the key header: suppresses, then reports, then answers 200", async () => {
    const d = deps();
    const result = await handleZeptomailWebhook(hardBounce("01J9XYZ"), keyed, d);
    expect(result).toEqual({ status: 200, body: { status: "suppressed" } });
    expect(d.suppress).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: "bouncerecipient@zylker.com", reason: "bounce" }),
    );
    expect(d.report).toHaveBeenCalledTimes(1);
    expect(d.suppress.mock.invocationCallOrder[0]).toBeLessThan(
      d.report.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("with a valid producer-signature instead: acted on just the same", async () => {
    const d = deps();
    const { body, header } = signedForm(complaint());
    const result = await handleZeptomailWebhook(body, { key: null, signature: header }, d);
    expect(result).toEqual({ status: 200, body: { status: "suppressed" } });
  });

  it("answers 403 to a wrong key, or no proof at all, without touching anything", async () => {
    for (const headers of [
      { key: "wrong-key-0123456789abcdefgh", signature: null },
      { key: null, signature: null },
    ]) {
      const d = deps();
      expect(await handleZeptomailWebhook(hardBounce(), headers, d)).toEqual({
        status: 403,
        body: null,
      });
      expect(d.suppress).not.toHaveBeenCalled();
    }
  });

  it("answers 200 to Verify's empty post and to a soft bounce — Zoho requires 200", async () => {
    for (const raw of ["", "{}", "not json", softBounce()]) {
      expect(await handleZeptomailWebhook(raw, keyed, deps())).toEqual({
        status: 200,
        body: { status: "ignored" },
      });
    }
  });

  it("lets a database failure escape, for the route to answer 503", async () => {
    const d: ZeptomailWebhookDeps = {
      ...deps(),
      suppress: vi.fn(() => Promise.reject(new Error("db down"))),
    };
    await expect(handleZeptomailWebhook(hardBounce(), keyed, d)).rejects.toThrow("db down");
  });
});
