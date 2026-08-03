import { describe, expect, it } from "vitest";

import {
  FIXTURE_STATUSES,
  addDays,
  blockingConflicts,
  canEditFixture,
  canRescheduleFixture,
  competitionCode,
  conflictsInvolving,
  detectConflicts,
  fixtureNumber,
  fixtureTransition,
  isValidKickoff,
  kickoffToMinutes,
  planRoundRobin,
  roundRobinPairings,
  type FixtureForConflicts,
  type FixtureStatus,
  type GeneratePlanInput,
} from "./fixture";
import { parseFixtureCsv } from "./fixture-csv";

const READY = { hasKickoff: true, hasGround: true };

describe("fixture lifecycle machine", () => {
  it("walks the canonical path: draft → scheduled → published → in_progress → completed", () => {
    expect(fixtureTransition("draft", { type: "schedule" }, READY)).toEqual({
      ok: true,
      next: "scheduled",
    });
    expect(fixtureTransition("scheduled", { type: "publish" })).toEqual({
      ok: true,
      next: "published",
    });
    expect(fixtureTransition("published", { type: "start" })).toEqual({
      ok: true,
      next: "in_progress",
    });
    expect(fixtureTransition("in_progress", { type: "complete" })).toEqual({
      ok: true,
      next: "completed",
    });
  });

  it("cancel is legal from every pre-terminal state and only those", () => {
    for (const from of ["draft", "scheduled", "published", "in_progress"] as const) {
      expect(fixtureTransition(from, { type: "cancel" })).toEqual({
        ok: true,
        next: "cancelled",
      });
    }
    expect(fixtureTransition("completed", { type: "cancel" })).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
    expect(fixtureTransition("cancelled", { type: "cancel" })).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
  });

  it("schedule requires kickoff + ground (guard, fail closed)", () => {
    expect(fixtureTransition("draft", { type: "schedule" })).toEqual({
      ok: false,
      reason: "guard_failed",
    });
    expect(
      fixtureTransition("draft", { type: "schedule" }, { hasKickoff: true, hasGround: false }),
    ).toEqual({ ok: false, reason: "guard_failed" });
  });

  it("completed and cancelled have NO exits — terminal states are immutable", () => {
    const events = ["schedule", "publish", "start", "complete", "cancel"] as const;
    for (const terminal of ["completed", "cancelled"] as const) {
      for (const type of events) {
        expect(fixtureTransition(terminal, { type }, READY).ok).toBe(false);
      }
    }
  });

  it("refuses undeclared edges (publish from draft, complete from published, …)", () => {
    expect(fixtureTransition("draft", { type: "publish" })).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
    expect(fixtureTransition("scheduled", { type: "start" })).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
    expect(fixtureTransition("published", { type: "complete" })).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
    expect(fixtureTransition("published", { type: "publish" })).toEqual({
      ok: false,
      reason: "illegal_transition",
    });
  });

  it("edit and reschedule windows follow the published-protection rule", () => {
    const editable: FixtureStatus[] = FIXTURE_STATUSES.filter(canEditFixture);
    expect(editable).toEqual(["draft", "scheduled"]);
    const reschedulable: FixtureStatus[] = FIXTURE_STATUSES.filter(canRescheduleFixture);
    expect(reschedulable).toEqual(["scheduled", "published"]);
  });
});

describe("deterministic fixture number", () => {
  it("derives MPL26-style codes from name + start year", () => {
    expect(competitionCode("Malad Premier League", "2026-08-01")).toBe("MPL26");
    expect(competitionCode("Mumbai Cup", null)).toBe("MC");
    expect(competitionCode("Ashes", "2027-01-01")).toBe("ASH27");
  });

  it("pads to three digits and grows beyond 999 without truncation", () => {
    expect(fixtureNumber("MPL26", 1)).toBe("MPL26-F001");
    expect(fixtureNumber("MPL26", 42)).toBe("MPL26-F042");
    expect(fixtureNumber("MPL26", 1000)).toBe("MPL26-F1000");
  });
});

