import { describe, expect, it } from "vitest";

import type {
  MappedView,
  ProviderTemplatesView,
  SmsRow,
  StatusView,
  WhatsAppRow,
} from "../../../../server/admin/provider-template-views";
import {
  clearLabel,
  mappedCount,
  setupLines,
  setupTitle,
  smsStatus,
  whatsappStatus,
} from "./templates-model";

function mapped(over: Partial<MappedView> = {}): MappedView {
  return {
    handle: null,
    source: "unset",
    languages: null,
    note: null,
    updatedAt: null,
    updatedByName: null,
    envVar: "WHATSAPP_TEMPLATE_X",
    envValue: null,
    ...over,
  };
}

function status(language: string, value: string): StatusView {
  return {
    language,
    status: value,
    label: value,
    tone: "neutral",
    quality: null,
    rejectedReason: null,
    submitted: false,
    at: new Date("2026-09-27T10:00:00Z"),
  };
}

function wa(over: Partial<WhatsAppRow> = {}): WhatsAppRow {
  return {
    kind: "registration.approved",
    label: "Registration approved",
    description: "",
    mapped: mapped(),
    statuses: [],
    approval: null,
    suggestedName: "da_registration_approved",
    submitRefusal: null,
    preview: [],
    approvedCandidates: [],
    ...over,
  };
}

describe("a WhatsApp template's state, in one word", () => {
  const named = mapped({ handle: "da_x", source: "admin" });

  it("is Not set with no name anywhere", () => {
    expect(whatsappStatus(wa())).toEqual({ word: "Not set", tone: "neutral" });
  });

  it("is Mapped while Meta has said nothing about the name", () => {
    expect(whatsappStatus(wa({ mapped: named })).word).toBe("Mapped");
    expect(whatsappStatus(wa({ mapped: named, approval: { verdict: "unknown" } })).word).toBe(
      "Mapped",
    );
  });

  it("follows Meta's verdict: Approved, Pending while in review, else Not approved", () => {
    expect(
      whatsappStatus(wa({ mapped: named, approval: { verdict: "approved", missing: [] } })),
    ).toEqual({ word: "Approved", tone: "green" });
    const refused = { verdict: "not_approved", why: "pending in en" } as const;
    expect(
      whatsappStatus(wa({ mapped: named, approval: refused, statuses: [status("en", "PENDING")] }))
        .word,
    ).toBe("Pending");
    expect(
      whatsappStatus(
        wa({ mapped: named, approval: refused, statuses: [status("en", "REJECTED")] }),
      ),
    ).toEqual({ word: "Not approved", tone: "red" });
  });
});

describe("an SMS template, the counts and the Clear item", () => {
  const sms = (handle: string | null): SmsRow => ({
    kind: "k",
    label: "K",
    mapped: mapped({ handle, source: handle === null ? "unset" : "env" }),
    text: "DesiAuction: {code}",
  });

  it("is Mapped with an id, Not set without", () => {
    expect(smsStatus(sms("1207")).word).toBe("Mapped");
    expect(smsStatus(sms(null)).word).toBe("Not set");
  });

  it("counts the messages with a template set anywhere", () => {
    expect(mappedCount([sms("1"), sms(null), sms("2")])).toBe("2 of 3 mapped");
  });

  it("says where Clear falls back to", () => {
    expect(clearLabel(mapped({ envValue: "da_env" }))).toBe("Clear mapping — back to da_env");
    expect(clearLabel(mapped())).toBe("Clear mapping — no template after");
  });
});

describe("the one set-up banner", () => {
  const view = (over: Partial<ProviderTemplatesView>): ProviderTemplatesView =>
    ({
      syncEnabled: true,
      whatsappConfigured: true,
      smsGateway: true,
      ...over,
    }) as ProviderTemplatesView;

  it("lists what is not set up, WhatsApp first, and titles it from the same facts", () => {
    const all = view({ syncEnabled: false, whatsappConfigured: false, smsGateway: false });
    expect(setupLines(all).map((line) => line.testId)).toEqual([
      "tpl-wa-unconfigured",
      "tpl-sms-dormant",
      "tpl-sync-disabled",
    ]);
    expect(setupTitle(all)).toBe("Nothing mapped here takes effect yet");
    expect(setupTitle(view({ smsGateway: false }))).toBe("SMS mappings don't take effect yet");
    expect(setupTitle(view({ syncEnabled: false }))).toBe("Meta's approvals aren't being read");
  });

  it("draws nothing when everything is set up", () => {
    expect(setupLines(view({}))).toEqual([]);
    expect(setupTitle(view({}))).toBeNull();
  });
});
