import { describe, expect, it, vi } from "vitest";

import { Msg91OtpSender, OtpSendError, type SmsTransport } from "./otp-sender";

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
