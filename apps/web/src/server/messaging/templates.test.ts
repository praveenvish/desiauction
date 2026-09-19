import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { NAME_MAX_LENGTH } from "@desiauction/core";

import { REASON_TO_PLAYER } from "../competition/registration-notify";
import {
  DLT_VAR_MAX,
  SMS_TEMPLATES,
  renderTemplate,
  slotsInBody,
  smsSeasonName,
  type TemplateKey,
} from "./templates";

/**
 * The registry's contract with the operator. These are not unit tests of a
 * formatter — they are the checks that stop this file drifting away from what
 * is registered under DLT, which is a failure that shows up as messages being
 * scrubbed at the gateway rather than as an exception anywhere we can see.
 */
describe("SMS template registry", () => {
  const keys = Object.keys(SMS_TEMPLATES) as TemplateKey[];

  it("declares exactly the slots its body uses", () => {
    for (const key of keys) {
      const template = SMS_TEMPLATES[key];
      const inBody = [...new Set(slotsInBody(template.body))].sort();
      const declared = [...template.slots.map((slot) => slot.name)].sort();
      expect(declared, `${key}: declared slots vs the text`).toEqual(inBody);
    }
  });

  it("gives every shape its own provider template id", () => {
    // One id shared across shapes is the defect this registry replaces: DLT
    // registers one template per shape, so five shapes need five ids.
    const envs = keys.map((key) => SMS_TEMPLATES[key].providerTemplateEnv);
    expect(new Set(envs).size).toBe(keys.length);
  });

  it("keeps every rendered message inside one SMS segment", () => {
    // 160 GSM-7 characters before a message splits. A split transactional SMS
    // costs more and is likelier to be scrubbed, so the budget is a contract:
    // fill every slot to its declared maximum and the worst case must still fit.
    for (const key of keys) {
      const template = SMS_TEMPLATES[key];
      const worst = Object.fromEntries(
        template.slots.map((slot) => [slot.name, "x".repeat(slot.maxLength)]),
      );
      const rendered = renderTemplate(template, worst);
      expect(rendered.ok, `${key} failed to render at its declared maxima`).toBe(true);
      if (rendered.ok) {
        expect(rendered.body.length, `${key} at maximum slot lengths`).toBeLessThanOrEqual(160);
      }
    }
  });

  it("uses only GSM-7-safe characters", () => {
    // A single curly quote or en dash flips the whole message to UCS-2 and
    // halves the segment budget from 160 characters to 70. The old prose used
    // "You're" and an em dash; that is why this test exists.
    for (const key of keys) {
      const body = SMS_TEMPLATES[key].body;
      const unsafe = Array.from(body).filter((ch) => (ch.codePointAt(0) ?? 0) > 127);
      expect(unsafe, `${key} contains non-GSM-7 characters: ${unsafe.join("")}`).toEqual([]);
    }
  });

  it("names an env var that env.ts actually declares", () => {
    // The registry and the validated env surface must not drift. If a template
    // names a variable env.ts does not know, the id resolves to undefined and
    // that shape stops sending — silently, in production, with the dev inbox
    // showing nothing wrong. Read env.ts's source rather than its parsed value,
    // because these are all optional and absent in test.
    const envSource = readFileSync(resolve(__dirname, "../../env.ts"), "utf8");
    for (const key of keys) {
      const variable = SMS_TEMPLATES[key].providerTemplateEnv;
      expect(envSource, `${key} names ${variable}, which env.ts does not declare`).toContain(
        `${variable}:`,
      );
    }
  });

  it("marks every decision notice transactional", () => {
    // Each is the direct consequence of something the recipient did. If one is
    // ever reclassified promotional it needs a recorded opt-in, and this test
    // is where that conversation should start.
    for (const key of keys) {
      expect(SMS_TEMPLATES[key].category, key).toBe("transactional");
    }
  });
});

