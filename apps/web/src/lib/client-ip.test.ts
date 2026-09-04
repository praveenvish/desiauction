import { describe, expect, it } from "vitest";

import { clientIp } from "./client-ip";

const h = (headers: Record<string, string>): Headers => new Headers(headers);

describe("clientIp (PRR P2/F32 — spoof-resistant per-IP throttle)", () => {
  it("ignores x-forwarded-for entirely when no proxy is trusted", () => {
    // The leftmost XFF entry is client-controlled; with 0 trusted proxies it is
    // never read, so a spoofed value cannot seed the throttle.
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4" }), 0)).toBeNull();
  });

  it("with one trusted proxy, reads the entry the proxy appended (rightmost)", () => {
    // Client claims 9.9.9.9; the single ingress appends the real 1.2.3.4.
    expect(clientIp(h({ "x-forwarded-for": "9.9.9.9, 1.2.3.4" }), 1)).toBe("1.2.3.4");
  });

  it("a spoofed leftmost entry cannot displace the trusted hop", () => {
    // Attacker prepends many fake hops; the trusted-from-the-right pick is stable.
    expect(clientIp(h({ "x-forwarded-for": "evil1, evil2, evil3, 1.2.3.4" }), 1)).toBe("1.2.3.4");
  });

  it("returns null (never the spoofable leftmost) when the chain is shorter than the trusted count", () => {
    // A spoofer sending fewer hops than trustedProxies, or a misconfigured count:
    // there is no trustworthy entry, so trust none — do NOT fall back to parts[0].
    expect(clientIp(h({ "x-forwarded-for": "9.9.9.9" }), 2)).toBeNull();
    expect(clientIp(h({ "x-forwarded-for": "evil" }), 3)).toBeNull();
  });

  it("falls back to x-real-ip when XFF is absent or not trusted", () => {
    expect(clientIp(h({ "x-real-ip": "5.6.7.8" }), 0)).toBe("5.6.7.8");
    expect(clientIp(h({ "x-real-ip": "5.6.7.8", "x-forwarded-for": "1.1.1.1" }), 0)).toBe(
      "5.6.7.8",
    );
  });

  it("treats loopback as no client context", () => {
    expect(clientIp(h({ "x-real-ip": "127.0.0.1" }), 0)).toBeNull();
    expect(clientIp(h({ "x-forwarded-for": "::1" }), 1)).toBeNull();
  });

  it("returns null when nothing identifies the client", () => {
    expect(clientIp(h({}), 1)).toBeNull();
  });
});
