import { describe, expect, it } from "vitest";

import { notificationOf } from "./catalogue";
import { notConfiguredCause } from "./delivery-readiness";
import { mappingStateFor } from "./provider-template-writer";
import {
  languageFor,
  mappingKey,
  NO_MAPPINGS,
  refuseSmsId,
  refuseWhatsAppName,
  resolveSmsTemplate,
  resolverFor,
  resolveWhatsAppTemplate,
  type MappingRow,
  type MappingSnapshot,
} from "./provider-templates";
import {
  approvalOf,
  EMPTY_STATUS,
  NEVER_SYNCED,
  snapshotOf,
  statusChip,
  type StatusRow,
} from "./template-status";

/*
 * WHICH APPROVED TEMPLATE A MOMENT USES (Notification Control Center, Phase 3),
 * pure: the precedence every sender and the admin grid share, Meta's name
 * rule, and how a status becomes a chip and a verdict.
 */

function mapping(
  kind: string,
  channel: "whatsapp" | "sms",
  handle: string,
  languages = ["en", "hi"],
): MappingRow {
  return {
    kind,
    channel,
    providerTemplateName: channel === "whatsapp" ? handle : null,
    providerTemplateId: channel === "sms" ? handle : null,
    languages,
    note: null,
    updatedBy: null,
    updatedAt: new Date(),
  };
}

function snapshot(...rows: MappingRow[]): MappingSnapshot {
  return new Map(rows.map((r) => [mappingKey(r.kind, r.channel), r]));
}

function status(name: string, language: string, value: string): StatusRow {
  return {
    name,
    language,
    status: value,
    category: "UTILITY",
    quality: null,
    rejectedReason: null,
    metaId: null,
    source: "sync",
    syncedAt: new Date(),
  };
}

const SYNCED = { ...NEVER_SYNCED, lastSuccessAt: new Date(), lastAttemptAt: new Date() };

describe("resolution precedence — admin mapping, then env, then unset", () => {
  const env = { WHATSAPP_TEMPLATE_AUCTION_SOLD: "env_sold", MSG91_TEMPLATE_AUCTION_SOLD: "1107" };

  it("a mapping wins over the env var, and says where it came from", () => {
    const mapped = snapshot(mapping("auction.sold", "whatsapp", "admin_sold", ["en"]));
    expect(resolveWhatsAppTemplate("auction.sold", mapped, env)).toEqual({
      name: "admin_sold",
      source: "admin",
      languages: ["en"],
    });
  });

  it("with no mapping the env var decides — nothing breaks on deploy", () => {
    expect(resolveWhatsAppTemplate("auction.sold", NO_MAPPINGS, env)).toEqual({
      name: "env_sold",
      source: "env",
      languages: null,
    });
  });

  it("neither: unset, and the moment has no WhatsApp", () => {
    expect(resolveWhatsAppTemplate("auction.sold", NO_MAPPINGS, {})).toEqual({
      name: undefined,
      source: "unset",
      languages: null,
    });
    // An empty env var is unset, not a name.
    expect(
      resolveWhatsAppTemplate("auction.sold", NO_MAPPINGS, { WHATSAPP_TEMPLATE_AUCTION_SOLD: "" })
        .source,
    ).toBe("unset");
  });

  it("a mapping for another channel or kind does not leak", () => {
    const mapped = snapshot(mapping("auction.sold", "sms", "9999"));
    expect(resolveWhatsAppTemplate("auction.sold", mapped, {}).name).toBeUndefined();
    expect(
      resolveWhatsAppTemplate(
        "team.appointed",
        snapshot(mapping("auction.sold", "whatsapp", "x")),
        {},
      ).name,
    ).toBeUndefined();
  });

  it("SMS resolves its DLT id the same way", () => {
    expect(
      resolveSmsTemplate("auction.sold", snapshot(mapping("auction.sold", "sms", "2207")), env),
    ).toEqual({ id: "2207", source: "admin" });
    expect(resolveSmsTemplate("auction.sold", NO_MAPPINGS, env)).toEqual({
      id: "1107",
      source: "env",
    });
    expect(resolveSmsTemplate("auction.sold", NO_MAPPINGS, {})).toEqual({
      id: undefined,
      source: "unset",
    });
    // The email change never had an SMS.
    expect(resolveSmsTemplate("security.email_changed", NO_MAPPINGS, env).source).toBe("unset");
  });

  it("the resolver the senders get answers from the same rule", () => {
    const resolver = resolverFor(
      snapshot(mapping("auction.sold", "whatsapp", "admin_sold", ["en"])),
      env,
    );
    expect(resolver.whatsappName("auction.sold")).toBe("admin_sold");
    expect(resolver.whatsappLanguages("auction.sold")).toEqual(["en"]);
    expect(resolver.whatsappName("team.appointed")).toBeUndefined();
    expect(resolver.smsId("auction.sold")).toBe("1107");
  });
});

