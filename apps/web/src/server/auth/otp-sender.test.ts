import { describe, expect, it, vi } from "vitest";

import {
  Msg91OtpSender,
  OtpSendError,
  WhatsAppCloudOtpSender,
  type SmsTransport,
} from "./otp-sender";

function sender(
  transport: SmsTransport,
  overrides: { now?: () => number; threshold?: number; cooldownMs?: number } = {},
) {
  return new Msg91OtpSender({
    authKey: "test-key",
    templateId: "test-template",
    transport,
    ...(overrides.now !== undefined ? { now: overrides.now } : {}),
    ...(overrides.threshold !== undefined ? { breakerThreshold: overrides.threshold } : {}),
    ...(overrides.cooldownMs !== undefined ? { breakerCooldownMs: overrides.cooldownMs } : {}),
  });
}

describe("Msg91OtpSender", () => {
  it("posts the code to the provider with digits-only mobile and auth header", async () => {
    const transport = vi
      .fn<SmsTransport>()
      .mockResolvedValue({ status: 200, body: '{"type":"success"}' });
    await sender(transport).send("+919876543210", "123456");
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0] as Parameters<SmsTransport>;
    expect(url).toContain("mobile=919876543210");
    expect(url).toContain("template_id=test-template");
    expect(url).toContain("otp=123456");
    expect(init.method).toBe("POST");
    expect(init.headers["authkey"]).toBe("test-key");
  });

  it("raises OtpSendError on provider rejection and on network failure", async () => {
    const rejecting = vi
      .fn<SmsTransport>()
      .mockResolvedValue({ status: 401, body: '{"type":"error"}' });
    await expect(sender(rejecting).send("+919876543210", "111111")).rejects.toBeInstanceOf(
      OtpSendError,
    );
    const unreachable = vi.fn<SmsTransport>().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(sender(unreachable).send("+919876543210", "111111")).rejects.toBeInstanceOf(
      OtpSendError,
    );
  });

  it("opens the breaker after consecutive failures and fails fast without calling the provider", async () => {
    let now = 1_000_000;
    const failing = vi.fn<SmsTransport>().mockResolvedValue({ status: 500, body: "boom" });
    const s = sender(failing, { now: () => now, threshold: 3, cooldownMs: 60_000 });
    for (let i = 0; i < 3; i += 1) {
      await expect(s.send("+919876543210", "222222")).rejects.toBeInstanceOf(OtpSendError);
    }
    expect(s.breakerIsOpen()).toBe(true);
    await expect(s.send("+919876543210", "222222")).rejects.toMatchObject({ breakerOpen: true });
    // Fail-fast: the provider was NOT called a fourth time.
    expect(failing).toHaveBeenCalledTimes(3);
    // SMS-pumping protection: 100 more attempts while open → zero provider calls.
    for (let i = 0; i < 100; i += 1) {
      await expect(s.send("+919876543210", "222222")).rejects.toMatchObject({ breakerOpen: true });
    }
    expect(failing).toHaveBeenCalledTimes(3);
    now += 61_000; // cooldown elapses → half-open probe allowed
    expect(s.breakerIsOpen()).toBe(false);
  });

  it("closes the breaker on a successful probe and resets the failure count", async () => {
    let now = 0;
    let healthy = false;
    const transport = vi
      .fn<SmsTransport>()
      .mockImplementation(() =>
        Promise.resolve(healthy ? { status: 200, body: "ok" } : { status: 503, body: "down" }),
      );
    const s = sender(transport, { now: () => now, threshold: 2, cooldownMs: 10_000 });
    await expect(s.send("+919876543210", "1")).rejects.toBeInstanceOf(OtpSendError);
    await expect(s.send("+919876543210", "1")).rejects.toBeInstanceOf(OtpSendError);
    expect(s.breakerIsOpen()).toBe(true);
    now = 10_001;
    healthy = true;
    await s.send("+919876543210", "1"); // probe succeeds → breaker closes
    expect(s.breakerIsOpen()).toBe(false);
    await s.send("+919876543210", "1"); // normal operation resumes
    expect(transport).toHaveBeenCalledTimes(4);
  });
});

function whatsapp(
  transport: SmsTransport,
  overrides: { now?: () => number; threshold?: number; cooldownMs?: number } = {},
) {
  return new WhatsAppCloudOtpSender({
    phoneNumberId: "1234567890",
    accessToken: "test-token",
    templateName: "login_code",
    transport,
    ...(overrides.now !== undefined ? { now: overrides.now } : {}),
    ...(overrides.threshold !== undefined ? { breakerThreshold: overrides.threshold } : {}),
    ...(overrides.cooldownMs !== undefined ? { breakerCooldownMs: overrides.cooldownMs } : {}),
  });
}

interface TemplatePayload {
  messaging_product: string;
  to: string;
  type: string;
  template: {
    name: string;
    language: { code: string };
    components: { type: string; sub_type?: string; parameters: { text: string }[] }[];
  };
}

