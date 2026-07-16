import { describe, expect, it } from "vitest";

import { decideAmendProfile, decideDeclareProfile } from "./commands";
import { replayProfile } from "./profile";
import { envelope, envelopes } from "./testing";

const ORG = "01ORG00000000000000000000A";

function declared() {
  const decision = decideDeclareProfile(null, {
    orgId: ORG,
    legalName: "Gully Premier League Trust",
    posture: "none",
  });
  if (!decision.ok) {
    throw new Error(decision.reason);
  }
  return envelopes(decision.events);
}

function foldOk(events: ReturnType<typeof declared>) {
  const result = replayProfile(events);
  if (!result.ok) {
    throw new Error(`${result.reason}@${String(result.atSeq)}`);
  }
  return result.projection;
}

describe("TaxProfile aggregate", () => {
  it("declares, folds, and is deterministic (double fold, identical bytes)", () => {
    const events = declared();
    const first = foldOk(events);
    const second = foldOk(events);
    expect(first.legalName).toBe("Gully Premier League Trust");
    expect(first.posture).toBe("none");
    expect(first.version).toBe(1);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("rejects a second declaration (command AND replay, independently)", () => {
    const events = declared();
    const fold = foldOk(events);
    const decision = decideDeclareProfile(fold, {
      orgId: ORG,
      legalName: "Again",
      posture: "none",
    });
    expect(decision).toEqual({ ok: false, reason: "profile_exists" });
    // A forged second ProfileDeclared cannot fold either.
    const forged = [
      ...events,
      envelope("profile", ORG, 2, "ProfileDeclared", {
        orgId: ORG,
        legalName: "X",
        posture: "none",
      }),
    ];
    const replayed = replayProfile(forged);
    expect(replayed).toEqual({ ok: false, atSeq: 2, reason: "illegal_replayed_transition" });
  });

  it("requires a well-shaped GSTIN for gst-registered and forbids one for none", () => {
    expect(
      decideDeclareProfile(null, { orgId: ORG, legalName: "T", posture: "gst-registered" }),
    ).toEqual({ ok: false, reason: "gstin_invalid" });
    expect(
      decideDeclareProfile(null, {
        orgId: ORG,
        legalName: "T",
        posture: "gst-registered",
        gstin: "not-a-gstin",
      }),
    ).toEqual({ ok: false, reason: "gstin_invalid" });
    expect(
      decideDeclareProfile(null, {
        orgId: ORG,
        legalName: "T",
        posture: "none",
        gstin: "27AAPFU0939F1ZV",
      }),
    ).toEqual({ ok: false, reason: "gstin_forbidden_without_registration" });
    const ok = decideDeclareProfile(null, {
      orgId: ORG,
      legalName: "T",
      posture: "gst-registered",
      gstin: "27AAPFU0939F1ZV",
    });
    expect(ok.ok).toBe(true);
  });

  it("amends with a mandatory reason; version advances; amendment validates the RESULT", () => {
    const events = declared();
    const fold = foldOk(events);
    expect(decideAmendProfile(fold, { reason: " " })).toEqual({
      ok: false,
      reason: "reason_required",
    });
    // Turning registered without a GSTIN is invalid as a RESULT, not just as input.
    expect(decideAmendProfile(fold, { reason: "register", posture: "gst-registered" })).toEqual({
      ok: false,
      reason: "gstin_invalid",
    });
    const amended = decideAmendProfile(fold, {
      reason: "register",
      posture: "gst-registered",
      gstin: "27AAPFU0939F1ZV",
    });
    if (!amended.ok) {
      throw new Error(amended.reason);
    }
    const next = foldOk([...events, ...envelopes(amended.events, { startSeq: 2 })]);
    expect(next.posture).toBe("gst-registered");
    expect(next.gstin).toBe("27AAPFU0939F1ZV");
    expect(next.version).toBe(2);
  });

  it("fails closed: gap, unknown type, malformed amendment, wrong genesis", () => {
    const events = declared();
    expect(
      replayProfile([
        ...events,
        envelope("profile", ORG, 3, "ProfileAmended", { reason: "x", legalName: "Y" }),
      ]),
    ).toEqual({ ok: false, atSeq: 3, reason: "sequence_gap" });
    expect(replayProfile([...events, envelope("profile", ORG, 2, "ProfileForged", {})])).toEqual({
      ok: false,
      atSeq: 2,
      reason: "unknown_event_type",
    });
    expect(
      replayProfile([...events, envelope("profile", ORG, 2, "ProfileAmended", { legalName: "Y" })]),
    ).toEqual({ ok: false, atSeq: 2, reason: "malformed_profile" });
    expect(replayProfile([envelope("profile", ORG, 1, "ProfileAmended", { reason: "x" })])).toEqual(
      { ok: false, atSeq: 1, reason: "unknown_profile" },
    );
    expect(replayProfile([])).toEqual({ ok: false, atSeq: 0, reason: "unknown_profile" });
  });

  it("fails closed on a stream-id mismatch (a profile forged into another org's lane)", () => {
    const forged = envelope("profile", ORG, 1, "ProfileDeclared", {
      orgId: "01ORG00000000000000000000B",
      legalName: "T",
      posture: "none",
      autoReceipt: false,
    });
    expect(replayProfile([forged])).toEqual({ ok: false, atSeq: 1, reason: "malformed_profile" });
  });

  it("counts recoveries without changing declared facts", () => {
    const events = declared();
    const recovered = foldOk([
      ...events,
      envelope("profile", ORG, 2, "ProfileRecovered", { divergences: 1, eventCount: 1 }),
    ]);
    expect(recovered.recoveries).toBe(1);
    expect(recovered.legalName).toBe("Gully Premier League Trust");
  });
});
