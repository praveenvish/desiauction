import { describe, expect, it } from "vitest";

import {
  COMPETITION_STATUSES,
  REGISTRATION_STATUSES,
  competitionTransition,
  isRegistrationRole,
  isRejectionReason,
  isValidSeasonYear,
  registrationTransition,
  slugifyName,
  validateName,
  type RegistrationEvent,
  type RegistrationStatus,
} from "./competition";

const READY = { hasName: true, hasDates: true, hasLocation: true };

describe("competition lifecycle machine", () => {
  it("walks the pre-auction path with the identity gate satisfied", () => {
    expect(competitionTransition("draft", "setup")).toEqual({ ok: true });
    expect(competitionTransition("setup", "registration_open", READY)).toEqual({ ok: true });
    expect(competitionTransition("registration_open", "registration_closed")).toEqual({ ok: true });
    // Reopening intake is normal and free (doc 39).
    expect(competitionTransition("registration_closed", "registration_open")).toEqual({ ok: true });
  });

  it("blocks Setup→RegistrationOpen until name, dates and location are set (doc 44)", () => {
    expect(competitionTransition("setup", "registration_open")).toEqual({
      ok: false,
      reason: "guard_failed",
    });
    expect(
      competitionTransition("setup", "registration_open", { ...READY, hasDates: false }),
    ).toEqual({ ok: false, reason: "guard_failed" });
  });

  it("refuses undeclared edges — illegal transitions are unrepresentable", () => {
    expect(competitionTransition("draft", "registration_open", READY)).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
    expect(competitionTransition("draft", "registration_closed")).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
    // No self-loops.
    for (const status of COMPETITION_STATUSES) {
      expect(competitionTransition(status, status, READY).ok).toBe(false);
    }
  });
});

describe("registration lifecycle machine", () => {
  const approve: RegistrationEvent = { type: "approve" };

  it("submit → approve is the happy path", () => {
    expect(registrationTransition("submitted", approve)).toEqual({ ok: true, next: "approved" });
  });

  it("a reject must carry a private reason category (invariant 6)", () => {
    expect(registrationTransition("submitted", { type: "reject", reason: "duplicate" })).toEqual({
      ok: true,
      next: "rejected",
    });
    expect(
      registrationTransition("submitted", { type: "reject", reason: "nonsense" as never }),
    ).toEqual({ ok: false, reason: "reason_required" });
  });

  it("waitlisted can still be approved or rejected", () => {
    expect(registrationTransition("waitlisted", approve)).toEqual({ ok: true, next: "approved" });
    expect(registrationTransition("waitlisted", { type: "reject", reason: "capacity" })).toEqual({
      ok: true,
      next: "rejected",
    });
  });

  it("approved is withdrawable pre-lock; rejected/withdrawn exit only via restore", () => {
    expect(registrationTransition("approved", { type: "withdraw" })).toEqual({
      ok: true,
      next: "withdrawn",
    });
    // restore is the ONLY legal exit from rejected/withdrawn (M-IP3-2 undo).
    expect(registrationTransition("rejected", { type: "restore" })).toEqual({
      ok: true,
      next: "submitted",
    });
    expect(registrationTransition("withdrawn", { type: "restore" })).toEqual({
      ok: true,
      next: "submitted",
    });
    for (const event of ["submit", "approve", "reject", "waitlist", "withdraw"] as const) {
      const evt = (
        event === "reject" ? { type: "reject", reason: "other" } : { type: event }
      ) as RegistrationEvent;
      expect(registrationTransition("rejected", evt).ok).toBe(false);
      expect(registrationTransition("withdrawn", evt).ok).toBe(false);
    }
  });

  it("cannot approve a draft or re-submit a submitted registration", () => {
    expect(registrationTransition("draft", approve)).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
    expect(registrationTransition("submitted", { type: "submit" })).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
  });

  it("every status is reachable only through a legal event", () => {
    const reachable = new Set<RegistrationStatus>(["draft"]);
    for (const from of REGISTRATION_STATUSES) {
      for (const type of ["submit", "approve", "reject", "waitlist", "withdraw"] as const) {
        const evt = (type === "reject" ? { type, reason: "other" } : { type }) as RegistrationEvent;
        const result = registrationTransition(from, evt);
        if (result.ok) {
          reachable.add(result.next);
        }
      }
    }
    // draft is only an initial state (no edge targets it) — everything else is reached.
    expect(reachable).toEqual(new Set(REGISTRATION_STATUSES));
  });
});

describe("validation helpers", () => {
  it("names must be ≥3 trimmed chars", () => {
    expect(validateName("  MPL 2026 ")).toEqual({ ok: true, value: "MPL 2026" });
    expect(validateName("ab")).toEqual({ ok: false, reason: "too_short" });
    expect(validateName("   ")).toEqual({ ok: false, reason: "too_short" });
  });

  it("slugify is url-safe and never empty", () => {
    expect(slugifyName("Malad Premier League!!")).toBe("malad-premier-league");
    expect(slugifyName("@#$")).toBe("competition");
  });

  it("season year is a plausible four-digit year", () => {
    expect(isValidSeasonYear(2026)).toBe(true);
    expect(isValidSeasonYear(1999)).toBe(false);
    expect(isValidSeasonYear(2026.5)).toBe(false);
  });

  it("role and reason guards fail closed on unknown values", () => {
    expect(isRegistrationRole("bowler")).toBe(true);
    expect(isRegistrationRole("striker")).toBe(false);
    expect(isRejectionReason("capacity")).toBe(true);
    expect(isRejectionReason("vibes")).toBe(false);
  });
});

describe("declared status sets are closed", () => {
  it("exposes the four competition statuses and six registration statuses", () => {
    expect(COMPETITION_STATUSES).toContain("registration_open");
    expect(REGISTRATION_STATUSES).toHaveLength(6);
  });
});
