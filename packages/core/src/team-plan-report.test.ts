import { describe, expect, it } from "vitest";

import { paise } from "./money";
import type { PlanLot } from "./team-plan";
import { planVersusActual } from "./team-plan-report";
import type { PlanRevisionLike, PlanSaleLike } from "./team-plan-report";

/**
 * THE PLAN AS IT STOOD WHEN THE HAMMER FELL (WR-1, Phase 1.5).
 *
 * The report judges each player by the last revision at or before their sale,
 * never by the plan's final shape. These pin that rule at its edges: a max
 * raised after the sale, a target dropped before it, one added after it, a lot
 * reopened and resold, and a win the plan never named.
 */
const L = (n: number) => paise(n * 100_000);

function lot(over: Partial<PlanLot> & { registrationId: string }): PlanLot {
  return {
    lotId: `lot-${over.registrationId}`,
    status: "queued",
    basePrice: L(1),
    soldToTeamId: null,
    soldPrice: null,
    ...over,
  };
}

function rev(
  over: Partial<PlanRevisionLike> & { registrationId: string; atMs: number },
): PlanRevisionLike {
  return {
    targetId: `t-${over.registrationId}`,
    kind: "added",
    maxBid: null,
    priority: 3,
    ...over,
  };
}

const sale = (lotId: string, atMs: number, seq = 1): PlanSaleLike => ({ lotId, atMs, seq });

describe("planVersusActual", () => {
  it("judges a target by the max that stood at the sale, not the one set afterwards", () => {
    const report = planVersusActual({
      myTeamId: "me",
      lots: [lot({ registrationId: "a", status: "sold", soldToTeamId: "me", soldPrice: L(16) })],
      sales: [sale("lot-a", 1_000)],
      revisions: [
        rev({ registrationId: "a", atMs: 100, maxBid: L(15), priority: 1 }),
        // Raised after the hammer: does not change what the night was.
        rev({ registrationId: "a", atMs: 5_000, kind: "updated", maxBid: L(20), priority: 1 }),
      ],
    });
    expect(report.rows).toEqual([
      {
        registrationId: "a",
        lotId: "lot-a",
        priority: 1,
        maxBid: L(15),
        outcome: "won",
        paid: L(16),
        overBy: L(1),
      },
    ]);
    expect(report.signed).toBe(1);
    expect(report.overMaxCount).toBe(1);
    expect(report.overMaxTotal).toBe(L(1));
    expect(report.plannedTotal).toBe(L(15));
    expect(report.paidForTargets).toBe(L(16));
  });

  it("leaves out a target removed before the hammer, and one added after it", () => {
    const report = planVersusActual({
      myTeamId: "me",
      lots: [
        lot({ registrationId: "dropped", status: "sold", soldToTeamId: "rival", soldPrice: L(9) }),
        lot({ registrationId: "late", status: "sold", soldToTeamId: "me", soldPrice: L(4) }),
      ],
      sales: [sale("lot-dropped", 1_000), sale("lot-late", 2_000)],
      revisions: [
        rev({ registrationId: "dropped", atMs: 100, maxBid: L(10) }),
        rev({ registrationId: "dropped", atMs: 500, kind: "removed", maxBid: L(10) }),
        rev({ registrationId: "late", atMs: 3_000, maxBid: L(5) }),
      ],
    });
    expect(report.rows).toEqual([]);
    // The late one was still a win — just not a planned one.
    expect(report.outsidePlan).toEqual([{ registrationId: "late", lotId: "lot-late", paid: L(4) }]);
    expect(report.outsidePlanTotal).toBe(L(4));
  });

  it("counts lost, unsold and never-reached targets, and a lot resold after an undo", () => {
    const report = planVersusActual({
      myTeamId: "me",
      lots: [
        lot({ registrationId: "lost", status: "sold", soldToTeamId: "rival", soldPrice: L(12) }),
        lot({ registrationId: "unsold", status: "unsold" }),
        lot({ registrationId: "never", status: "queued" }),
        lot({ registrationId: "resold", status: "sold", soldToTeamId: "me", soldPrice: L(8) }),
      ],
      sales: [
        sale("lot-lost", 1_000),
        // First sale undone, resold later: the later sale stands, and the max
        // raised between the two counts.
        sale("lot-resold", 2_000, 5),
        sale("lot-resold", 4_000, 9),
      ],
      revisions: [
        rev({ registrationId: "lost", atMs: 100, maxBid: L(10), priority: 2 }),
        rev({ registrationId: "unsold", atMs: 100 }),
        rev({ registrationId: "never", atMs: 100, maxBid: L(3) }),
        rev({ registrationId: "resold", atMs: 100, maxBid: L(6) }),
        rev({ registrationId: "resold", atMs: 3_000, kind: "updated", maxBid: L(9) }),
      ],
    });
    const byId = new Map(report.rows.map((row) => [row.registrationId, row]));
    expect(byId.get("lost")).toMatchObject({ outcome: "lost", paid: L(12), overBy: null });
    expect(byId.get("unsold")).toMatchObject({ outcome: "unsold", paid: null, maxBid: null });
    expect(byId.get("never")).toMatchObject({ outcome: "open", maxBid: L(3) });
    expect(byId.get("resold")).toMatchObject({
      outcome: "won",
      maxBid: L(9),
      paid: L(8),
      overBy: null,
    });
    expect(report.targets).toBe(4);
    expect(report.signed).toBe(1);
    expect(report.lost).toBe(1);
    expect(report.undecided).toBe(2);
    expect(report.plannedTotal).toBe(L(22));
    expect(report.overMaxCount).toBe(0);
  });

  it("is deterministic in row order regardless of revision order", () => {
    const revisions = [
      rev({ registrationId: "b", atMs: 200 }),
      rev({ registrationId: "a", atMs: 100 }),
    ];
    const input = {
      myTeamId: "me",
      lots: [lot({ registrationId: "a" }), lot({ registrationId: "b" })],
      sales: [],
    };
    const one = planVersusActual({ ...input, revisions });
    const two = planVersusActual({ ...input, revisions: [...revisions].reverse() });
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
    expect(one.rows.map((row) => row.registrationId)).toEqual(["a", "b"]);
  });
});
