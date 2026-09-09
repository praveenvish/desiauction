import { describe, expect, it } from "vitest";

import {
  ENTRY_CATEGORIES,
  entryCategoryLabel,
  evaluateRegistration,
  isEntryCategory,
  type RegistrationEligibilityInput,
} from "./eligibility";
import { GENDERS, type Gender } from "./player-profile";

const NOW = new Date("2026-08-30T12:00:00Z");

function input(overrides: Partial<RegistrationEligibilityInput>): RegistrationEligibilityInput {
  return {
    competitionStatus: "registration_open",
    entryCategory: "open",
    role: "batter",
    sport: "cricket",
    gender: null,
    dateOfBirth: null,
    guardianConsent: false,
    guardianName: "",
    channel: "self",
    now: NOW,
    ...overrides,
  };
}

describe("entry categories", () => {
  it("knows exactly four", () => {
    for (const category of ["open", "men", "women", "mixed"]) {
      expect(isEntryCategory(category)).toBe(true);
    }
    for (const category of ["", "male", "OPEN", "womens", "girls"]) {
      expect(isEntryCategory(category)).toBe(false);
    }
  });

  it("labels for air, never raw enums", () => {
    expect(entryCategoryLabel("women")).toBe("Women's");
    expect(entryCategoryLabel("open")).toBe("Open");
  });
});

describe("evaluateRegistration — the one place gender may decide anything", () => {
  it("admits the plain case with no advisories", () => {
    expect(evaluateRegistration(input({}))).toEqual({
      eligible: true,
      reasons: [],
      advisories: [],
    });
  });

  it("closes intake on the self-serve path only", () => {
    const closed = input({ competitionStatus: "registration_closed" });
    expect(evaluateRegistration(closed).reasons).toContain("intake_closed");
    expect(evaluateRegistration({ ...closed, channel: "organizer" }).reasons).not.toContain(
      "intake_closed",
    );
  });

  it("refuses a role the platform does not know, on every channel", () => {
    for (const channel of ["self", "organizer"] as const) {
      expect(evaluateRegistration(input({ role: "umpire", channel })).reasons).toContain(
        "invalid_role",
      );
    }
    // The forgiving spellings the import path accepts stay accepted here.
    expect(evaluateRegistration(input({ role: "Wicket Keeper" })).eligible).toBe(true);
  });

  it("requires a named guardian for a self-registering minor", () => {
    const minor = input({ dateOfBirth: "2015-01-01" });
    expect(evaluateRegistration(minor).reasons).toContain("minor_missing_guardian");
    expect(
      evaluateRegistration({ ...minor, guardianConsent: true, guardianName: "" }).reasons,
    ).toContain("minor_missing_guardian");
    expect(
      evaluateRegistration({ ...minor, guardianConsent: true, guardianName: "A Parent" }).eligible,
    ).toBe(true);
    // Organizer add/import: minors stay the organizer's judgment (capture UX
    // does not exist on that path; invariant 5).
    expect(evaluateRegistration({ ...minor, channel: "organizer" }).reasons).not.toContain(
      "minor_missing_guardian",
    );
  });

  describe("category — the full matrix", () => {
    const cases: Record<
      Gender | "null",
      Record<(typeof ENTRY_CATEGORIES)[number], "ok" | "block" | "advise">
    > = {
      male: { open: "ok", mixed: "ok", men: "ok", women: "block" },
      female: { open: "ok", mixed: "ok", men: "block", women: "ok" },
      non_binary: { open: "ok", mixed: "ok", men: "advise", women: "advise" },
      self_described: { open: "ok", mixed: "ok", men: "advise", women: "advise" },
      unspecified: { open: "ok", mixed: "ok", men: "advise", women: "advise" },
      null: { open: "ok", mixed: "ok", men: "advise", women: "advise" },
    };

    for (const gender of [...GENDERS, "null"] as const) {
      for (const category of ENTRY_CATEGORIES) {
        const expected = cases[gender][category];
        it(`${gender} × ${category} → ${expected}`, () => {
          const verdict = evaluateRegistration(
            input({
              gender: gender === "null" ? null : gender,
              entryCategory: category,
            }),
          );
          if (expected === "ok") {
            expect(verdict).toEqual({ eligible: true, reasons: [], advisories: [] });
          } else if (expected === "block") {
            expect(verdict.eligible).toBe(false);
            expect(verdict.reasons).toEqual(["category_mismatch"]);
          } else {
            // Not the platform's call: admit, flag for the human gate.
            expect(verdict.eligible).toBe(true);
            expect(verdict.advisories).toEqual(["category_unconfirmed"]);
          }
        });
      }
    }

    it("demotes a direct mismatch to an advisory on the organizer channel — never a silent pass", () => {
      const verdict = evaluateRegistration(
        input({ gender: "female", entryCategory: "men", channel: "organizer" }),
      );
      expect(verdict.eligible).toBe(true);
      expect(verdict.reasons).toEqual([]);
      expect(verdict.advisories).toEqual(["category_mismatch"]);
    });
  });

  it("stacks reasons rather than stopping at the first", () => {
    const verdict = evaluateRegistration(
      input({
        competitionStatus: "draft",
        role: "coach",
        dateOfBirth: "2015-01-01",
        gender: "female",
        entryCategory: "men",
      }),
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons).toEqual([
      "intake_closed",
      "invalid_role",
      "minor_missing_guardian",
      "category_mismatch",
    ]);
  });
});
