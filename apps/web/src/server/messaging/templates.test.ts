import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { SMS_TEMPLATES, renderTemplate, slotsInBody, type TemplateKey } from "./templates";

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
        expect(rendered.body.length, `${key} at maximum slot lengths`).toBeLessThanOrEqual(320);
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

  it("fills the slots", () => {
    const result = renderTemplate(approved, {
      competition: "Bandra Premier League 2027",
      link: "desiauction.in/c/bpl-2027",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toBe(
        "DesiAuction: You are approved for Bandra Premier League 2027. You are in the player pool for auction day. Details: desiauction.in/c/bpl-2027",
      );
    }
  });

  it("refuses a missing slot rather than sending a gap", () => {
    const result = renderTemplate(approved, { competition: "BPL 2027" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("link");
    }
  });

  it("refuses an unknown slot, because it means the caller has drifted", () => {
    const result = renderTemplate(approved, {
      competition: "BPL 2027",
      link: "x",
      reason: "not a slot here",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("reason");
    }
  });

  it("refuses an over-long slot rather than truncating it", () => {
    const result = renderTemplate(approved, { competition: "x".repeat(61), link: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("61 characters");
    }
  });
});