describe("languageFor — the version a reader gets", () => {
  it("their own language where the name is approved in it", () => {
    expect(languageFor("hi", ["en", "hi"])).toBe("hi");
    expect(languageFor("hi", null)).toBe("hi");
  });
  it("the approved one where it is not — no 132001 round trip", () => {
    expect(languageFor("hi", ["en"])).toBe("en");
    expect(languageFor("en", ["hi"])).toBe("hi");
  });
});

describe("what an admin may map", () => {
  it("Meta's name rule: lowercase letters, digits, underscores, at most 512", () => {
    expect(refuseWhatsAppName("da_auction_sold_v2")).toBeNull();
    expect(refuseWhatsAppName("")).not.toBeNull();
    expect(refuseWhatsAppName("Da_Sold")).not.toBeNull();
    expect(refuseWhatsAppName("da-sold")).not.toBeNull();
    expect(refuseWhatsAppName("da sold")).not.toBeNull();
    expect(refuseWhatsAppName("a".repeat(512))).toBeNull();
    expect(refuseWhatsAppName("a".repeat(513))).not.toBeNull();
  });

  it("a DLT id: letters, digits, - and _", () => {
    expect(refuseSmsId("1107160000000012345")).toBeNull();
    expect(refuseSmsId("64f0a1-b_2")).toBeNull();
    expect(refuseSmsId("id with space")).not.toBeNull();
    expect(refuseSmsId("x".repeat(65))).not.toBeNull();
  });

  it("the sign-in code is never mapped from a screen", () => {
    expect(
      mappingStateFor({ kind: "auth.phone_code", channel: "whatsapp", value: "otp" }),
    ).toMatchObject({ ok: false });
  });

  it("a kind with no template on that channel is refused", () => {
    expect(
      mappingStateFor({ kind: "security.email_changed", channel: "sms", value: "1" }),
    ).toMatchObject({ ok: false });
    expect(mappingStateFor({ kind: "auction.sold", channel: "email", value: "x" })).toMatchObject({
      ok: false,
    });
  });

  it("languages: in catalogue order, at least one, only en/hi", () => {
    expect(
      mappingStateFor({
        kind: "auction.sold",
        channel: "whatsapp",
        value: "  da_sold ",
        languages: ["hi", "en"],
      }),
    ).toEqual({
      ok: true,
      channel: "whatsapp",
      state: {
        providerTemplateName: "da_sold",
        providerTemplateId: null,
        languages: ["en", "hi"],
        note: null,
      },
    });
    expect(
      mappingStateFor({
        kind: "auction.sold",
        channel: "whatsapp",
        value: "da_sold",
        languages: [],
      }),
    ).toMatchObject({ ok: false });
    expect(
      mappingStateFor({
        kind: "auction.sold",
        channel: "whatsapp",
        value: "da_sold",
        languages: ["fr"],
      }),
    ).toMatchObject({ ok: false });
  });

  it("clearing is a null state", () => {
    expect(mappingStateFor({ kind: "auction.sold", channel: "whatsapp", clear: true })).toEqual({
      ok: true,
      channel: "whatsapp",
      state: null,
    });
  });
});

