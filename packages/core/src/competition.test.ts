import { describe, expect, it } from "vitest";

import {
  COMPETITION_STATUSES,
  REJECTION_NOTE_LIMIT,
  REGISTRATION_STATUSES,
  competitionTransition,
  isRejectionReason,
  isValidSeasonYear,
  nextSeasonName,
  registrationTransition,
  rejectionEvent,
  slugifyName,
  validateName,
  type RegistrationEvent,
  type RegistrationStatus,
} from "./competition";
import { CRICKET, isRoleIn } from "./sports";

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

  /*
   * "OTHER" WITHOUT A NOTE RECORDS NOTHING, and for a long time that was
   * exactly what it did: `note?` was declared here, the aggregate stored it,
   * the column existed — and no caller ever supplied one, so a decline for
   * `other` said only that none of the four categories fitted. Doc 42 spells
   * the list as "duplicate, ineligible, withdrew, capacity, other+note".
   */
  describe("rejectionEvent — the note that makes 'other' mean something", () => {
    it("demands a note for 'other' and not for the four that speak for themselves", () => {
      expect(rejectionEvent("other")).toEqual({
        ok: false,
        error: expect.stringContaining("records nothing") as string,
      });
      expect(rejectionEvent("other", "   ")).toEqual({
        ok: false,
        error: expect.stringContaining("records nothing") as string,
      });
      expect(rejectionEvent("other", "played for a rival club last season")).toEqual({
        ok: true,
        event: { type: "reject", reason: "other", note: "played for a rival club last season" },
      });
      for (const reason of ["duplicate", "ineligible", "withdrew", "capacity"]) {
        expect(rejectionEvent(reason)).toEqual({ ok: true, event: { type: "reject", reason } });
      }
    });

    it("keeps a note on the four optional categories when one is given", () => {
      expect(rejectionEvent("capacity", "  waitlist was already 40 deep  ")).toEqual({
        ok: true,
        event: { type: "reject", reason: "capacity", note: "waitlist was already 40 deep" },
      });
    });

    it("omits the key entirely rather than storing an empty note", () => {
      // `note: ""` and no note are different things to every reader downstream:
      // one says "the organizer wrote nothing", the other says "they wrote
      // nothing down here". Only the second is true, and the column is nullable
      // so that it can say so.
      const built = rejectionEvent("capacity", "   ");
      expect(built.ok && "note" in built.event).toBe(false);
    });

    it("caps the note rather than letting the column refuse the whole decision", () => {
      const built = rejectionEvent("other", "x".repeat(REJECTION_NOTE_LIMIT + 500));
      expect(built.ok).toBe(true);
      expect(built.ok && "note" in built.event && built.event.note.length).toBe(
        REJECTION_NOTE_LIMIT,
      );
    });

    it("still refuses a category that is not one of the five", () => {
      expect(rejectionEvent("nonsense", "with a note")).toEqual({
        ok: false,
        error: "Choose a reason to reject.",
      });
    });
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
    expect(isRoleIn(CRICKET, "bowler")).toBe(true);
    expect(isRoleIn(CRICKET, "striker")).toBe(false);
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

describe("nextSeasonName (clone / run-it-again)", () => {
  it("bumps a trailing season year", () => {
    expect(nextSeasonName("Sunday Premier League 2026")).toBe("Sunday Premier League 2027");
    expect(nextSeasonName("MPL 2019")).toBe("MPL 2020");
    expect(nextSeasonName("Cup 2099")).toBe("Cup 2100");
  });

  it("appends (Copy) when there is no trailing year", () => {
    expect(nextSeasonName("Spring Cup")).toBe("Spring Cup (Copy)");
    // A leading/embedded year is not a season suffix — do not touch it.
    expect(nextSeasonName("2020 Memorial Trophy")).toBe("2020 Memorial Trophy (Copy)");
    // A trailing non-year number is not a season — leave it.
    expect(nextSeasonName("Ground 1234")).toBe("Ground 1234 (Copy)");
  });

  it("trims and degrades a blank name", () => {
    expect(nextSeasonName("  Night League 2025  ")).toBe("Night League 2026");
    expect(nextSeasonName("   ")).toBe("Competition (Copy)");
  });
});
