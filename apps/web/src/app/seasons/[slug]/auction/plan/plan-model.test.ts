import { paise, sportPackFor } from "@desiauction/core";
import type { TargetState } from "@desiauction/core";
import { describe, expect, it } from "vitest";

import type { PlanLotRow } from "../../../../../server/auction/owner-plan";
import { groupByPriority, roleFacts, rupeesFromPaise, searchPool } from "./plan-model";

/** This suite's fixtures are cricket, so the season's roles are cricket's. */
const CRICKET_ROLES = sportPackFor("cricket").roles.values.map((value) => value.key);

function lot(over: Partial<PlanLotRow> & { registrationId: string }): PlanLotRow {
  return {
    lotId: `lot-${over.registrationId}`,
    lotNumber: "L001",
    seq: 1,
    status: "queued",
    basePrice: paise(100_000),
    soldToTeamId: null,
    soldPrice: null,
    playerName: null,
    role: "batter",
    number: "R-1",
    ...over,
  };
}

function target(over: Partial<TargetState> & { registrationId: string }): TargetState {
  return {
    maxBid: null,
    priority: 3,
    fallbackRegistrationId: null,
    outcome: "open",
    lotId: null,
    lotStatus: null,
    basePrice: null,
    plannedAmount: paise(0),
    countedAtBase: true,
    paidAmount: null,
    ladderFloor: null,
    effectiveBackup: null,
    ...over,
  };
}

describe("rupeesFromPaise", () => {
  it("round-trips whole rupees without grouping, and keeps paise when present", () => {
    expect(rupeesFromPaise(null)).toBe("");
    expect(rupeesFromPaise(150_000_000)).toBe("1500000");
    expect(rupeesFromPaise(150)).toBe("1.50");
  });
});

describe("groupByPriority", () => {
  it("orders must-have, high, target and drops empty groups", () => {
    const groups = groupByPriority([
      target({ registrationId: "c", priority: 3 }),
      target({ registrationId: "a", priority: 1 }),
      target({ registrationId: "d", priority: 3 }),
    ]);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.registrationId)])).toEqual([
      ["Must have", ["a"]],
      ["Target", ["c", "d"]],
    ]);
  });
});

describe("searchPool", () => {
  const pool = [
    lot({ registrationId: "a", playerName: "Rohit Sharma", number: "MPL-014", role: "batter" }),
    lot({ registrationId: "b", playerName: "Jasprit Bumrah", number: "MPL-021", role: "bowler" }),
    lot({
      registrationId: "c",
      playerName: "Hardik Pandya",
      number: "MPL-007",
      role: "all_rounder",
    }),
  ];

  it("shows nothing for an empty query and matches every token across name, number and role", () => {
    expect(searchPool(pool, new Set(), "")).toEqual([]);
    expect(searchPool(pool, new Set(), "  ")).toEqual([]);
    expect(searchPool(pool, new Set(), "sharma").map((l) => l.registrationId)).toEqual(["a"]);
    expect(searchPool(pool, new Set(), "021").map((l) => l.registrationId)).toEqual(["b"]);
    expect(searchPool(pool, new Set(), "all rounder").map((l) => l.registrationId)).toEqual(["c"]);
    expect(searchPool(pool, new Set(), "har pan").map((l) => l.registrationId)).toEqual(["c"]);
  });

  it("leaves out lots already decided: sold to anyone, or withdrawn", () => {
    const decided = [
      ...pool,
      lot({ registrationId: "d", playerName: "Sold Already", status: "sold", soldToTeamId: "me" }),
      lot({ registrationId: "e", playerName: "Sold Elsewhere", status: "sold", soldToTeamId: "x" }),
      lot({ registrationId: "f", playerName: "Pulled Out", status: "withdrawn" }),
      lot({ registrationId: "g", playerName: "Unsold Yet", status: "unsold" }),
    ];
    expect(searchPool(decided, new Set(), "sold").map((l) => l.registrationId)).toEqual(["g"]);
    expect(searchPool(decided, new Set(), "pulled")).toEqual([]);
  });

  it("leaves out players already on the plan and honours the limit", () => {
    expect(searchPool(pool, new Set(["a"]), "a").map((l) => l.registrationId)).toEqual(["b", "c"]);
    expect(searchPool(pool, new Set(), "a", 1).map((l) => l.registrationId)).toEqual(["a"]);
  });
});

describe("roleFacts", () => {
  it("counts the squad (won + pre-signed) and what is still to come, in role order, zeros kept", () => {
    const facts = roleFacts(
      [
        lot({ registrationId: "a", role: "bowler", status: "sold", soldToTeamId: "me" }),
        lot({ registrationId: "b", role: "batter", status: "sold", soldToTeamId: "rival" }),
        lot({ registrationId: "c", role: "batter", status: "queued" }),
        lot({ registrationId: "d", role: "wicket_keeper", status: "on_block" }),
        lot({ registrationId: "e", role: "all_rounder", status: "withdrawn" }),
        lot({ registrationId: "f", role: "batter", status: "unsold" }),
      ],
      ["batter", "batter"],
      "me",
      CRICKET_ROLES,
    );
    expect(facts.squad).toEqual([
      { role: "batter", count: 2 },
      { role: "bowler", count: 1 },
      { role: "all_rounder", count: 0 },
      { role: "wicket_keeper", count: 0 },
    ]);
    // Unsold is still to come (it may be requeued); withdrawn is not.
    expect(facts.remaining).toEqual([
      { role: "batter", count: 2 },
      { role: "bowler", count: 0 },
      { role: "all_rounder", count: 0 },
      { role: "wicket_keeper", count: 1 },
    ]);
  });

  it("counts a FOOTBALL squad in football roles, with no cricket phantoms", () => {
    /*
     * The defect: `roleFacts` seeded its buckets from `REGISTRATION_ROLES` —
     * cricket's four — so an owner planning a football auction read
     * "0 batters · 0 bowlers · 0 all-rounders · 0 wicket-keepers" above their
     * actual squad, and every real football role sorted alphabetically AFTER
     * those phantoms, because cricket's order has no opinion about a defender.
     */
    const football = sportPackFor("football").roles.values.map((value) => value.key);
    const facts = roleFacts(
      [
        lot({ registrationId: "a", role: "goalkeeper", status: "sold", soldToTeamId: "me" }),
        lot({ registrationId: "b", role: "forward", status: "queued" }),
      ],
      ["defender"],
      "me",
      football,
    );
    // Exactly the season's roles, in the PACK's order — no cricket, none missing.
    expect(facts.squad.map((entry) => entry.role)).toEqual(football);
    expect(facts.squad).toContainEqual({ role: "goalkeeper", count: 1 });
    expect(facts.squad).toContainEqual({ role: "defender", count: 1 });
    expect(facts.remaining).toContainEqual({ role: "forward", count: 1 });
  });
});
