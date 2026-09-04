import { describe, expect, it } from "vitest";

import { paise } from "./money";
import type { Paise } from "./money";
import {
  evaluatePlan,
  fallbackWouldCycle,
  ladderFloor,
  validateTargetMax,
  whatIf,
} from "./team-plan";
import type { PlanInput, PlanLot, PlanTarget } from "./team-plan";

/**
 * THE PLAN IS ARITHMETIC THE OWNER CAN CHECK (WR-1).
 *
 * Every state here is one inequality over numbers already on the owner's
 * screen. These tests pin each inequality at its boundary, prove the engine's
 * own ceiling always wins over the plan, and prove the fold never touches the
 * owner's max — it lists what could be shed; it never decides.
 */

const L = (n: number): Paise => paise(n * 100_000); // ₹1,000 units, in paise

const rules = {
  pursePerTeam: L(100),
  squadMin: 3,
  squadMax: 5,
  minPossiblePrice: L(1),
  slabs: [
    { upTo: L(10), step: L(1) },
    { upTo: null, step: L(2) },
  ],
} as const;

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

function target(over: Partial<PlanTarget> & { registrationId: string }): PlanTarget {
  return { maxBid: null, priority: 3, fallbackRegistrationId: null, ...over };
}

function input(over: Partial<PlanInput>): PlanInput {
  return {
    targets: [],
    lots: [],
    myTeamId: "me",
    purseRemaining: L(100),
    squadSize: 0,
    rules,
    currentLot: null,
    ...over,
  };
}

describe("exposure and headroom", () => {
  it("sums open targets at their max, and counts an uncapped target at base", () => {
    const state = evaluatePlan(
      input({
        targets: [target({ registrationId: "a", maxBid: L(15) }), target({ registrationId: "b" })],
        lots: [lot({ registrationId: "a" }), lot({ registrationId: "b", basePrice: L(2) })],
      }),
    );
    expect(state.budget.plannedExposure).toBe(L(17));
    expect(state.budget.headroom).toBe(L(83));
    expect(state.targets[1]?.countedAtBase).toBe(true);
    expect(state.targets[1]?.plannedAmount).toBe(L(2));
  });

  it("drops a target from exposure once it is won, and once it is lost", () => {
    const won = evaluatePlan(
      input({
        targets: [target({ registrationId: "a", maxBid: L(15) })],
        lots: [lot({ registrationId: "a", status: "sold", soldToTeamId: "me", soldPrice: L(16) })],
        purseRemaining: L(84),
      }),
    );
    expect(won.targets[0]?.outcome).toBe("won");
    expect(won.targets[0]?.paidAmount).toBe(L(16));
    expect(won.budget.plannedExposure).toBe(0);

    const lost = evaluatePlan(
      input({
        targets: [target({ registrationId: "a", maxBid: L(15) })],
        lots: [
          lot({ registrationId: "a", status: "sold", soldToTeamId: "rival", soldPrice: L(16) }),
        ],
      }),
    );
    expect(lost.targets[0]?.outcome).toBe("lost");
    expect(lost.budget.plannedExposure).toBe(0);
  });

  it("treats a withdrawn lot and a player with no lot as unavailable", () => {
    const state = evaluatePlan(
      input({
        targets: [target({ registrationId: "a" }), target({ registrationId: "icon" })],
        lots: [lot({ registrationId: "a", status: "withdrawn" })],
      }),
    );
    expect(state.targets.map((t) => t.outcome)).toEqual(["unavailable", "unavailable"]);
    expect(state.budget.openTargets).toBe(0);
  });
});