describe("WhatsAppCloudOtpSender", () => {
  it("posts an authentication template to the phone-number id with a bearer token", async () => {
    const transport = vi
      .fn<SmsTransport>()
      .mockResolvedValue({ status: 200, body: '{"messages":[{"id":"wamid.X"}]}' });
    await whatsapp(transport).send("+919876543210", "123456");

    const [url, init] = transport.mock.calls[0] as Parameters<SmsTransport>;
    // The MESSAGES edge of the phone-number id — not the phone number itself,
    // which is the mistake that returns 400 with an unhelpful message.
    expect(url).toContain("/1234567890/messages");
    // Pinned Graph version: an unpinned call silently follows whatever Meta
    // promotes to "latest", and an OTP path must not change shape on a Tuesday.
    expect(url).toContain("/v21.0/");
    expect(init.method).toBe("POST");
    expect(init.headers["authorization"]).toBe("Bearer test-token");

    const body = JSON.parse(init.body ?? "{}") as TemplatePayload;
    expect(body.messaging_product).toBe("whatsapp");
    // E.164 in the database, digits-only on the wire.
    expect(body.to).toBe("919876543210");
    expect(body.template.name).toBe("login_code");
    expect(body.template.language.code).toBe("en");
  });

  it("sends the code TWICE — body variable and copy-code button", async () => {
    /*
     * The failure this guards is silent and expensive: send only the body
     * parameter and Meta answers 200, the message arrives, and the copy-code
     * button is dead. The user sees a code they cannot copy and support hears
     * "WhatsApp login is broken" with a green tick in your logs.
     */
    const transport = vi.fn<SmsTransport>().mockResolvedValue({ status: 200, body: "{}" });
    await whatsapp(transport).send("+919876543210", "654321");
    const [, init] = transport.mock.calls[0] as Parameters<SmsTransport>;
    const body = JSON.parse(init.body ?? "{}") as TemplatePayload;

    const bodyComponent = body.template.components.find((c) => c.type === "body");
    const button = body.template.components.find((c) => c.type === "button");
    expect(bodyComponent?.parameters[0]?.text).toBe("654321");
    expect(button?.sub_type).toBe("url");
    expect(button?.parameters[0]?.text).toBe("654321");
  });

  it("treats a 200 carrying an error object as a failure", async () => {
    /*
     * Meta answers 200 with an `error` object for some rejections. Reading only
     * the status would count those as sent: the breaker would never trip and
     * the login form would keep paying for messages nobody receives.
     */
    const transport = vi.fn<SmsTransport>().mockResolvedValue({
      status: 200,
      body: '{"error":{"message":"Template name does not exist","code":132001}}',
    });
    await expect(whatsapp(transport).send("+919876543210", "111111")).rejects.toBeInstanceOf(
      OtpSendError,
    );
  });

  it("raises OtpSendError on rejection and on network failure", async () => {
    const rejecting = vi
      .fn<SmsTransport>()
      .mockResolvedValue({ status: 401, body: "unauthorized" });
    await expect(whatsapp(rejecting).send("+919876543210", "1")).rejects.toBeInstanceOf(
      OtpSendError,
    );
    const dead = vi.fn<SmsTransport>().mockRejectedValue(new Error("ECONNRESET"));
    await expect(whatsapp(dead).send("+919876543210", "1")).rejects.toBeInstanceOf(OtpSendError);
  });

  it("opens the breaker after consecutive failures and then fails fast", async () => {
    // Same guarantee MSG91 has: one melted provider must not turn the login
    // form into a paid-message amplifier.
    const transport = vi.fn<SmsTransport>().mockResolvedValue({ status: 500, body: "boom" });
    const sender = whatsapp(transport, { threshold: 2, cooldownMs: 60_000, now: () => 1_000 });
    await expect(sender.send("+919876543210", "1")).rejects.toBeInstanceOf(OtpSendError);
    await expect(sender.send("+919876543210", "2")).rejects.toBeInstanceOf(OtpSendError);
    expect(sender.breakerIsOpen()).toBe(true);

    const calls = transport.mock.calls.length;
    const refused = await sender.send("+919876543210", "3").catch((e: unknown) => e);
    expect((refused as OtpSendError).breakerOpen).toBe(true);
    // The point of the breaker: no provider call at all.
    expect(transport.mock.calls.length).toBe(calls);
  });

  it("closes the breaker on a successful probe after the cooldown", async () => {
    let clock = 1_000;
    const transport = vi
      .fn<SmsTransport>()
      .mockResolvedValueOnce({ status: 500, body: "boom" })
      .mockResolvedValue({ status: 200, body: "{}" });
    const sender = whatsapp(transport, { threshold: 1, cooldownMs: 5_000, now: () => clock });
    await expect(sender.send("+919876543210", "1")).rejects.toBeInstanceOf(OtpSendError);
    expect(sender.breakerIsOpen()).toBe(true);
    clock += 5_001;
    expect(sender.breakerIsOpen()).toBe(false);
    await sender.send("+919876543210", "2");
    expect(sender.breakerIsOpen()).toBe(false);
  });

  it("honours a template language other than the default", async () => {
    const transport = vi.fn<SmsTransport>().mockResolvedValue({ status: 200, body: "{}" });
    await new WhatsAppCloudOtpSender({
      phoneNumberId: "1",
      accessToken: "t",
      templateName: "login_code",
      templateLanguage: "en_US",
      transport,
    }).send("+919876543210", "9");
    const [, init] = transport.mock.calls[0] as Parameters<SmsTransport>;
    const body = JSON.parse(init.body ?? "{}") as TemplatePayload;
    // Meta matches the locale EXACTLY; "en" and "en_US" are different templates
    // and the wrong one is a 132001 rejection.
    expect(body.template.language.code).toBe("en_US");
  });
});