describe("Meta's status → chip and verdict", () => {
  it("each status earns the chip an operator reads", () => {
    expect(statusChip("APPROVED")).toEqual({ label: "Approved", tone: "green" });
    expect(statusChip("PENDING").tone).toBe("amber");
    expect(statusChip("IN_APPEAL")).toEqual({ label: "In appeal", tone: "amber" });
    expect(statusChip("PAUSED").tone).toBe("amber");
    expect(statusChip("REJECTED")).toEqual({ label: "Rejected", tone: "red" });
    expect(statusChip("DISABLED").tone).toBe("red");
    expect(statusChip("SOMETHING_NEW")).toEqual({ label: "SOMETHING_NEW", tone: "neutral" });
  });

  it("never synced: unknown — no accusation without evidence", () => {
    expect(approvalOf("da_sold", null, EMPTY_STATUS)).toEqual({ verdict: "unknown" });
  });

  it("synced and absent: Meta has no template by this name", () => {
    expect(approvalOf("da_typo", null, snapshotOf([], SYNCED))).toMatchObject({
      verdict: "not_approved",
    });
  });

  it("approved in one language: approved, with the missing one named", () => {
    const snap = snapshotOf(
      [status("da_sold", "en", "APPROVED"), status("da_sold", "hi", "PENDING")],
      SYNCED,
    );
    expect(approvalOf("da_sold", ["en", "hi"], snap)).toEqual({
      verdict: "approved",
      missing: ["hi"],
    });
    expect(approvalOf("da_sold", null, snap)).toEqual({ verdict: "approved", missing: ["hi"] });
  });

  it("pending or rejected everywhere it is mapped: not approved, with the status", () => {
    const snap = snapshotOf([status("da_sold", "en", "REJECTED")], SYNCED);
    expect(approvalOf("da_sold", ["en"], snap)).toEqual({
      verdict: "not_approved",
      why: "Rejected",
    });
    // Mapped for Hindi only, but Meta holds only English.
    expect(approvalOf("da_sold", ["hi"], snap)).toMatchObject({ verdict: "not_approved" });
  });
});

describe("the grid's Not configured chip says why", () => {
  const sold = notificationOf("auction.sold");
  const account = { WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "t" };

  it("unmapped → a template issue", () => {
    expect(notConfiguredCause(sold, "whatsapp", account)).toEqual({
      reason: "No approved template mapped",
      templates: true,
    });
  });

  it("mapped in admin (no env) → configured, until the sync says it is not approved", () => {
    const templates = {
      mappings: snapshot(mapping("auction.sold", "whatsapp", "da_sold")),
      status: EMPTY_STATUS,
    };
    expect(notConfiguredCause(sold, "whatsapp", account, templates)).toBeNull();
    const rejected = {
      ...templates,
      status: snapshotOf(
        [status("da_sold", "en", "REJECTED"), status("da_sold", "hi", "REJECTED")],
        SYNCED,
      ),
    };
    expect(notConfiguredCause(sold, "whatsapp", account, rejected)).toEqual({
      reason: "Template not approved — Rejected",
      templates: true,
    });
  });

  it("the account missing is not a template issue", () => {
    expect(notConfiguredCause(sold, "whatsapp", {})).toEqual({
      reason: "WhatsApp not set up",
      templates: false,
    });
  });

  it("an SMS DLT id mapped in admin satisfies the SMS cell", () => {
    const templates = {
      mappings: snapshot(mapping("auction.sold", "sms", "1107")),
      status: EMPTY_STATUS,
    };
    expect(notConfiguredCause(sold, "sms", { MSG91_AUTH_KEY: "k" }, templates)).toBeNull();
    expect(notConfiguredCause(sold, "sms", { MSG91_AUTH_KEY: "k" })).toEqual({
      reason: "DLT template not registered",
      templates: true,
    });
  });
});
