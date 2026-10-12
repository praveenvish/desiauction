import { describe, expect, it } from "vitest";
import { confirmationTaskState } from "./confirmation-task-state";
import type { TrustEvidence } from "./trust-ledger";
const revision = { attempt: 1, lastSeq: 10 };
function row(order: number, action: string, extra: Record<string, unknown> = {}): TrustEvidence {
  return {
    id: String(order),
    actor: "other-manager",
    at: new Date(0),
    action,
    meta: { ...revision, trustOrder: order, ...extra },
  };
}
const confirmed = (order: number, teamId = "away") =>
  row(order, "match.trust.confirmation", { teamId, verdict: "confirmed" });
describe("Home confirmation completion, independent of link validity", () => {
  it("another manager for the same team fulfils the request, another team does not", () => {
    expect(confirmationTaskState([confirmed(1)], revision, "away")).toBe("completed");
    expect(confirmationTaskState([confirmed(1, "home")], revision, "away")).toBe("ready");
  });
  it("uses explicit order through clock ties and later confirmations cannot erase disputes", () => {
    const disputed = row(2, "match.trust.confirmation", { teamId: "away", verdict: "disputed" });
    const evidence = [confirmed(3), confirmed(1), disputed];
    expect(confirmationTaskState(evidence, revision, "away")).toBe("waiting");
    const verified = row(4, "match.trust.organizer_verified");
    expect(confirmationTaskState([...evidence, verified], revision, "away")).toBe("resolved");
    expect(
      confirmationTaskState(
        [...evidence, verified, { ...disputed, meta: { ...disputed.meta, trustOrder: 5 } }],
        revision,
        "away",
      ),
    ).toBe("waiting");
  });
  it("a foreign team's dispute does not fulfil this team's request", () => {
    expect(
      confirmationTaskState(
        [row(1, "match.trust.confirmation", { teamId: "home", verdict: "disputed" })],
        revision,
        "away",
      ),
    ).toBe("ready");
  });
  it("ignores stale revisions and unordered responses; current authorised review can resolve without a response", () => {
    expect(
      confirmationTaskState(
        [
          { ...confirmed(1), meta: { teamId: "away", verdict: "confirmed" } },
          { ...confirmed(2), meta: { ...confirmed(2).meta, lastSeq: 9 } },
        ],
        revision,
        "away",
      ),
    ).toBe("ready");
    expect(
      confirmationTaskState([row(3, "match.trust.organizer_verified")], revision, "away"),
    ).toBe("resolved");
    expect(
      confirmationTaskState(
        [
          confirmed(1),
          row(2, "match.trust.platform_excluded"),
          row(3, "match.trust.organizer_verified"),
        ],
        revision,
        "away",
      ),
    ).toBe("waiting");
    expect(
      confirmationTaskState([confirmed(1), row(2, "match.trust.kept_flagged")], revision, "away"),
    ).toBe("waiting");
  });
});
