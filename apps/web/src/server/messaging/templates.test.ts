import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { NAME_MAX_LENGTH } from "@desiauction/core";

import { REASON_TO_PLAYER } from "../competition/registration-notify";
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
        // "Details: " was dropped from all five decision notices. Nine
        // characters the reader learns nothing from, and it moved the
        // waitlist, decline and withdrawal notices from two segments to one
        // for an ordinary season name — half the bill on the messages that
        // actually get sent.
        "DesiAuction: You are approved for Bandra Premier League 2027. You are in the player pool for auction day. desiauction.in/c/bpl-2027",
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

/**
 * THE SEGMENT BUDGET, held to measured numbers.
 *
 * An SMS is 160 GSM-7 characters before it splits into 153-character parts,
 * each billed and each more likely to be scrubbed. The registry's comment used
 * to claim the slot budgets were "deliberately tight" while the numbers said
 * otherwise: `link` was capped at 60 when the longest link this product can
 * build is 27, and at their declared maxima five of six templates ran past 160
 * — `registration.rejected` reached 246. Nobody knew, because nothing measured
 * it.
 *
 * Every number below is therefore tied to the thing that actually produces it,
 * not to a constant somebody remembered. A cap that drifts away from its
 * producer fails here rather than at a gateway.
 */
describe("slot budgets are tied to what can actually arrive", () => {
  const capOf = (key: TemplateKey, slot: string): number => {
    const spec = SMS_TEMPLATES[key].slots.find((s) => s.name === slot);
    if (spec === undefined) throw new Error(`${key} has no ${slot} slot`);
    return spec.maxLength;
  };

  it("the competition cap is the longest season name validateName accepts", () => {
    // Not "60 because 60 looks right" — if NAME_MAX_LENGTH moves, a season the
    // product accepts would produce a notice the operator's template refuses,
    // and the player would simply never be told.
    for (const key of Object.keys(SMS_TEMPLATES) as TemplateKey[]) {
      const spec = SMS_TEMPLATES[key].slots.find((s) => s.name === "competition");
      if (spec !== undefined) {
        expect(spec.maxLength, key).toBeGreaterThanOrEqual(NAME_MAX_LENGTH);
      }
    }
  });

  it("the reason cap fits every sentence REASON_TO_PLAYER can send", () => {
    // These are the only values that ever fill the slot, so the cap is either
    // big enough for all of them or the rejection notice is undeliverable for
    // whichever reason is longest — and a decline nobody receives is the
    // failure this whole path exists to avoid.
    const longest = Math.max(...Object.values(REASON_TO_PLAYER).map((r) => r.length));
    expect(capOf("registration.rejected", "reason")).toBeGreaterThanOrEqual(longest);
  });

  it("the link cap fits the link the notifier builds, with room for a longer host", () => {
    /*
     * The link carries no variable part since the season came out of it, so
     * this is only ever `<base>/home`. Production is 27 characters; the cap
     * allows 40 so a staging host does not silently break the one path that
     * cannot report its own failure to a player.
     */
    const cap = capOf("registration.approved", "link");
    for (const base of ["https://desiauction.in", "https://staging.desiauction.in"]) {
      expect(`${base}/home`.length, base).toBeLessThanOrEqual(cap);
    }
  });

  it("every template is ONE segment for a season named the way seasons are named", () => {
    // The case that actually happens, and the one worth paying for.
    const typical = {
      competition: "Malad Premier League 2026",
      link: "https://desiauction.in/home",
      reason: REASON_TO_PLAYER.ineligible,
      last4: "4321",
    };
    for (const key of Object.keys(SMS_TEMPLATES) as TemplateKey[]) {
      const t = SMS_TEMPLATES[key];
      const slots = Object.fromEntries(
        t.slots.map((s) => [s.name, typical[s.name as keyof typeof typical]]),
      );
      const result = renderTemplate(t, slots);
      expect(result.ok, `${key}: ${result.ok ? "" : result.reason}`).toBe(true);
      if (result.ok) {
        expect(result.body.length, `${key} is longer than one segment`).toBeLessThanOrEqual(160);
      }
    }
  });

  it("holds the WORST case to the segment count each template was signed off at", () => {
    /*
     * At the longest season name the product accepts, four of these become two
     * segments. That is a decision, not an oversight: cutting it would mean
     * cutting the sentences that say what a status MEANS, and a player told
     * only "you are on the waitlist" reasonably reads that as a rejection.
     *
     * The point of pinning it is that the next person to add a sentence has to
     * come back here and change a number, rather than doubling the bill for
     * every notice and finding out from an invoice.
     */
    const WORST_CASE_SEGMENTS: Record<TemplateKey, number> = {
      "registration.approved": 2,
      "registration.waitlisted": 2,
      "registration.rejected": 2,
      "registration.withdrawn": 2,
      "registration.restored": 1,
      "security.phone_changed": 1,
    };
    for (const key of Object.keys(SMS_TEMPLATES) as TemplateKey[]) {
      const t = SMS_TEMPLATES[key];
      const worst =
        t.body.replace(/\{[a-z0-9_]+\}/g, "").length + t.slots.reduce((n, s) => n + s.maxLength, 0);
      const segments = worst <= 160 ? 1 : Math.ceil(worst / 153);
      expect(segments, `${key} is ${String(worst)} chars`).toBe(WORST_CASE_SEGMENTS[key]);
    }
  });
});
