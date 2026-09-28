import { describe, expect, it, vi } from "vitest";

import { HttpMailer, codeMailCopy, type MailTransport } from "./email-sender";

/**
 * THE MESSAGE HAS TO MATCH WHAT THE PERSON JUST DID.
 *
 * Sign-in first reused the address-confirmation mail, so asking to log in got
 * you "Confirm your email for DesiAuction". Mismatched account mail is how
 * people learn to ignore account mail — and it hands anybody who can trigger a
 * login code a ready-made cover story for the message their victim receives.
 */
describe("codeMailCopy", () => {
  it("names SIGNING IN, and never calls it a confirmation", async () => {
    const copy = await codeMailCopy("123456", "login");
    expect(copy.subject).toContain("sign-in");
    expect(copy.subject.toLowerCase()).not.toContain("confirm");
    expect(copy.text).toContain("123456");
    expect(copy.text.toLowerCase()).not.toContain("confirmation code");
  });

  it("tells somebody who did NOT sign in what it means for them", async () => {
    // Not "ignore this" — that is advice for spam. Their address is known to
    // someone, and their account is safe only while the code stays unshared.
    const copy = await codeMailCopy("123456", "login");
    // The question now opens the boxed line, so it is capitalised there.
    expect(copy.text.toLowerCase()).toContain("did not try to sign in");
    expect(copy.text).toContain("do not share this code");
  });

  it("leads every subject with the code, and names the confirmation as one", async () => {
    // Email v2 (2026-09-28): the code in the subject is on the lock screen and
    // gets Gmail's "Copy code" — the person never has to open the mail.
    for (const purpose of ["login", "signup", "email_change"] as const) {
      expect((await codeMailCopy("123456", purpose)).subject.startsWith("123456 ")).toBe(true);
    }
    const copy = await codeMailCopy("123456", "email_change");
    expect(copy.subject.toLowerCase()).toContain("confirm");
    expect(copy.text).toContain("123456");
  });

  it("shows where and when the code was asked for, when it knows", async () => {
    const at = new Date("2026-09-28T14:12:00Z");
    const copy = await codeMailCopy("123456", "login", "en", { device: "Chrome on macOS", at });
    expect(copy.text).toContain("Device: Chrome on macOS");
    expect(copy.text).toContain("Requested: Mon 28 Sep, 7:42 pm IST");
    const hi = await codeMailCopy("123456", "login", "hi", { device: null, at });
    expect(hi.text).not.toContain("डिवाइस");
    expect(hi.text).toContain("माँगा गया: ");
  });

  it("puts NO link in either — a typed code cannot be followed out of a forward", async () => {
    for (const purpose of ["login", "email_change"] as const) {
      expect((await codeMailCopy("123456", purpose)).text).not.toMatch(/https?:\/\//);
    }
  });
});

describe("HttpMailer", () => {
  it("sends the purpose's own subject and body to the provider", async () => {
    const transport = vi.fn<MailTransport>().mockResolvedValue({ status: 200, body: "{}" });
    await new HttpMailer({
      endpoint: "https://mail.test/send",
      apiKey: "k",
      from: "DesiAuction <no-reply@test>",
      transport,
    }).send("someone@example.com", "654321", "login");

    const [url, init] = transport.mock.calls[0] as Parameters<MailTransport>;
    expect(url).toBe("https://mail.test/send");
    expect(init.headers["authorization"]).toBe("Bearer k");
    const body = JSON.parse(init.body) as { subject: string; text: string; to: string[] };
    expect(body.to).toEqual(["someone@example.com"]);
    expect(body.subject).toContain("sign-in");
    expect(body.text).toContain("654321");
  });

  it("treats a provider rejection as a failure rather than a silent drop", async () => {
    const transport = vi.fn<MailTransport>().mockResolvedValue({ status: 422, body: "nope" });
    await expect(
      new HttpMailer({
        endpoint: "https://mail.test/send",
        apiKey: "k",
        from: "f",
        transport,
      }).send("someone@example.com", "1", "login"),
    ).rejects.toThrow();
  });

  /*
   * THE REASON TRAVELS WITH THE FAILURE. "couldn't send" with nothing behind it
   * hid a corporate TLS proxy for an afternoon (2026-09-18): the dev server had
   * lost NODE_EXTRA_CA_CERTS, every send died on the certificate chain, and
   * neither the page nor the log said so.
   */
  it("names the network cause when the provider cannot be reached", async () => {
    const tls = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "SELF_SIGNED_CERT_IN_CHAIN" },
    });
    const transport = vi.fn<MailTransport>().mockRejectedValue(tls);
    await expect(
      new HttpMailer({
        endpoint: "https://mail.test/send",
        apiKey: "k",
        from: "f",
        transport,
      }).send("someone@example.com", "1", "login"),
    ).rejects.toThrow("mail provider unreachable (SELF_SIGNED_CERT_IN_CHAIN)");
  });

  it("carries the provider's own words on a rejection, bounded", async () => {
    const transport = vi
      .fn<MailTransport>()
      .mockResolvedValue({ status: 403, body: `domain not verified ${"x".repeat(500)}` });
    const failure = new HttpMailer({
      endpoint: "https://mail.test/send",
      apiKey: "k",
      from: "f",
      transport,
    })
      .send("someone@example.com", "1", "login")
      .then(
        () => "sent",
        (error: unknown) => (error as Error).message,
      );
    const message: string = await failure;
    expect(message).toContain("403: domain not verified");
    expect(message.length).toBeLessThan(260);
    // The request carried the API key; the failure must not.
    expect(message).not.toContain("Bearer");
  });
});
