import { describe, expect, it } from "vitest";

import { clientAddress } from "./client-address";

describe("clientAddress — the per-client key behind a proxy", () => {
  it("with no proxy declared, the TCP peer is the client", () => {
    expect(clientAddress({}, "203.0.113.9", 0)).toBe("203.0.113.9");
  });

  it("behind one proxy, reads the rightmost forwarded entry — not the proxy's own address", () => {
    const headers = { "x-forwarded-for": "198.51.100.7" };
    expect(clientAddress(headers, "172.18.0.5", 1)).toBe("198.51.100.7");
  });

  it("never reads the spoofable leftmost entry", () => {
    // The client typed 1.2.3.4; Caddy appended the real peer.
    const headers = { "x-forwarded-for": "1.2.3.4, 198.51.100.7" };
    expect(clientAddress(headers, "172.18.0.5", 1)).toBe("198.51.100.7");
  });

  it("two clients behind the same proxy get two different keys", () => {
    const a = clientAddress({ "x-forwarded-for": "198.51.100.7" }, "172.18.0.5", 1);
    const b = clientAddress({ "x-forwarded-for": "198.51.100.8" }, "172.18.0.5", 1);
    expect(a).not.toBe(b);
  });

  it("a chain shorter than the declared hops, or none at all, has no trustworthy address", () => {
    expect(clientAddress({ "x-forwarded-for": "198.51.100.7" }, "172.18.0.5", 2)).toBe("");
    expect(clientAddress({}, "172.18.0.5", 1)).toBe("");
  });
});