describe("wall-clock helpers", () => {
  it("validates kickoffs and rejects impossible calendar dates", () => {
    expect(isValidKickoff("2026-08-01T18:00")).toBe(true);
    expect(isValidKickoff("2026-02-31T18:00")).toBe(false); // impossible date
    expect(isValidKickoff("2026-08-01 18:00")).toBe(false); // wrong shape
    expect(isValidKickoff("2026-08-01T24:00")).toBe(false);
  });

  it("kickoff minutes are timezone-independent and ordered", () => {
    const a = kickoffToMinutes("2026-08-01T18:00");
    const b = kickoffToMinutes("2026-08-01T20:30");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect((b ?? 0) - (a ?? 0)).toBe(150);
  });

  it("addDays crosses month boundaries deterministically", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("round-robin pairings (pure, deterministic)", () => {
  const four = ["A", "B", "C", "D"];

  it("every pair meets exactly once in a single round robin", () => {
    const pairings = roundRobinPairings(four, 1);
    expect(pairings.length).toBe(6); // C(4,2)
    const keys = pairings.map((p) => [p.homeTeamId, p.awayTeamId].sort().join("-"));
    expect(new Set(keys).size).toBe(6);
  });

  it("no team appears twice within one round", () => {
    for (const teams of [
      four,
      ["A", "B", "C", "D", "E"],
      ["A", "B", "C", "D", "E", "F", "G", "H"],
    ]) {
      const pairings = roundRobinPairings(teams, 1);
      const rounds = new Map<number, string[]>();
      for (const p of pairings) {
        const inRound = rounds.get(p.round) ?? [];
        inRound.push(p.homeTeamId, p.awayTeamId);
        rounds.set(p.round, inRound);
      }
      for (const members of rounds.values()) {
        expect(new Set(members).size).toBe(members.length);
      }
    }
  });

  it("odd team counts get a bye, still meeting every opponent once", () => {
    const pairings = roundRobinPairings(["A", "B", "C", "D", "E"], 1);
    expect(pairings.length).toBe(10); // C(5,2)
  });

  it("a double round robin swaps home and away in the second leg", () => {
    const pairings = roundRobinPairings(four, 2);
    expect(pairings.length).toBe(12);
    const leg1 = pairings.filter((p) => p.round <= 3);
    const leg2 = pairings.filter((p) => p.round > 3);
    for (const first of leg1) {
      expect(
        leg2.some(
          (second) =>
            second.homeTeamId === first.awayTeamId && second.awayTeamId === first.homeTeamId,
        ),
      ).toBe(true);
    }
  });

  it("is deterministic: identical inputs, identical output", () => {
    expect(roundRobinPairings(four, 2)).toEqual(roundRobinPairings(four, 2));
  });

  /**
   * Home advantage is the thing club cricket argues about most, and single round
   * robin is the product's default. The old `(r + i) % 2` checkerboard handed one
   * team ZERO home games at every size (N=16: 0 home in 15 fixtures) because a
   * rotating team's seat advances with the round, so its `r + i` parity never
   * changed. Double round robin cancelled the bug out, which is why it hid.
   */
  const homeAwaySplit = (teamIds: readonly string[], rounds: 1 | 2) => {
    const home = new Map(teamIds.map((t) => [t, 0]));
    const away = new Map(teamIds.map((t) => [t, 0]));
    for (const p of roundRobinPairings(teamIds, rounds)) {
      home.set(p.homeTeamId, (home.get(p.homeTeamId) ?? 0) + 1);
      away.set(p.awayTeamId, (away.get(p.awayTeamId) ?? 0) + 1);
    }
    return teamIds.map((t) => ({ team: t, home: home.get(t) ?? 0, away: away.get(t) ?? 0 }));
  };

  it("balances home and away within 1 for every team, N = 2..16, both modes", () => {
    for (let n = 2; n <= 16; n++) {
      const teamIds = Array.from({ length: n }, (_, i) => `T${String(i).padStart(2, "0")}`);
      for (const rounds of [1, 2] as const) {
        for (const split of homeAwaySplit(teamIds, rounds)) {
          expect(Math.abs(split.home - split.away)).toBeLessThanOrEqual(1);
          // Every team plays every opponent: the totals must add up too.
          expect(split.home + split.away).toBe((n - 1) * rounds);
        }
      }
    }
  });

  it("no team is shut out of home fixtures in a single round robin", () => {
    for (const n of [4, 8, 16]) {
      const teamIds = Array.from({ length: n }, (_, i) => `T${String(i).padStart(2, "0")}`);
      for (const split of homeAwaySplit(teamIds, 1)) {
        expect(split.home).toBeGreaterThan(0);
      }
    }
  });

  it("a double round robin stays perfectly balanced", () => {
    for (const n of [4, 8, 16]) {
      const teamIds = Array.from({ length: n }, (_, i) => `T${String(i).padStart(2, "0")}`);
      for (const split of homeAwaySplit(teamIds, 2)) {
        expect(split.home).toBe(split.away);
      }
    }
  });
});

describe("slot assignment (planRoundRobin)", () => {
  const input: GeneratePlanInput = {
    teamIds: ["A", "B", "C", "D"],
    rounds: 1,
    startDate: "2026-08-01",
    kickoffTimes: ["18:00", "20:00"],
    groundIds: ["G1", "G2"],
    durationMinutes: 120,
  };

  it("produces the full schedule with grounds and kickoffs, deterministically", () => {
    const first = planRoundRobin(input);
    const second = planRoundRobin(input);
    expect(first).toEqual(second);
    if (!first.ok) {
      throw new Error("expected ok");
    }
    expect(first.fixtures.length).toBe(6);
    // Every fixture has a ground from the list and a valid kickoff.
    for (const f of first.fixtures) {
      expect(["G1", "G2"]).toContain(f.groundId);
      expect(isValidKickoff(f.kickoffAt)).toBe(true);
    }
  });

  it("the generated schedule is conflict-free by construction", () => {
    const plan = planRoundRobin(input);
    if (!plan.ok) {
      throw new Error("expected ok");
    }
    const fixtures: FixtureForConflicts[] = plan.fixtures.map((f, i) => ({
      id: `f${String(i)}`,
      homeTeamId: f.homeTeamId,
      awayTeamId: f.awayTeamId,
      groundId: f.groundId,
      kickoffAt: f.kickoffAt,
      durationMinutes: f.durationMinutes,
      status: "draft",
    }));
    expect(blockingConflicts(detectConflicts(fixtures))).toEqual([]);
  });

  it("rounds never share a day; overflow spills to the next day", () => {
    // 8 teams, 1 ground, 1 time → 4 matches per round need 4 days each.
    const plan = planRoundRobin({
      teamIds: ["A", "B", "C", "D", "E", "F", "G", "H"],
      rounds: 1,
      startDate: "2026-08-01",
      kickoffTimes: ["18:00"],
      groundIds: ["G1"],
      durationMinutes: 120,
    });
    if (!plan.ok) {
      throw new Error("expected ok");
    }
    const daysByRound = new Map<number, Set<string>>();
    for (const f of plan.fixtures) {
      const days = daysByRound.get(f.round) ?? new Set<string>();
      days.add(f.kickoffAt.slice(0, 10));
      daysByRound.set(f.round, days);
    }
    const allDays = [...daysByRound.values()].flatMap((s) => [...s]);
    expect(new Set(allDays).size).toBe(allDays.length); // no day shared across rounds
  });

  it("fails closed on bad inputs", () => {
    expect(planRoundRobin({ ...input, teamIds: ["A"] })).toEqual({
      ok: false,
      reason: "too_few_teams",
    });
    expect(planRoundRobin({ ...input, teamIds: ["A", "A", "B"] })).toEqual({
      ok: false,
      reason: "duplicate_team",
    });
    expect(planRoundRobin({ ...input, groundIds: [] })).toEqual({
      ok: false,
      reason: "no_grounds",
    });
    expect(planRoundRobin({ ...input, startDate: "01-08-2026" })).toEqual({
      ok: false,
      reason: "invalid_start_date",
    });
    expect(planRoundRobin({ ...input, kickoffTimes: ["25:00"] })).toEqual({
      ok: false,
      reason: "invalid_kickoff_times",
    });
    expect(planRoundRobin({ ...input, durationMinutes: 0 })).toEqual({
      ok: false,
      reason: "invalid_duration",
    });
  });
});

describe("conflict engine (structural, deterministic)", () => {
  const base: FixtureForConflicts = {
    id: "f1",
    homeTeamId: "A",
    awayTeamId: "B",
    groundId: "G1",
    kickoffAt: "2026-08-01T18:00",
    durationMinutes: 120,
    status: "scheduled",
  };

  it("detects team double-booking on overlapping intervals (blocking)", () => {
    const clash: FixtureForConflicts = {
      ...base,
      id: "f2",
      homeTeamId: "A",
      awayTeamId: "C",
      groundId: "G2",
      kickoffAt: "2026-08-01T19:00",
    };
    const conflicts = detectConflicts([base, clash]);
    expect(conflicts.some((c) => c.type === "team_double_booking")).toBe(true);
    expect(blockingConflicts(conflicts).length).toBeGreaterThan(0);
  });

  it("detects ground double-booking; back-to-back is NOT a conflict", () => {
    const sameGround: FixtureForConflicts = {
      ...base,
      id: "f2",
      homeTeamId: "C",
      awayTeamId: "D",
      kickoffAt: "2026-08-01T19:00",
    };
    expect(
      detectConflicts([base, sameGround]).some((c) => c.type === "ground_double_booking"),
    ).toBe(true);
    // Exactly adjacent (18:00+120min = 20:00 start) does not overlap.
    const backToBack: FixtureForConflicts = {
      ...sameGround,
      kickoffAt: "2026-08-01T20:00",
    };
    expect(detectConflicts([base, backToBack])).toEqual([]);
  });

  it("two grounds at one venue, overlapping → SILENT (that is what two grounds are for)", () => {
    const sameVenue: FixtureForConflicts = {
      ...base,
      id: "f2",
      homeTeamId: "C",
      awayTeamId: "D",
      groundId: "G2",
      kickoffAt: "2026-08-01T19:00",
    };
    expect(detectConflicts([base, sameVenue])).toEqual([]);
  });

  it("flags invalid duration, invalid kickoff, and missing kickoff on scheduled fixtures", () => {
    const badDuration = { ...base, id: "d1", durationMinutes: 0 };
    const missingKickoff = {
      ...base,
      id: "d2",
      homeTeamId: "X",
      awayTeamId: "Y",
      groundId: "G9",
      kickoffAt: null,
    };
    const conflicts = detectConflicts([badDuration, missingKickoff]);
    expect(conflicts.map((c) => c.type).sort()).toEqual(["invalid_duration", "invalid_kickoff"]);
    // A DRAFT without a kickoff is fine — it has no slot yet.
    expect(detectConflicts([{ ...missingKickoff, status: "draft", durationMinutes: 120 }])).toEqual(
      [],
    );
  });

  it("flags the same pair meeting twice on one day as a duplicate (warning)", () => {
    const rematch: FixtureForConflicts = {
      ...base,
      id: "f2",
      homeTeamId: "B",
      awayTeamId: "A",
      groundId: "G2",
      kickoffAt: "2026-08-01T21:00",
    };
    const conflicts = detectConflicts([base, rematch]);
    expect(conflicts).toEqual([
      expect.objectContaining({ type: "duplicate_fixture", severity: "warning" }),
    ]);
    // The same pair on ANOTHER day is a normal double round robin.
    expect(detectConflicts([base, { ...rematch, kickoffAt: "2026-08-05T18:00" }])).toEqual([]);
  });

  it("enforces the competition window (blocking)", () => {
    const window = { startsOn: "2026-08-01", endsOn: "2026-08-15" };
    expect(detectConflicts([{ ...base, kickoffAt: "2026-08-20T18:00" }], window)).toEqual([
      expect.objectContaining({ type: "outside_competition_dates", severity: "blocking" }),
    ]);
    expect(detectConflicts([base], window)).toEqual([]);
    // Open-ended windows never block.
    expect(detectConflicts([base], { startsOn: null, endsOn: null })).toEqual([]);
  });

  it("cancelled fixtures hold no slot and never conflict", () => {
    const cancelled: FixtureForConflicts = {
      ...base,
      id: "f2",
      homeTeamId: "A",
      awayTeamId: "C",
      status: "cancelled",
    };
    expect(detectConflicts([base, cancelled])).toEqual([]);
  });

  it("is deterministic regardless of input order", () => {
    const clash: FixtureForConflicts = {
      ...base,
      id: "f2",
      homeTeamId: "A",
      awayTeamId: "C",
      kickoffAt: "2026-08-01T19:00",
    };
    expect(detectConflicts([base, clash])).toEqual(detectConflicts([clash, base]));
  });

  it("conflictsInvolving narrows to the candidate's conflicts", () => {
    const clash: FixtureForConflicts = {
      ...base,
      id: "f2",
      homeTeamId: "A",
      awayTeamId: "C",
      kickoffAt: "2026-08-01T19:00",
    };
    const lonely: FixtureForConflicts = {
      ...base,
      id: "f3",
      homeTeamId: "X",
      awayTeamId: "Y",
      groundId: "G7",
      kickoffAt: "2026-08-09T18:00",
    };
    const conflicts = detectConflicts([base, clash, lonely]);
    expect(conflictsInvolving(conflicts, ["f3"])).toEqual([]);
    expect(conflictsInvolving(conflicts, ["f2"]).length).toBeGreaterThan(0);
  });
});

describe("fixture CSV parsing", () => {
  it("parses valid rows, normalizing space-separated kickoffs", () => {
    const csv =
      "home_team,away_team,kickoff,ground,duration_minutes\n" +
      "Malad Mavericks,Andheri Arrows,2026-08-01 18:00,Main Oval,120\n" +
      "Bandra Blasters,Juhu Jets,2026-08-02T18:00,,";
    const result = parseFixtureCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows.length).toBe(2);
    expect(result.rows[0]?.kickoffAt).toBe("2026-08-01T18:00");
    expect(result.rows[1]?.ground).toBeNull();
    expect(result.rows[1]?.durationMinutes).toBe(180); // default
  });

  it("rejects self-play, bad kickoffs and bad durations with line numbers", () => {
    const csv =
      "home_team,away_team,kickoff,ground,duration_minutes\n" +
      "Team A,Team A,2026-08-01 18:00,,\n" +
      "Team A,Team B,tomorrow,,\n" +
      "Team A,Team C,,,9999";
    const result = parseFixtureCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.errors.map((e) => e.line)).toEqual([2, 3, 4]);
  });

  it("requires the header and refuses empty files", () => {
    expect(parseFixtureCsv("").errors[0]?.message).toBe("The file is empty.");
    expect(parseFixtureCsv("foo,bar\n1,2").errors[0]?.message).toContain(
      "Missing required column(s)",
    );
  });
});
