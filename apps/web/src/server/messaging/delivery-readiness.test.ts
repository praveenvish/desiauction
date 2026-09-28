import { describe, expect, it } from "vitest";

import { smsRoute } from "./delivery-readiness";

describe("smsRoute", () => {
  it("is the gateway whenever the MSG91 key is set, whatever sends the codes", () => {
    expect(smsRoute({ MSG91_AUTH_KEY: "k", OTP_PROVIDER: "dev" })).toBe("gateway");
    expect(smsRoute({ MSG91_AUTH_KEY: "k", OTP_PROVIDER: "whatsapp" })).toBe("gateway");
  });

  it("is the development inbox with no key under OTP_PROVIDER=dev", () => {
    expect(smsRoute({ OTP_PROVIDER: "dev" })).toBe("dev_inbox");
    expect(smsRoute({ MSG91_AUTH_KEY: "", OTP_PROVIDER: "dev" })).toBe("dev_inbox");
  });

  it("is nowhere with no key on a real server", () => {
    expect(smsRoute({ OTP_PROVIDER: "whatsapp" })).toBe("none");
    expect(smsRoute({})).toBe("none");
  });
});
