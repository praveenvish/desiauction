import { describe, expect, it } from "vitest";
import type { MatchEvent } from "@desiauction/core/scoring";
import { effectiveTrustDecisions, historicalAuthority, type TrustEvidence } from "./trust-ledger";
function event(seq: number, actorPersonId = "scorer"): MatchEvent<"finish"> {
  return {
    eventId: `event-${String(seq)}`,
    seq,
    attempt: 1,
    type: "finish",
    v: 1,
    payload: {},
    targetEventId: null,
    actorPersonId,
    clientSeq: seq,
    clientRecordedAt: "2026-10-10T00:00:00Z",
  };
}
function evidence(
  order: number,
  action: string,
  meta: Record<string, unknown>,
  actor = "scorer",
): TrustEvidence {
  return {
    id: `row-${String(order)}`,
    actor,
    action,
    at: new Date("2026-10-10T00:00:00Z"),
    meta: { ...meta, trustOrder: order },
  };
}
function authority(order: number, arm: string, accepted: MatchEvent[], teams: string[] = []) {
  return evidence(
    order,
    "match.trust.scoring_authority",
    {
      authority: arm,
      events: accepted.map(({ eventId, seq, attempt }) => ({ eventId, seq, attempt })),
      representedTeamIds: teams,
    },
    accepted[0]?.actorPersonId,
  );
}
describe("C38 authoritative trust ledger", () => {
  it("cannot launder manager work through an elevated finisher", () => {
    const manager = event(1),
      finish = event(2, "organizer");
    const result = historicalAuthority(
      [authority(1, "d", [manager], ["home"]), authority(2, "a", [finish])],
      [manager, finish],
    );
    expect(result.complete).toBe(true);
    expect(result.authority).toEqual({ a: false, b: false, c: false, d: true });
    expect(result.representedTeamId).toBe("home");
  });
  it("requires complete matching historical actor and event coverage", () => {
    const accepted = event(1);
    expect(historicalAuthority([], [accepted]).authority.a).toBe(false);
    const wrong = authority(1, "a", [accepted]);
    wrong.actor = "other";
    expect(historicalAuthority([wrong], [accepted]).complete).toBe(false);
    expect(historicalAuthority([authority(1, "a", [accepted])], [accepted]).authority.a).toBe(true);
  });
  it("does not guess an opposing side from mixed or unknown manager provenance", () => {
    const a = event(1),
      b = event(2);
    expect(
      historicalAuthority(
        [authority(1, "d", [a], ["home"]), authority(2, "d", [b], ["away"])],
        [a, b],
      ).representedTeamId,
    ).toBeNull();
    expect(historicalAuthority([authority(1, "d", [a])], [a]).representedTeamId).toBeNull();
  });
  it("orders dispute and verification explicitly and keeps platform exclusion across revisions", () => {
    const revision = { attempt: 1, lastSeq: 20 };
    const dispute = evidence(1, "match.trust.confirmation", { ...revision, verdict: "disputed" });
    const verify = evidence(2, "match.trust.organizer_verified", revision);
    expect(effectiveTrustDecisions([verify, dispute], revision).organiserVerified).toBe(true);
    const later = evidence(3, "match.trust.confirmation", { ...revision, verdict: "disputed" });
    expect(effectiveTrustDecisions([later, verify, dispute], revision).organiserVerified).toBe(
      false,
    );
    const hold = evidence(4, "match.trust.platform_excluded", revision);
    expect(
      effectiveTrustDecisions([hold, verify], { attempt: 2, lastSeq: 30 }).platformExcluded,
    ).toBe(true);
    expect(
      effectiveTrustDecisions(
        [hold, evidence(5, "match.trust.organizer_verified", revision)],
        revision,
      ).platformExcluded,
    ).toBe(true);
    expect(
      effectiveTrustDecisions(
        [hold, evidence(5, "match.trust.platform_verified", revision)],
        revision,
      ).platformExcluded,
    ).toBe(false);
    expect(effectiveTrustDecisions([verify], { attempt: 1, lastSeq: 21 }).organiserVerified).toBe(
      false,
    );
  });
});