describe("renderTemplate", () => {
  const approved = SMS_TEMPLATES["registration.approved"];

  it("fills the slots, with the link as fixed text", () => {
    const result = renderTemplate(approved, { competition: "Bandra Premier League 2027" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toBe(
        "DesiAuction: You are approved for Bandra Premier League 2027. You are in the player pool for auction day. https://desiauction.in/home",
      );
    }
  });

  it("refuses a missing slot rather than sending a gap", () => {
    const result = renderTemplate(approved, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("competition");
    }
  });

  it("refuses an unknown slot, because it means the caller has drifted", () => {
    // `link` was a slot in v1; a caller still passing it has not moved to v2.
    const result = renderTemplate(approved, { competition: "BPL 2027", link: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("link");
    }
  });

  it("refuses an over-long slot rather than truncating it", () => {
    const result = renderTemplate(approved, { competition: "x".repeat(DLT_VAR_MAX + 1) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain(`${String(DLT_VAR_MAX + 1)} characters`);
    }
  });
});

/**
 * DLT'S LIMITS, held as tests (v2).
 *
 * The operator portals cap each `{#var#}` at 30 characters, and a URL must be
 * fixed text on a whitelisted domain. Every number below is tied to what
 * produces it, so a cap that drifts from its producer fails here rather than at
 * a gateway — where it would show up as a notice nobody received.
 */
describe("DLT limits (v2)", () => {
  const keys = Object.keys(SMS_TEMPLATES) as TemplateKey[];

  it("holds every variable to one DLT variable", () => {
    for (const key of keys) {
      for (const slot of SMS_TEMPLATES[key].slots) {
        expect(slot.maxLength, `${key}.${slot.name}`).toBeLessThanOrEqual(DLT_VAR_MAX);
      }
    }
  });

  it("fits every season name the product accepts into the variable", () => {
    // The shortened name, not a refusal: a long season name must never cost a
    // player their notice.
    const longest = "Mumbai Corporate Premier League Season Twenty Twenty Seven Cup";
    for (const name of [longest.slice(0, NAME_MAX_LENGTH), "x".repeat(NAME_MAX_LENGTH), "BPL"]) {
      const short = smsSeasonName(name);
      expect(short.length, name).toBeLessThanOrEqual(DLT_VAR_MAX);
      expect(
        Array.from(short).every((ch) => (ch.codePointAt(0) ?? 0) < 128),
        short,
      ).toBe(true);
    }
    expect(smsSeasonName("Malad Premier League 2026")).toBe("Malad Premier League 2026");
    expect(smsSeasonName(longest)).toBe("Mumbai Corporate Premier");
    // No trailing punctuation to collide with the template's own full stop.
    expect(smsSeasonName("Bandra Gymkhana Cricket, Invitational 2027")).toBe(
      "Bandra Gymkhana Cricket",
    );
  });

  it("fits every sentence REASON_TO_PLAYER can send into the variable", () => {
    for (const [reason, text] of Object.entries(REASON_TO_PLAYER)) {
      expect(text.length, reason).toBeLessThanOrEqual(DLT_VAR_MAX);
    }
  });

  it("carries links only as fixed text on the production domain", () => {
    // TRAI (2024): a URL must be on a domain whitelisted under the entity.
    for (const key of keys) {
      const urls = SMS_TEMPLATES[key].body.match(/https?:\/\/[^\s]+/g) ?? [];
      for (const url of urls) {
        expect(url, key).toMatch(/^https:\/\/desiauction\.in\//);
      }
      expect(slotsInBody(SMS_TEMPLATES[key].body), key).not.toContain("link");
    }
  });

  it("is ONE segment for every template, even at every variable's maximum", () => {
    for (const key of keys) {
      const t = SMS_TEMPLATES[key];
      const worst =
        t.body.replace(/\{[a-z0-9_]+\}/g, "").length + t.slots.reduce((n, s) => n + s.maxLength, 0);
      expect(worst, `${key} is ${String(worst)} chars`).toBeLessThanOrEqual(160);
    }
  });
});