describe("fit: the engine's reserve rule applied to the plan", () => {
  // squadMin 3, no squad yet, one open target → 2 slots after plan → reserve ₹2,000.
  const one = (purse: number) =>
    evaluatePlan(
      input({
        targets: [target({ registrationId: "a", maxBid: L(10) })],
        lots: [lot({ registrationId: "a" })],
        purseRemaining: L(purse),
      }),
    );

  it("fits when headroom covers the reserve exactly", () => {
    const state = one(12);
    expect(state.budget.slotsAfterPlan).toBe(2);
    expect(state.budget.reserveAfterPlan).toBe(L(2));
    expect(state.budget.headroom).toBe(L(2));
    expect(state.budget.fit).toBe("fits");
    expect(state.budget.shortfall).toBe(0);
    expect(state.suggestions).toEqual([]);
  });

  it("is at risk one paisa under the reserve, with the shortfall stated", () => {
    const state = evaluatePlan(
      input({
        targets: [target({ registrationId: "a", maxBid: L(10) })],
        lots: [lot({ registrationId: "a" })],
        purseRemaining: paise(L(12) - 1),
      }),
    );
    expect(state.budget.fit).toBe("at_risk");
    expect(state.budget.shortfall).toBe(1);
  });

  it("does not fit when exposure exceeds purse, and says how much to recover", () => {
    const state = one(8);
    expect(state.budget.fit).toBe("does_not_fit");
    expect(state.budget.headroom).toBe(0 - L(2));
    expect(state.budget.shortfall).toBe(L(2));
  });

  it("flags more open targets than squad slots", () => {
    const targets = ["a", "b", "c", "d", "e", "f"].map((id) => target({ registrationId: id }));
    const state = evaluatePlan(
      input({ targets, lots: targets.map((t) => lot({ registrationId: t.registrationId })) }),
    );
    expect(state.budget.excessTargets).toBe(1);
    expect(state.suggestions).toContainEqual({ kind: "over_slots", excess: 1 });
  });
});

describe("the lot on the block", () => {
  const onBlock = (
    over: Partial<PlanInput>,
    next: number,
    leadingIsMine = false,
    leading?: number,
  ) =>
    evaluatePlan(
      input({
        targets: [target({ registrationId: "a", maxBid: L(15) })],
        lots: [lot({ registrationId: "a", status: "on_block" })],
        currentLot: {
          lotId: "lot-a",
          nextMinimumBid: L(next),
          leadingAmount: leading === undefined ? null : L(leading),
          leadingIsMine,
        },
        ...over,
      }),
    ).currentLot;

  it("says nothing when the lot is not a target", () => {
    const advice = evaluatePlan(
      input({
        lots: [lot({ registrationId: "z", status: "on_block" })],
        currentLot: {
          lotId: "lot-z",
          nextMinimumBid: L(1),
          leadingAmount: null,
          leadingIsMine: false,
        },
      }),
    ).currentLot;
    expect(advice?.verdict).toBe("not_a_target");
    expect(advice?.target).toBeNull();
  });

  it("is within plan below the max and at the max, over it one rung above", () => {
    expect(onBlock({}, 14)?.verdict).toBe("within_plan");
    expect(onBlock({}, 15)?.verdict).toBe("within_plan");
    const over = onBlock({}, 16);
    expect(over?.verdict).toBe("over_max");
    expect(over?.overBy).toBe(L(1));
  });

  it("reports leading, and by how much my own bid passed my max", () => {
    expect(onBlock({}, 16, true, 14)?.verdict).toBe("leading");
    expect(onBlock({}, 16, true, 14)?.leadingOverBy).toBeNull();
    expect(onBlock({}, 18, true, 16)?.leadingOverBy).toBe(L(1));
  });

  it("lets the engine's ceiling win over the plan", () => {
    // purse ₹20,000, squadMin 3, squad 0 → reserve 2 × ₹1,000 → affordable ₹18,000.
    const purse = onBlock({ purseRemaining: L(20) }, 19);
    expect(purse?.maxAffordable).toBe(L(18));
    expect(purse?.verdict).toBe("engine_ceiling");
    expect(purse?.ceilingReason).toBe("purse");

    const full = onBlock({ squadSize: 5 }, 2);
    expect(full?.verdict).toBe("engine_ceiling");
    expect(full?.ceilingReason).toBe("squad_full");
  });

  it("names a target with no max as such", () => {
    const advice = evaluatePlan(
      input({
        targets: [target({ registrationId: "a" })],
        lots: [lot({ registrationId: "a", status: "on_block" })],
        currentLot: {
          lotId: "lot-a",
          nextMinimumBid: L(3),
          leadingAmount: null,
          leadingIsMine: false,
        },
      }),
    ).currentLot;
    expect(advice?.verdict).toBe("target_no_max");
  });

  it("states the consequence of winning at the next bid", () => {
    const state = evaluatePlan(
      input({
        targets: [
          target({ registrationId: "a", maxBid: L(15) }),
          target({ registrationId: "b", maxBid: L(30) }),
        ],
        lots: [lot({ registrationId: "a", status: "on_block" }), lot({ registrationId: "b" })],
        purseRemaining: L(50),
        currentLot: {
          lotId: "lot-a",
          nextMinimumBid: L(16),
          leadingAmount: null,
          leadingIsMine: false,
        },
      }),
    );
    const ifWon = state.currentLot?.ifWon;
    expect(ifWon?.amount).toBe(L(16));
    expect(ifWon?.purseAfter).toBe(L(34));
    expect(ifWon?.plannedExposureAfter).toBe(L(30));
    expect(ifWon?.headroomAfter).toBe(L(4));
    // squad 1, one open target → 1 slot → reserve ₹1,000 → fits.
    expect(ifWon?.fitAfter).toBe("fits");
  });
});

