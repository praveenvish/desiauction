import { createHmac } from "node:crypto";

import { parseEmailCallback } from "@desiauction/messaging/email-adapter";
import { describe, expect, it, vi } from "vitest";

import {
  handleZeptomailWebhook,
  parseProducerSignature,
  verifyZeptomailSignature,
  zeptomailEventActions,
  ZEPTOMAIL_SIGNATURE_MAX_AGE_MS,
  type ZeptomailWebhookDeps,
} from "./zeptomail-webhook";

const KEY = "zm-webhook-auth-key-0123456789";
const NOW = Date.UTC(2026, 9, 1, 6, 0, 0);

/** A Zoho CPaaS event notification, trimmed to the fields that decide anything. */
function event(
  name: string,
  opts: { object?: string; reason?: string; clientReference?: string; to?: unknown } = {},
) {
  return JSON.stringify({
    event_name: name,
    event_message: [
      {
        email_info: {
          email_reference: "2d6f.123.abc",
          ...(opts.clientReference === undefined ? {} : { client_reference: opts.clientReference }),
          subject: "Your DesiAuction sign-in code",
          from: { address: "no-reply@mail.desiauction.in", name: "DesiAuction" },
          to: opts.to ?? [{ email_address: { address: "Gone@Example.com", name: "" } }],
          object: "email",
        },
        event_data: [
          {
            object: opts.object ?? "bounce",
            details: [
              {
                reason: opts.reason ?? "Mailbox does not exist",
                diagnostic_message: "550 5.1.1 user unknown",
              },
            ],
          },
        ],
      },
    ],
    mailagent_key: "agent-1",
    webhook_request_id: "wh-1",
  });
}

const sign = (data: string, key = KEY) =>
  createHmac("sha256", key).update(data, "utf8").digest("base64");

