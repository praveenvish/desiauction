import { describe, expect, it } from "vitest";

import { notificationOf } from "./catalogue";
import { notConfiguredReason } from "./delivery-readiness";
import { nextKindStates, type KindState } from "./platform-switch-writer";

/*
 * The web-side halves of the control center, without a database: what a
 * controllability change stores, and the grid's "Not configured" chip. The
 * switches' own resolution and cache are tested beside them, in
 * packages/messaging/src/platform-switches.test.ts.
 */

describe("nextKindStates — TRUE gives the catalogue back, it never stores TRUE", () => {
  const current: KindState[] = [
    {
      kind: "auction.sold",
      channel: "email",
      enabled: true,
      personControllable: false,
      orgControllable: null,
      reason: null,
    },
  ];

  it("restores NULL for true and stores FALSE for false", () => {
    expect(
      nextKindStates({ type: "control", kind: "auction.sold", person: true }, current)[0],
    ).toMatchObject({ personControllable: null, orgControllable: null });
    expect(
      nextKindStates({ type: "control", kind: "auction.sold", org: false }, current)[0],
    ).toMatchObject({ personControllable: false, orgControllable: false });
  });

  it("a switch change keeps controllability and records the trimmed reason", () => {
    expect(
      nextKindStates(
        {
          type: "switch",
          kind: "auction.sold",
          channel: "email",
          enabled: false,
          reason: "  paused  ",
        },
        current,
      )[0],
    ).toMatchObject({ enabled: false, reason: "paused", personControllable: false });
  });
});

describe("notConfiguredReason — the grid's Not configured chip", () => {
  const sold = notificationOf("auction.sold");
  const code = notificationOf("auth.phone_code");

  it("in-app always sends; email needs all three provider settings", () => {
    expect(notConfiguredReason(sold, "in_app", {})).toBeNull();
    expect(notConfiguredReason(sold, "email", {})).not.toBeNull();
    expect(
      notConfiguredReason(sold, "email", {
        EMAIL_API_ENDPOINT: "https://x",
        EMAIL_API_KEY: "k",
        EMAIL_FROM: "a@b.c",
      }),
    ).toBeNull();
  });

  it("WhatsApp needs the account AND this kind's approved template", () => {
    const account = { WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "t" };
    expect(notConfiguredReason(sold, "whatsapp", {})).toBe("WhatsApp not set up");
    expect(notConfiguredReason(sold, "whatsapp", account)).toBe("Template not approved");
    expect(
      notConfiguredReason(sold, "whatsapp", {
        ...account,
        WHATSAPP_TEMPLATE_AUCTION_SOLD: "auction_sold_v1",
      }),
    ).toBeNull();
    expect(
      notConfiguredReason(code, "whatsapp", {
        ...account,
        OTP_PROVIDER: "whatsapp",
        WHATSAPP_TEMPLATE_NAME: "otp",
      }),
    ).toBeNull();
  });

  it("SMS needs a gateway, or the dev inbox locally", () => {
    expect(notConfiguredReason(sold, "sms", {})).toBe("SMS gateway not set up");
    expect(notConfiguredReason(sold, "sms", { OTP_PROVIDER: "dev" })).toBeNull();
    expect(notConfiguredReason(sold, "sms", { MSG91_AUTH_KEY: "k" })).toBe(
      "DLT template not registered",
    );
  });
});