describe("backups", () => {
  it("follows the chain to the first open player, skipping a sold backup", () => {
    const state = evaluatePlan(
      input({
        targets: [
          target({ registrationId: "a", fallbackRegistrationId: "b" }),
          target({ registrationId: "b", fallbackRegistrationId: "c" }),
          target({ registrationId: "c" }),
        ],
        lots: [
          lot({ registrationId: "a", status: "sold", soldToTeamId: "rival", soldPrice: L(9) }),
          lot({ registrationId: "b", status: "sold", soldToTeamId: "rival", soldPrice: L(9) }),
          lot({ registrationId: "c" }),
        ],
      }),
    );
    expect(state.targets[0]?.effectiveBackup).toBe("c");
    expect(state.targets[1]?.effectiveBackup).toBe("c");
    expect(state.suggestions).toContainEqual({
      kind: "backup",
      lostRegistrationId: "a",
      nextRegistrationId: "c",
    });
  });

  it("accepts a backup who is not a target, while their lot is open", () => {
    const state = evaluatePlan(
      input({
        targets: [target({ registrationId: "a", fallbackRegistrationId: "x" })],
        lots: [
          lot({ registrationId: "a", status: "sold", soldToTeamId: "rival", soldPrice: L(9) }),
          lot({ registrationId: "x" }),
        ],
      }),
    );
    expect(state.targets[0]?.effectiveBackup).toBe("x");
  });

  it("terminates on a cycle and yields nothing when every backup is gone", () => {
    const sold = (id: string) =>
      lot({ registrationId: id, status: "sold", soldToTeamId: "rival", soldPrice: L(9) });
    const state = evaluatePlan(
      input({
        targets: [
          target({ registrationId: "a", fallbackRegistrationId: "b" }),
          target({ registrationId: "b", fallbackRegistrationId: "a" }),
        ],
        lots: [sold("a"), sold("b")],
      }),
    );
    expect(state.targets.map((t) => t.effectiveBackup)).toEqual([null, null]);
    expect(state.suggestions.filter((s) => s.kind === "backup")).toEqual([]);
  });

  it("does not surface a backup for a target that is still open or already won", () => {
    const state = evaluatePlan(
      input({
        targets: [
          target({ registrationId: "a", fallbackRegistrationId: "b" }),
          target({ registrationId: "b" }),
        ],
        lots: [lot({ registrationId: "a" }), lot({ registrationId: "b" })],
      }),
    );
    expect(state.targets[0]?.effectiveBackup).toBeNull();
  });
});