/** The documented wire form: a form-encoded body, the MAC over its value. */
function formPost(json: string, at = NOW, key = KEY) {
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

describe("verifyZeptomailSignature — the producer-signature HMAC", () => {
  const json = event("hard bounce");

  it("accepts the documented form body and hands back the signed JSON", () => {
    const { body, header } = formPost(json);
    expect(verifyZeptomailSignature(body, header, KEY, NOW)).toBe(json);
  });

  it("accepts a raw JSON body signed as it arrived", () => {
    const header = `ts=${String(NOW)};s=${encodeURIComponent(sign(json))};s-algorithm=HmacSHA256`;
    expect(verifyZeptomailSignature(json, header, KEY, NOW)).toBe(json);
  });

  it("refuses another key, a tampered body, and no header at all", () => {
    const forged = formPost(json, NOW, "someone-elses-key-0123456789");
    expect(verifyZeptomailSignature(forged.body, forged.header, KEY, NOW)).toBeNull();
    const { body, header } = formPost(json);
    expect(verifyZeptomailSignature(body.replace("Gone", "Kept"), header, KEY, NOW)).toBeNull();
    expect(verifyZeptomailSignature(body, null, KEY, NOW)).toBeNull();
  });

  it("refuses a stale or far-future timestamp, and another algorithm", () => {
    const stale = formPost(json, NOW - ZEPTOMAIL_SIGNATURE_MAX_AGE_MS - 1);
    expect(verifyZeptomailSignature(stale.body, stale.header, KEY, NOW)).toBeNull();
    const future = formPost(json, NOW + 10 * 60 * 1000);
    expect(verifyZeptomailSignature(future.body, future.header, KEY, NOW)).toBeNull();
    const { body, header } = formPost(json);
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
    expect(parseProducerSignature("ts=1;s=")).toBeNull();
  });
});

describe("zeptomailEventActions — what one event asks of us", () => {
  it("suppresses a hard-bounced address and reports it against its dispatch", () => {
    const { type, actions } = zeptomailEventActions(
      event("hard bounce", { clientReference: "01J9XYZ" }),
    );
    expect(type).toBe("hardbounce");
    expect(actions).toEqual([
      {
        kind: "suppress",
        recipient: "Gone@Example.com",
        reason: "bounce",
        note: "zeptomail hard bounce: Mailbox does not exist",
      },
      {
        kind: "report",
        raw: JSON.stringify({
          event: "bounced",
          providerRef: "email:01J9XYZ",
          eventId: "zeptomail:2d6f.123.abc:bounced:Gone@Example.com",
          recipient: "Gone@Example.com",
        }),
      },
    ]);
    // The report is the callback the certified ingest already understands.
    const report = actions[1];
    expect(report?.kind === "report" ? parseEmailCallback(report.raw)?.dispatchId : null).toBe(
      "01J9XYZ",
    );
  });

  it("suppresses a spam complaint, by name or by its fbl object", () => {
    for (const payload of [event("feedback loop"), event("x", { object: "fbl_complaint" })]) {
      const { actions } = zeptomailEventActions(payload);
      expect(actions).toEqual([
        {
          kind: "suppress",
          recipient: "Gone@Example.com",
          reason: "complaint",
          note: "zeptomail complaint: feedback loop",
        },
      ]);
    }
  });

  it("leaves soft bounces, opens and clicks alone", () => {
    for (const name of ["soft bounce", "email opens", "email clicks"]) {
      expect(zeptomailEventActions(event(name, { clientReference: "01J9" })).actions).toEqual([]);
    }
  });

  it("reads every nesting of `to` Zoho uses", () => {
    const nestings: unknown[] = [
      [{ email_address: { address: "a@x.in" } }],
      { email_address: [{ address: "a@x.in" }] },
      { email_address: { address: "a@x.in" } },
    ];
    for (const to of nestings) {
      const { actions } = zeptomailEventActions(event("hardbounce", { to }));
      expect(actions.map((a) => (a.kind === "suppress" ? a.recipient : null))).toEqual(["a@x.in"]);
    }
  });

  it("names an unreadable body as such", () => {
    expect(zeptomailEventActions("not json").type).toBe("unparseable");
  });
});

describe("handleZeptomailWebhook — one POST, start to finish", () => {
  it("suppresses, then reports, then answers 200", async () => {
    const d = deps();
    const { body, header } = formPost(event("hard bounce", { clientReference: "01J9XYZ" }));
    const result = await handleZeptomailWebhook(body, header, d);
    expect(result).toEqual({ status: 200, body: { status: "suppressed" } });
    expect(d.suppress).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: "Gone@Example.com", reason: "bounce" }),
    );
    expect(d.report).toHaveBeenCalledTimes(1);
    expect(d.suppress.mock.invocationCallOrder[0]).toBeLessThan(
      d.report.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("answers 403 to a forgery without touching anything", async () => {
    const d = deps();
    const forged = formPost(event("hard bounce"), NOW, "someone-elses-key-0123456789");
    expect(await handleZeptomailWebhook(forged.body, forged.header, d)).toEqual({
      status: 403,
      body: null,
    });
    expect(d.suppress).not.toHaveBeenCalled();
    expect(d.report).not.toHaveBeenCalled();
  });

  it("answers 200 'ignored' to a soft bounce, and 400 to a signed but unreadable body", async () => {
    const soft = formPost(event("soft bounce"));
    expect(await handleZeptomailWebhook(soft.body, soft.header, deps())).toEqual({
      status: 200,
      body: { status: "ignored" },
    });
    const junk = formPost("not json");
    expect((await handleZeptomailWebhook(junk.body, junk.header, deps())).status).toBe(400);
  });

  it("lets a database failure escape, for the route to answer 503", async () => {
    const d: ZeptomailWebhookDeps = {
      ...deps(),
      suppress: vi.fn(() => Promise.reject(new Error("db down"))),
    };
    const { body, header } = formPost(event("hard bounce"));
    await expect(handleZeptomailWebhook(body, header, d)).rejects.toThrow("db down");
  });
});
