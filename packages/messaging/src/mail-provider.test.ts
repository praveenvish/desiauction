import { describe, expect, it } from "vitest";

import {
  createResendProvider,
  createSesProvider,
  mailProviderFromEnv,
  selectedProvider,
  type MailEnv,
  type MailTransport,
} from "./mail-provider";
import type { ProviderResponse } from "./provider-fetch";

function recording(answer: ProviderResponse = { status: 200, body: '{"MessageId":"m-1"}' }) {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const transport: MailTransport = (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as unknown });
    return Promise.resolve(answer);
  };
  return { transport, calls };
}

const SES = {
  region: "ap-south-1",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  from: "DesiAuction <no-reply@mail.desiauction.in>",
};
const AT = Date.UTC(2026, 8, 28, 10, 0, 0);

describe("createSesProvider — the SES v2 SendEmail call", () => {
  it("posts a signed Simple message to the region's endpoint", async () => {
    const { transport, calls } = recording();
    const result = await createSesProvider({ ...SES, transport, now: () => AT }).send({
      to: "player@example.com",
      subject: "आपका कोड",
      text: "code 123456",
      html: "<p>code 123456</p>",
      replyTo: "support@desiauction.in",
    });
    expect(result).toEqual({ ok: true, messageId: "m-1" });
    const [call] = calls;
    expect(call?.url).toBe("https://email.ap-south-1.amazonaws.com/v2/email/outbound-emails");
    expect(call?.headers["authorization"]).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20260928\/ap-south-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(call?.headers["x-amz-date"]).toBe("20260928T100000Z");
    // fetch sets Host from the URL; sending it too is redundant at best.
    expect(call?.headers["host"]).toBeUndefined();
    expect(call?.body).toEqual({
      FromEmailAddress: SES.from,
      Destination: { ToAddresses: ["player@example.com"] },
      ReplyToAddresses: ["support@desiauction.in"],
      Content: {
        Simple: {
          Subject: { Data: "आपका कोड", Charset: "UTF-8" },
          Body: {
            Text: { Data: "code 123456", Charset: "UTF-8" },
            Html: { Data: "<p>code 123456</p>", Charset: "UTF-8" },
          },
        },
      },
    });
  });

  it("carries the attachment, tags, configuration set and feedback address", async () => {
    const { transport, calls } = recording();
    await createSesProvider({
      ...SES,
      configurationSet: "desiauction-transactional",
      feedbackAddress: "bounces@desiauction.in",
      transport,
    }).send({
      to: "a@example.com",
      subject: "s",
      text: "t",
      attachment: { filename: "demo.ics", contentType: "text/calendar", contentBase64: "QkVH" },
      tags: { dispatch: "01J9/X Y", kind: "" },
      idempotencyKey: "never-sent-to-ses",
    });
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body["ConfigurationSetName"]).toBe("desiauction-transactional");
    expect(body["FeedbackForwardingEmailAddress"]).toBe("bounces@desiauction.in");
    // SES accepts [A-Za-z0-9_-] only; empty values are dropped, not sent.
    expect(body["EmailTags"]).toEqual([{ Name: "dispatch", Value: "01J9_X_Y" }]);
    expect(body).toMatchObject({
      Content: {
        Simple: {
          Attachments: [
            {
              FileName: "demo.ics",
              ContentType: "text/calendar",
              ContentDisposition: "ATTACHMENT",
              RawContent: "QkVH",
            },
          ],
        },
      },
    });
    expect(JSON.stringify(calls[0]?.headers)).not.toContain("never-sent-to-ses");
  });

  it.each([
    ["TooManyRequestsException", 429, true],
    ["SendingPausedException", 400, true],
    ["LimitExceededException", 400, true],
    ["InternalFailure", 500, true],
    ["MessageRejected", 400, false],
    ["MailFromDomainNotVerifiedException", 400, false],
    ["AccountSuspendedException", 400, false],
    ["BadRequestException", 400, false],
  ])("%s → retryable %s", async (name, status, retryable) => {
    const { transport } = recording({
      status,
      body: JSON.stringify({ message: "Email address is not verified." }),
      headers: { "x-amzn-errortype": `${name}:http://internal.amazon.com/coral/` },
    });
    const result = await createSesProvider({ ...SES, transport }).send({
      to: "a@example.com",
      subject: "s",
      text: "t",
    });
    expect(result).toEqual({
      ok: false,
      status,
      retryable,
      detail: `${name}: Email address is not verified.`,
    });
  });

  it("reads the error name from the body when the header is absent", async () => {
    const { transport } = recording({
      status: 400,
      body: JSON.stringify({ __type: "com.amazonaws#SendingPausedException", message: "paused" }),
    });
    const result = await createSesProvider({ ...SES, transport }).send({
      to: "a@example.com",
      subject: "s",
      text: "t",
    });
    expect(result).toMatchObject({
      ok: false,
      retryable: true,
      detail: "SendingPausedException: paused",
    });
  });

  it("carries List-Unsubscribe as SES's name/value headers, beside the html part", async () => {
    const { transport, calls } = recording();
    await createSesProvider({ ...SES, transport, now: () => AT }).send({
      to: "a@example.com",
      subject: "s",
      text: "t",
      html: "<p>t</p>",
      headers: {
        "List-Unsubscribe": "<https://desiauction.in/api/email/unsubscribe?t=x>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    expect(calls[0]?.body).toMatchObject({
      Content: {
        Simple: {
          Body: { Html: { Data: "<p>t</p>", Charset: "UTF-8" } },
          Headers: [
            {
              Name: "List-Unsubscribe",
              Value: "<https://desiauction.in/api/email/unsubscribe?t=x>",
            },
            { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
          ],
        },
      },
    });
  });

  it("lets an unreachable provider throw, for the caller to name", async () => {
    const transport: MailTransport = () => Promise.reject(new TypeError("fetch failed"));
    await expect(
      createSesProvider({ ...SES, transport }).send({
        to: "a@example.com",
        subject: "s",
        text: "t",
      }),
    ).rejects.toThrow("fetch failed");
  });
});

describe("createResendProvider — the request the senders always built", () => {
  it("sends Resend's body with Bearer auth and the idempotency key", async () => {
    const { transport, calls } = recording({ status: 200, body: '{"id":"re-1"}' });
    const result = await createResendProvider({
      endpoint: "https://api.resend.com/emails",
      apiKey: "re_key",
      from: "f@x",
      transport,
    }).send({
      to: "a@example.com",
      subject: "s",
      text: "t",
      replyTo: "r@x",
      idempotencyKey: "k-1",
    });
    expect(result).toEqual({ ok: true, messageId: "re-1" });
    expect(calls[0]?.headers).toMatchObject({
      authorization: "Bearer re_key",
      "idempotency-key": "k-1",
    });
    expect(calls[0]?.body).toEqual({
      from: "f@x",
      to: ["a@example.com"],
      subject: "s",
      text: "t",
      reply_to: "r@x",
    });
  });

  it("sends no idempotency header when the mail has no key", async () => {
    const { transport, calls } = recording();
    await createResendProvider({
      endpoint: "https://x.test",
      apiKey: "k",
      from: "f",
      transport,
    }).send({
      to: "a@example.com",
      subject: "s",
      text: "t",
    });
    expect(Object.keys(calls[0]?.headers ?? {})).not.toContain("idempotency-key");
  });

  it("classifies 5xx and 429 as retryable, other 4xx as the message's fault", async () => {
    for (const [status, retryable] of [
      [503, true],
      [429, true],
      [422, false],
    ] as const) {
      const { transport } = recording({ status, body: "nope" });
      const result = await createResendProvider({
        endpoint: "https://x.test",
        apiKey: "k",
        from: "f",
        transport,
      }).send({ to: "a@example.com", subject: "s", text: "t" });
      expect(result).toEqual({ ok: false, status, retryable, detail: "nope" });
    }
  });
});

describe("selectedProvider — which one the settings name", () => {
  const resend: MailEnv = {
    EMAIL_API_ENDPOINT: "https://api.resend.com/emails",
    EMAIL_API_KEY: "re_x",
    EMAIL_FROM: "f@x",
  };
  const ses: MailEnv = {
    SES_REGION: "ap-south-1",
    SES_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
    SES_SECRET_ACCESS_KEY: "secret-secret-secret-x",
    EMAIL_FROM: "f@x",
  };

  it.each<[string, MailEnv, "resend" | "ses" | null]>([
    ["auto, nothing set", {}, null],
    ["auto, Resend set", resend, "resend"],
    ["auto, SES set", ses, "ses"],
    ["auto, both — Resend, what auto always meant", { ...resend, ...ses }, "resend"],
    ["ses, both", { ...resend, ...ses, EMAIL_PROVIDER: "ses" }, "ses"],
    ["ses, only Resend set — not silently Resend", { ...resend, EMAIL_PROVIDER: "ses" }, null],
    ["resend, both", { ...resend, ...ses, EMAIL_PROVIDER: "resend" }, "resend"],
    ["http is Resend's old name", { ...resend, EMAIL_PROVIDER: "http" }, "resend"],
    ["dev beats live credentials", { ...resend, ...ses, EMAIL_PROVIDER: "dev" }, null],
    ["ses without a From", { ...ses, EMAIL_FROM: undefined, EMAIL_PROVIDER: "ses" }, null],
    ["empty strings are not settings", { ...ses, SES_SECRET_ACCESS_KEY: "" }, null],
  ])("%s", (_label, env, expected) => {
    expect(selectedProvider(env)).toBe(expected);
    expect(mailProviderFromEnv(env)?.name ?? null).toBe(expected);
  });
});