describe("suggestions never touch the max", () => {
  it("lists what to shed lowest priority first, dearest first, until covered", () => {
    const state = evaluatePlan(
      input({
        targets: [
          target({ registrationId: "must", maxBid: L(30), priority: 1 }),
          target({ registrationId: "high", maxBid: L(20), priority: 2 }),
          target({ registrationId: "t-cheap", maxBid: L(5), priority: 3 }),
          target({ registrationId: "t-dear", maxBid: L(12), priority: 3 }),
        ],
        lots: ["must", "high", "t-cheap", "t-dear"].map((id) => lot({ registrationId: id })),
        purseRemaining: L(50),
      }),
    );
    // exposure 67 vs purse 50 → recover 17: t-dear (12) then t-cheap (5) covers it.
    expect(state.budget.fit).toBe("does_not_fit");
    const recover = state.suggestions.find((s) => s.kind === "recover");
    expect(recover?.kind === "recover" && recover.amount).toBe(L(17));
    expect(recover?.kind === "recover" && recover.candidates.map((c) => c.registrationId)).toEqual([
      "t-dear",
      "t-cheap",
    ]);
    // The owner's numbers are untouched.
    expect(state.targets.map((t) => t.maxBid)).toEqual([L(30), L(20), L(5), L(12)]);
  });

  it("flags a target planned above what the engine would let me bid right now", () => {
    const state = evaluatePlan(
      input({
        targets: [target({ registrationId: "a", maxBid: L(19) })],
        lots: [lot({ registrationId: "a" })],
        purseRemaining: L(20),
      }),
    );
    expect(state.suggestions).toContainEqual({
      kind: "unaffordable",
      registrationId: "a",
      plannedAmount: L(19),
      maxAffordable: L(18),
    });
  });

  it("is deterministic: the same input folds to the same bytes", () => {
    const build = () =>
      evaluatePlan(
        input({
          targets: [
            target({ registrationId: "b", maxBid: L(9) }),
            target({ registrationId: "a", fallbackRegistrationId: "b" }),
          ],
          lots: [lot({ registrationId: "a", status: "withdrawn" }), lot({ registrationId: "b" })],
          purseRemaining: L(5),
        }),
      );
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});

describe("ladder floor", () => {
  it("returns the max itself when it sits on a rung", () => {
    expect(ladderFloor(L(1), rules.slabs, L(7))).toBe(L(7));
    expect(ladderFloor(L(1), rules.slabs, L(12))).toBe(L(12));
  });

  it("drops to the last rung under an off-ladder max, across the slab boundary", () => {
    // Rungs: 1,2,…,10 then 12,14,… → 11 is not a rung; floor is 10.
    expect(ladderFloor(L(1), rules.slabs, L(11))).toBe(L(10));
    expect(ladderFloor(L(1), rules.slabs, paise(L(13) + 1))).toBe(L(12));
  });

  it("is null below base", () => {
    expect(ladderFloor(L(2), rules.slabs, L(1))).toBeNull();
  });

  it("reports the floor on the target when the max is off the ladder", () => {
    const state = evaluatePlan(
      input({
        targets: [target({ registrationId: "a", maxBid: L(11) })],
        lots: [lot({ registrationId: "a" })],
      }),
    );
    expect(state.targets[0]?.ladderFloor).toBe(L(10));
  });
});

describe("validation", () => {
  const ctx = { basePrice: L(2), pursePerTeam: L(100) };

  it("accepts no max, and a whole positive amount between base and purse", () => {
    expect(validateTargetMax(null, ctx)).toEqual({ ok: true, maxBid: null });
    expect(validateTargetMax(L(2), ctx)).toEqual({ ok: true, maxBid: L(2) });
    expect(validateTargetMax(L(100), ctx)).toEqual({ ok: true, maxBid: L(100) });
  });

  it("refuses zero, negatives, fractions, below base and above purse", () => {
    expect(validateTargetMax(0, ctx)).toEqual({ ok: false, reason: "invalid" });
    expect(validateTargetMax(-5, ctx)).toEqual({ ok: false, reason: "invalid" });
    expect(validateTargetMax(1.5, ctx)).toEqual({ ok: false, reason: "invalid" });
    expect(validateTargetMax(L(2) - 1, ctx)).toEqual({ ok: false, reason: "below_base" });
    expect(validateTargetMax(L(100) + 1, ctx)).toEqual({ ok: false, reason: "above_purse" });
  });

  it("refuses a fallback that would loop back, including on itself", () => {
    const targets = [
      target({ registrationId: "a", fallbackRegistrationId: "b" }),
      target({ registrationId: "b", fallbackRegistrationId: "c" }),
      target({ registrationId: "c" }),
    ];
    expect(fallbackWouldCycle(targets, "c", "a")).toBe(true);
    expect(fallbackWouldCycle(targets, "a", "a")).toBe(true);
    expect(fallbackWouldCycle(targets, "c", "z")).toBe(false);
    expect(fallbackWouldCycle(targets, "a", null)).toBe(false);
  });
});

describe("what if", () => {
  it("answers for a target and for a player outside the plan with the same arithmetic", () => {
    const base = input({
      targets: [target({ registrationId: "a", maxBid: L(15) })],
      lots: [lot({ registrationId: "a" }), lot({ registrationId: "z" })],
      purseRemaining: L(50),
    });
    const onTarget = whatIf(base, "a", L(12));
    expect(onTarget.purseAfter).toBe(L(38));
    expect(onTarget.plannedExposureAfter).toBe(0);

    const outside = whatIf(base, "z", L(12));
    expect(outside.purseAfter).toBe(L(38));
    expect(outside.plannedExposureAfter).toBe(L(15));
    expect(outside.headroomAfter).toBe(L(23));
  });
});
