import { describe, expect, it } from "vitest";

import { NO_TEXT_CHANNEL, textFallback, type WhatsAppBlock } from "./text-route";

const FIRST = { attempts: 1, maxAttempts: 5 };
const LAST = { attempts: 5, maxAttempts: 5 };

const every: WhatsAppBlock[] = [
  { kind: "unconfigured" },
  { kind: "template_unset" },
  { kind: "not_opted_in" },
  { kind: "breaker_open", error: "WhatsApp provider unavailable (breaker open)" },
  { kind: "unavailable", error: "WhatsApp unavailable (status 503)" },
  { kind: "refused", error: "WhatsApp refused the send (status 400)" },
];

describe("WITH an SMS gateway — the fallback that existed before WhatsApp", () => {
  it("sends by SMS whatever stopped WhatsApp", () => {
    for (const block of every) {
      expect(textFallback(block, { smsAvailable: true, ...FIRST }).action, block.kind).toBe("sms");
    }
  });

  it("keeps a WhatsApp error on the row, so the fallback is visible", () => {
    expect(
      textFallback(
        { kind: "refused", error: "WhatsApp refused the send (status 400)" },
        {
          smsAvailable: true,
          ...FIRST,
        },
      ),
    ).toEqual({ action: "sms", note: "WhatsApp: WhatsApp refused the send (status 400)" });
    expect(textFallback({ kind: "not_opted_in" }, { smsAvailable: true, ...FIRST })).toEqual({
      action: "sms",
      note: null,
    });
  });
});

describe("WITHOUT SMS — no channel is a decision, not a failure", () => {
  it("suppresses the three 'WhatsApp is not for this' cases with a no_text_channel reason", () => {
    expect(textFallback({ kind: "not_opted_in" }, { smsAvailable: false, ...FIRST })).toEqual({
      action: "suppress",
      reason: "no_text_channel: not opted in to WhatsApp",
    });
    expect(textFallback({ kind: "template_unset" }, { smsAvailable: false, ...FIRST })).toEqual({
      action: "suppress",
      reason: "no_text_channel: WhatsApp template not approved",
    });
    expect(textFallback({ kind: "unconfigured" }, { smsAvailable: false, ...FIRST })).toEqual({
      action: "suppress",
      reason: "no_text_channel: WhatsApp is not set up",
    });
  });

  it("suppresses a refusal at once — asking Meta again gets the same answer", () => {
    const route = textFallback(
      { kind: "refused", error: "WhatsApp refused the send (status 400)" },
      { smsAvailable: false, ...FIRST },
    );
    expect(route.action).toBe("suppress");
    expect(route.action === "suppress" && route.reason.startsWith(NO_TEXT_CHANNEL)).toBe(true);
  });

  it("WAITS OUT an open breaker rather than lose the message to a blip", () => {
    for (const attempts of [FIRST, LAST]) {
      expect(
        textFallback(
          { kind: "breaker_open", error: "WhatsApp provider unavailable (breaker open)" },
          { smsAvailable: false, ...attempts },
        ).action,
      ).toBe("wait_breaker");
    }
  });

  it("retries an outage on the back-off ladder, and settles it as no channel — never failed", () => {
    const outage: WhatsAppBlock = { kind: "unavailable", error: "WhatsApp unreachable" };
    expect(textFallback(outage, { smsAvailable: false, ...FIRST })).toEqual({
      action: "retry",
      reason: "WhatsApp: WhatsApp unreachable",
    });
    expect(textFallback(outage, { smsAvailable: false, ...LAST })).toEqual({
      action: "suppress",
      reason: "no_text_channel: WhatsApp unavailable (WhatsApp unreachable)",
    });
  });

  it("never answers 'sms' — there is none to send by", () => {
    for (const block of every) {
      expect(textFallback(block, { smsAvailable: false, ...LAST }).action, block.kind).not.toBe(
        "sms",
      );
    }
  });
});
