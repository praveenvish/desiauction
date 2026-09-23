import { describe, expect, it } from "vitest";

import {
  normalizeDeliveryError,
  normalizeFailureReason,
  parseWindow,
  rate,
} from "./delivery-analytics";

describe("parseWindow — ?days= is bounded, whatever is typed", () => {
  it("takes the offered windows as they are", () => {
    expect(parseWindow("7")).toBe(7);
    expect(parseWindow("30")).toBe(30);
    expect(parseWindow("90")).toBe(90);
  });

  it("defaults when absent or not a number", () => {
    expect(parseWindow(undefined)).toBe(30);
    expect(parseWindow("")).toBe(30);
    expect(parseWindow("abc")).toBe(30);
    expect(parseWindow("-7")).toBe(30);
    expect(parseWindow("7.5")).toBe(30);
    expect(parseWindow("1e9")).toBe(30);
  });

  it("snaps up to the next window and never past the ninety-day cap", () => {
    expect(parseWindow("0")).toBe(7);
    expect(parseWindow("1")).toBe(7);
    expect(parseWindow("14")).toBe(30);
    expect(parseWindow("31")).toBe(90);
    expect(parseWindow("3650")).toBe(90);
    expect(parseWindow("999999")).toBe(90);
  });

  it("reads the first of a repeated param", () => {
    expect(parseWindow(["7", "90"])).toBe(7);
  });
});

describe("normalizeFailureReason — a label, never the string", () => {
  it("keeps the codebase's own codes", () => {
    expect(normalizeFailureReason("withheld:opted_out")).toBe("withheld:opted_out");
    expect(normalizeFailureReason("admin_disabled")).toBe("admin_disabled");
    expect(normalizeFailureReason("channel_disabled")).toBe("channel_disabled");
  });

  it("groups the text-route reasons by family and first words", () => {
    expect(normalizeFailureReason("no_text_channel: not opted in to WhatsApp")).toBe(
      "no_text_channel:not_opted_in_to_whatsapp",
    );
    expect(normalizeFailureReason("no_text_channel: no SMS gateway")).toBe(
      "no_text_channel:no_sms_gateway",
    );
    expect(normalizeFailureReason("email provider not configured")).toBe(
      "email_provider_not_configured",
    );
  });

  it("drops bracketed provider detail, so one failure is one bucket", () => {
    const a = normalizeFailureReason("no_text_channel: WhatsApp refused the send (131026 x)");
    const b = normalizeFailureReason("no_text_channel: WhatsApp refused the send (470 y)");
    expect(a).toBe("no_text_channel:whatsapp_refused_the_send");
    expect(b).toBe(a);
  });

  it("never carries an address, a number or a link", () => {
    const label = normalizeFailureReason(
      "rejected: mailbox asha@example.com at +91 98765 43210 see https://x.test/a?b",
    );
    expect(label).not.toMatch(/asha|example|98765|43210|x_test/);
    expect(label.startsWith("rejected:")).toBe(true);
  });

  it("names the empty cases", () => {
    expect(normalizeFailureReason(null)).toBe("unspecified");
    expect(normalizeFailureReason("   ")).toBe("unspecified");
    expect(normalizeFailureReason("x".repeat(500)).length).toBeLessThanOrEqual(64);
  });
});

describe("normalizeDeliveryError — Meta's code survives", () => {
  it("keeps the numeric code and the title's first words", () => {
    expect(normalizeDeliveryError("131026 Message undeliverable")).toBe(
      "whatsapp_delivery:131026_message_undeliverable",
    );
    expect(normalizeDeliveryError("131047")).toBe("whatsapp_delivery:131047");
  });

  it("labels an error with no code", () => {
    expect(normalizeDeliveryError("unknown")).toBe("whatsapp_delivery:unknown");
    expect(normalizeDeliveryError(null)).toBe("whatsapp_delivery:unspecified");
  });
});

describe("rate", () => {
  it("prints one decimal, and a dash for nothing", () => {
    expect(rate(1, 3)).toBe("33.3%");
    expect(rate(0, 0)).toBe("—");
  });
});
