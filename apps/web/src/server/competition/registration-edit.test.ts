import { sportPackFor } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import { planRegistrationEdit, type RegistrationEditContext } from "./registration-edit";

const NOW = new Date("2026-09-19T10:00:00Z");

function context(overrides: Partial<RegistrationEditContext> = {}): RegistrationEditContext {
  return {
    pack: sportPackFor("cricket"),
    bands: ["A", "B", "C"],
    rosterLocked: false,
    storedAttributes: {},
    now: NOW,
    ...overrides,
  };
}

describe("editing a player in place — the import's rules, one field at a time", () => {
  it("writes a typed name, trimmed and single-spaced", () => {
    const plan = planRegistrationEdit({ name: "  Rohit   Sharma " }, context());
    expect(plan).toEqual({ ok: true, set: { enteredName: "Rohit Sharma" }, changed: ["name"] });
  });

  it("refuses a blank name", () => {
    expect(planRegistrationEdit({ name: "   " }, context()).ok).toBe(false);
  });

  it("accepts only the season's roles and bands", () => {
    expect(planRegistrationEdit({ role: "batter", basePriceBand: "B" }, context())).toEqual({
      ok: true,
      set: { role: "batter", basePriceBand: "B" },
      changed: ["role", "basePriceBand"],
    });
    const bad = planRegistrationEdit({ role: "goalkeeper", basePriceBand: "Z" }, context());
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(Object.keys(bad.fieldErrors).sort()).toEqual(["basePriceBand", "role"]);
    }
  });

  it("freezes role and band once the auction has started, and nothing else", () => {
    const plan = planRegistrationEdit(
      { role: "bowler", jerseyNumber: "18" },
      context({ rosterLocked: true }),
    );
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.fieldErrors.role).toContain("locked");
      expect(plan.fieldErrors.jerseyNumber).toBeUndefined();
    }
    expect(planRegistrationEdit({ jerseyNumber: "18" }, context({ rosterLocked: true }))).toEqual({
      ok: true,
      set: { jerseyNumber: "18" },
      changed: ["jerseyNumber"],
    });
  });

  it("refuses a date of birth that is not a real, past date", () => {
    for (const dateOfBirth of ["19/09/2000", "2030-01-01", "not a date"]) {
      expect(planRegistrationEdit({ dateOfBirth }, context()).ok).toBe(false);
    }
    expect(planRegistrationEdit({ dateOfBirth: "2000-02-29" }, context())).toEqual({
      ok: true,
      set: { dateOfBirth: "2000-02-29" },
      changed: ["dateOfBirth"],
    });
  });

  it("clears a field with an empty string, which is not the same as zero", () => {
    expect(planRegistrationEdit({ feeAmount: "", tshirtSize: " " }, context())).toEqual({
      ok: true,
      set: { feeAmountPaise: null, tshirtSize: null },
      changed: ["tshirtSize", "feeAmount"],
    });
  });

  it("reads rupees the way a desk writes them", () => {
    expect(planRegistrationEdit({ feeAmount: "₹1,250.50" }, context())).toEqual({
      ok: true,
      set: { feeAmountPaise: 125050 },
      changed: ["feeAmount"],
    });
    expect(planRegistrationEdit({ feeAmount: "12.345" }, context()).ok).toBe(false);
  });

  it("takes only the four fee states", () => {
    expect(planRegistrationEdit({ feeStatus: "paid" }, context()).ok).toBe(true);
    expect(planRegistrationEdit({ feeStatus: "maybe" }, context()).ok).toBe(false);
  });

  it("holds free text to the import's caps", () => {
    expect(planRegistrationEdit({ jerseyNumber: "12345678901" }, context()).ok).toBe(false);
    expect(planRegistrationEdit({ note: "x".repeat(2000) }, context()).ok).toBe(true);
    expect(planRegistrationEdit({ note: "x".repeat(2001) }, context()).ok).toBe(false);
  });

  it("writes cricket's styles to their columns and refuses another sport's", () => {
    const plan = planRegistrationEdit(
      { attributes: { batting_style: "left_hand", bowling_style: "" } },
      context(),
    );
    expect(plan).toEqual({
      ok: true,
      set: { battingStyle: "left_hand", bowlingStyle: null },
      changed: ["attributes"],
    });
    expect(planRegistrationEdit({ attributes: { preferred_foot: "left" } }, context()).ok).toBe(
      false,
    );
  });

  it("merges a json-stored attribute into what was already stored", () => {
    const football = sportPackFor("football");
    const attribute = football.attributes.find((spec) => spec.storage.kind === "json");
    const option = attribute?.options[0];
    if (attribute === undefined || option === undefined) {
      throw new Error("football declares a json attribute with options");
    }
    const plan = planRegistrationEdit(
      { attributes: { [attribute.key]: option.key } },
      context({ pack: football, storedAttributes: { kept: "yes" } }),
    );
    expect(plan).toEqual({
      ok: true,
      set: { attributes: { kept: "yes", [attribute.key]: option.key } },
      changed: ["attributes"],
    });
  });
});
