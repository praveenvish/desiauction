import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { describe, expect, it, inject } from "vitest";
import {
  fromCricsheet,
  toCricsheet,
  preflightCricsheet,
  CricsheetUnsupportedError,
} from "./cricsheet";
import type { CricsheetExpected, CricsheetJson } from "./cricsheet";
import type { MatchEvent } from "../types";
import { applyEvent } from "./apply";
import { initialState, currentInnings } from "./state";
import type { MatchState } from "./state";
import { deriveResult } from "./result";
import { replayMatch } from "./replay";
import { playerLines } from "./lines";

/** Defined before round-trip runs: the supported source scoring domain. */
function canonical(state: MatchState) {
  return {
    competition: state.competition,
    superOverTie: state.superOverTie,
    teams: state.teams,
    lineups: state.lineups,
    toss: state.toss,
    innings: state.innings.map((i) => ({
      battingTeamId: i.battingTeamId,
      bowlingTeamId: i.bowlingTeamId,
      superOver: i.superOver,
      runs: i.runs,
      wickets: i.wickets,
      legalBalls: i.legalBalls,
      maxBalls: i.maxBalls,
      target: i.target,
      targetMethod: i.targetMethod,
      miscountedOvers: i.miscountedOvers,
      completedOvers: i.completedOvers,
      ballsInOver: i.ballsInOver,
      extras: i.extras,
      strikerId: i.strikerId,
      nonStrikerId: i.nonStrikerId,
      bowlerId: i.bowlerId,
      batters: i.batters,
      bowlers: i.bowlers,
      battedOrder: i.battedOrder,
      outIds: i.outIds,
      retiredHurt: i.retiredHurt,
      absentBatterIds: i.absentBatterIds,
      closed: i.closed,
      overs: i.overs.map((o) => ({
        bowlerId: o.bowlerId,
        balls: o.balls.map((ball) => ({
          bowlerId: ball.bowlerId,
          strikerId: ball.strikerId,
          nonStrikerId: ball.nonStrikerId,
          runsBat: ball.runsBat,
          extras: ball.extras,
          boundary: ball.boundary,
          wicket: ball.wicket,
          legal: ball.legal,
          total: ball.total,
          over: ball.over,
        })),
      })),
      fallOfWickets: i.fallOfWickets,
      freeHitNext: i.freeHitNext,
      lastBowlerOfPreviousOver: i.lastBowlerOfPreviousOver,
    })),
    lines: [...playerLines(state)],
    result: deriveResult(state),
    outcome: state.outcome,
  };
}
function checkParticipants(
  events: readonly MatchEvent[],
  expected: CricsheetExpected,
  corruptAfterSeq?: number,
): MatchState {
  const bySeq = new Map(expected.participants.map((p) => [p.seq, p]));
  let state = initialState();
  for (const event of events) {
    const delivery = bySeq.get(event.seq);
    if (delivery)
      expect(currentInnings(state), `participants before ${String(event.seq)}`).toMatchObject({
        strikerId: delivery.batter,
        nonStrikerId: delivery.nonStriker,
        bowlerId: delivery.bowler,
        completedOvers: delivery.over,
      });
    const applied = applyEvent(state, event);
    if (!applied.ok) throw new Error(`Oracle event ${String(event.seq)}: ${applied.reason}`);
    state = applied.state;
    if (event.seq === corruptAfterSeq) {
      const innings = currentInnings(state);
      if (!innings) throw new Error("Missing mutation innings");
      [innings.strikerId, innings.nonStrikerId] = [innings.nonStrikerId, innings.strikerId];
    }
  }
  return state;
}
function verify(
  json: CricsheetJson,
): Pick<CricsheetExpected, "normalizations" | "sourceNormalizations"> {
  const { events, expected } = fromCricsheet(json);
  const state = checkParticipants(events, expected);
  expect(state.innings).toHaveLength(json.innings.length);
  for (const [index, raw] of json.innings.entries()) {
    const deliveries = raw.overs.flatMap((o) => o.deliveries);
    const runs = deliveries.reduce(
      (sum, b) => sum + b.runs.total,
      (raw.penalty_runs?.pre ?? 0) + (raw.penalty_runs?.post ?? 0),
    );
    const wickets = deliveries
      .flatMap((b) => b.wickets ?? [])
      .filter((w) => !["retired hurt", "retired not out"].includes(w.kind)).length;
    const legalBalls = deliveries.filter((b) => !b.extras?.wides && !b.extras?.noballs).length;
    expect(state.innings[index], `innings ${String(index + 1)}`).toMatchObject({
      runs,
      wickets,
      legalBalls,
      superOver: raw.super_over === true,
    });
    for (const [overIndex, over] of raw.overs.entries()) {
      const count = over.deliveries.filter((b) => !b.extras?.wides && !b.extras?.noballs).length;
      const declared = raw.miscounted_overs?.[String(over.over)];
      const length = declared ? Number(declared.balls) : json.info.balls_per_over;
      if (overIndex < raw.overs.length - 1 || declared) expect(count).toBe(length);
      else expect(count).toBeLessThanOrEqual(length);
    }
  }
  const result = deriveResult(state);
  const winner = json.info.outcome.eliminator ?? json.info.outcome.winner;
  if (winner) {
    const id = Object.values(expected.names.teams).find((t) => t.name === winner)?.id;
    expect(result?.winnerTeamId).toBe(id);
    if (!json.info.outcome.method && !json.info.outcome.eliminator) {
      if (json.info.outcome.by?.runs !== undefined)
        expect(result?.marginText).toBe(`by ${String(json.info.outcome.by.runs)} runs`);
      if (json.info.outcome.by?.wickets !== undefined)
        expect(result?.marginText).toBe(`by ${String(json.info.outcome.by.wickets)} wickets`);
    }
  } else
    expect(result?.outcome).toBe(json.info.outcome.result === "no result" ? "no_result" : "tie");
  const exported = toCricsheet(state, expected.names);
  const imported = fromCricsheet(exported);
  expect(canonical(replayMatch(imported.events))).toEqual(canonical(state));
  return expected;
}

const fixtureDirectory = new URL("./__fixtures__/cricsheet/", import.meta.url);
const fixtures = readdirSync(fixtureDirectory)
  .filter((name) => name.endsWith(".json"))
  .sort();
declare module "vitest" {
  export interface ProvidedContext {
    ls1Oracle?: { files: string[]; report: string; preflight?: boolean };
  }
}
const oracleConfig = inject("ls1Oracle");
describe.skipIf(oracleConfig?.preflight === true)("Cricsheet curated oracle", () => {
  it("has exactly 60 source fixtures", () => {
    expect(fixtures).toHaveLength(60);
  });
  for (const file of fixtures)
    it(file, () =>
      verify(JSON.parse(readFileSync(new URL(file, fixtureDirectory), "utf8")) as CricsheetJson),
    );
});

if (oracleConfig)
  it(
    oracleConfig.preflight ? "source preflight" : "full Cricsheet oracle",
    () => {
      const failures: string[] = [];
      const skips: { file: string; reason: string; evidence: string }[] = [];
      let normalizations = 0;
      const auditLedger: (CricsheetExpected["normalizations"][number] & { match: string })[] = [];
      let adjustedMatches = 0;
      const sourceAuditLedger: (CricsheetExpected["sourceNormalizations"][number] & {
        match: string;
      })[] = [];
      for (const file of oracleConfig.files) {
        try {
          const json = JSON.parse(readFileSync(file, "utf8")) as CricsheetJson;
          const verified = oracleConfig.preflight ? null : verify(json);
          const audit = verified?.normalizations ?? [];
          sourceAuditLedger.push(
            ...(verified?.sourceNormalizations ?? []).map((entry) => ({ ...entry, match: file })),
          );
          const count = oracleConfig.preflight
            ? preflightCricsheet(json).adjustments
            : audit.length;
          auditLedger.push(...audit.map((adjustment) => ({ ...adjustment, match: file })));
          normalizations += count;
          if (count) adjustedMatches++;
        } catch (error) {
          if (error instanceof CricsheetUnsupportedError)
            skips.push({ file, reason: error.reason, evidence: error.evidence });
          else
            failures.push(
              `${file}: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`,
            );
        }
      }
      writeFileSync(
        oracleConfig.report,
        JSON.stringify(
          {
            total: oracleConfig.files.length,
            failures,
            skips,
            adjustedMatches,
            normalizations,
            auditLedger,
            sourceAuditLedger,
          },
          null,
          2,
        ),
      );
      expect(failures).toEqual([]);
      expect(skips.length / oracleConfig.files.length).toBeLessThanOrEqual(0.01);
    },
    600000,
  );

function synthetic(adjusted = false): CricsheetJson {
  let striker = "H1";
  let nonStriker = "H2";
  const overs: CricsheetJson["innings"][number]["overs"] = [];
  for (let over = 0; over < 2; over++) {
    const deliveries: CricsheetJson["innings"][number]["overs"][number]["deliveries"] = [];
    for (let ball = 0; ball < 6; ball++) {
      if (adjusted && ((over === 0 && ball === 1) || (over === 1 && ball === 0)))
        [striker, nonStriker] = [nonStriker, striker];
      const runs = over === 0 && ball === 0 ? 1 : 0;
      deliveries.push({
        batter: striker,
        non_striker: nonStriker,
        bowler: over === 0 ? "A1" : "A2",
        runs: { batter: runs, extras: 0, total: runs },
      });
      if (runs % 2) [striker, nonStriker] = [nonStriker, striker];
    }
    overs.push({ over, deliveries });
    [striker, nonStriker] = [nonStriker, striker];
  }
  return {
    meta: { data_version: "1.3.0", created: "2020-01-01", revision: 1 },
    info: {
      balls_per_over: 6,
      overs: 20,
      dates: ["2020-01-01"],
      teams: ["Home", "Away"],
      players: { Home: ["H1", "H2"], Away: ["A1", "A2"] },
      registry: { people: { H1: "h1", H2: "h2", A1: "a1", A2: "a2" } },
      toss: { winner: "Home", decision: "bat" },
      outcome: { result: "no result" },
      match_type: "T20",
    },
    innings: [{ team: "Home", overs }],
  };
}
describe("independent reconstruction safeguards", () => {
  it("does not adjust ordinary single or over-end rotation", () => {
    const imported = fromCricsheet(synthetic());
    expect(imported.expected.normalizations).toEqual([]);
    checkParticipants(imported.events, imported.expected);
  });
  it.each([false, true])(
    "detects run and over-end rotation mutations with adjusted=%s",
    (adjusted) => {
      const imported = fromCricsheet(synthetic(adjusted));
      expect(imported.expected.normalizations).toHaveLength(adjusted ? 2 : 0);
      const first = imported.expected.participants[0];
      const endOfOver = imported.expected.participants[5];
      if (!first || !endOfOver) throw new Error("Missing source mutation points");
      expect(() => checkParticipants(imported.events, imported.expected, first.seq)).toThrow();
      expect(() => checkParticipants(imported.events, imported.expected, endOfOver.seq)).toThrow();
    },
  );
  it("detects omitted and duplicated inferred swaps", () => {
    const imported = fromCricsheet(synthetic(true));
    const swap = imported.events.find((e) => e.type === "strike_swapped");
    if (!swap) throw new Error("Missing inferred swap");
    expect(() =>
      checkParticipants(
        imported.events.filter((e) => e !== swap),
        imported.expected,
      ),
    ).toThrow();
    expect(() =>
      checkParticipants(
        imported.events.flatMap((e) =>
          e === swap ? [e, { ...e, eventId: "duplicate-inferred-swap" }] : [e],
        ),
        imported.expected,
      ),
    ).toThrow();
  });
  it("rejects unexplained participant identities before folding", () => {
    const json = synthetic();
    const ball = json.innings[0]?.overs[0]?.deliveries[1];
    if (!ball) throw new Error("Missing source delivery");
    ball.batter = "Unregistered player";
    expect(() => preflightCricsheet(json)).toThrow(CricsheetUnsupportedError);
  });
  it("fails when a necessary declared over count is removed", () => {
    const raw = synthetic();
    const first = raw.innings[0]?.overs[0];
    const second = raw.innings[0]?.overs[1];
    if (!first || !second || !first.deliveries[5]) throw new Error("Missing source overs");
    first.deliveries.push({ ...first.deliveries[5] });
    const innings = raw.innings[0];
    if (!innings) throw new Error("Missing source innings");
    innings.miscounted_overs = { "0": { balls: 7 } };
    expect(() => preflightCricsheet(raw)).not.toThrow();
    delete innings.miscounted_overs;
    expect(() => preflightCricsheet(raw)).toThrow(CricsheetUnsupportedError);
  });
});

it("preserves a source retirement batch without adding deliveries or balls faced", () => {
  const raw = synthetic();
  const inning = raw.innings[0];
  const last = inning?.overs.at(-1)?.deliveries.at(-1);
  if (!inning || !last) throw new Error("Missing source innings");
  const roster = Array.from({ length: 11 }, (_, i) => `H${String(i + 1)}`);
  raw.info.players.Home = roster;
  for (const name of roster) raw.info.registry.people[name] = name.toLowerCase();
  last.wickets = roster.slice(0, 10).map((player_out) => ({ player_out, kind: "retired out" }));
  const imported = fromCricsheet(raw);
  const state = replayMatch(imported.events);
  expect(state.innings[0]?.wickets).toBe(10);
  expect(state.innings[0]?.legalBalls).toBe(12);
  expect(state.innings[0]?.batters["cs-h3"]?.balls).toBe(0);
  expect(
    imported.expected.sourceNormalizations.some((n) => n.reason === "expanded_retirement_batch"),
  ).toBe(true);
  verify(raw);
});
it("plans a source endpoint independently of the fold and following target quota", () => {
  const raw = synthetic();
  raw.innings.push({
    team: "Away",
    target: { runs: 2, overs: 20 },
    overs: [
      {
        over: 0,
        deliveries: [
          {
            batter: "A1",
            non_striker: "A2",
            bowler: "H1",
            runs: { batter: 0, extras: 0, total: 0 },
          },
        ],
      },
    ],
  });
  const imported = fromCricsheet(raw);
  expect(imported.expected.sourceNormalizations).toContainEqual(
    expect.objectContaining({
      reason: "observed_innings_endpoint",
      evidence: { inningsNo: 1, endpoint: 12, legalBalls: 12 },
    }),
  );
  verify(raw);
});
it("deduplicates named fielding identities while retaining anonymous participants", () => {
  const raw = synthetic();
  const ball = raw.innings[0]?.overs.at(-1)?.deliveries.at(-1);
  if (!ball) throw new Error("Missing source delivery");
  ball.wickets = [
    {
      kind: "run out",
      player_out: ball.batter,
      fielders: [{ name: "A1" }, { name: "A1" }, { substitute: true }],
    },
  ];
  const imported = fromCricsheet(raw);
  const state = replayMatch(imported.events);
  expect(playerLines(state).get("cs-a1")?.fielding).toMatchObject({
    runOutsAssisted: 1,
    runOutsDirect: 0,
  });
  expect(
    imported.expected.sourceNormalizations.some(
      (n) => n.reason === "deduplicated_fielder_identity",
    ),
  ).toBe(true);
  verify(raw);
});

it("does not terminally revise a naturally closed shortened chase before a super over", () => {
  const raw = synthetic();
  const ball = (batter: string, non_striker: string, bowler: string, runs: number) => ({
    batter,
    non_striker,
    bowler,
    runs: { batter: runs, extras: 0, total: runs },
  });
  raw.info.outcome = { result: "tie", eliminator: "Home" };
  raw.innings.push({
    team: "Away",
    target: { runs: 2, overs: 1 },
    overs: [
      {
        over: 0,
        deliveries: [
          ball("A1", "A2", "H1", 1),
          ...Array.from({ length: 5 }, () => ball("A2", "A1", "H1", 0)),
        ],
      },
    ],
  });
  raw.innings.push({
    team: "Away",
    super_over: true,
    overs: [{ over: 0, deliveries: Array.from({ length: 6 }, () => ball("A1", "A2", "H1", 0)) }],
  });
  raw.innings.push({
    team: "Home",
    super_over: true,
    overs: [{ over: 0, deliveries: [ball("H1", "H2", "A1", 1)] }],
  });
  const imported = fromCricsheet(raw);
  expect(
    imported.expected.sourceNormalizations.filter(
      (n) =>
        n.reason === "observed_innings_endpoint" &&
        "inningsNo" in n.evidence &&
        n.evidence.inningsNo === 2,
    ),
  ).toEqual([]);
  verify(raw);
});

it("selects and round-trips the IPL 2014 boundary-count profile independently of the outcome", () => {
  const raw = synthetic();
  raw.info.event = { name: "Indian Premier League" };
  raw.info.season = 2014;
  raw.info.outcome = { result: "tie", eliminator: "Home" };
  const ball = (
    batter: string,
    non_striker: string,
    bowler: string,
    runs: number,
    non_boundary = false,
  ) => ({
    batter,
    non_striker,
    bowler,
    runs: { batter: runs, extras: 0, total: runs, ...(non_boundary ? { non_boundary: true } : {}) },
  });
  raw.innings.push({
    team: "Away",
    target: { runs: 2, overs: 1 },
    overs: [
      {
        over: 0,
        deliveries: [
          ball("A1", "A2", "H1", 1),
          ...Array.from({ length: 5 }, () => ball("A2", "A1", "H1", 0)),
        ],
      },
    ],
  });
  raw.innings.push({
    team: "Away",
    super_over: true,
    overs: [
      {
        over: 0,
        deliveries: [
          ball("A1", "A2", "H1", 4, true),
          ...Array.from({ length: 5 }, () => ball("A1", "A2", "H1", 0)),
        ],
      },
    ],
  });
  raw.innings.push({
    team: "Home",
    super_over: true,
    overs: [
      {
        over: 0,
        deliveries: [
          ball("H1", "H2", "A1", 4),
          ...Array.from({ length: 5 }, () => ball("H1", "H2", "A1", 0)),
        ],
      },
    ],
  });
  const state = replayMatch(fromCricsheet(raw).events);
  expect(state.competition).toEqual({ name: "Indian Premier League", season: "2014" });
  expect(state.superOverTie).toBe("boundary_count");
  expect(deriveResult(state)).toMatchObject({ winnerTeamId: "team-1", method: "super_over" });
  verify(raw);
  raw.info.season = 2015;
  expect(replayMatch(fromCricsheet(raw).events).superOverTie).toBe("another");
});

it("normalizes substitute markers for an otherwise active roster member", () => {
  const raw = synthetic();
  const ball = raw.innings[0]?.overs.at(-1)?.deliveries.at(-1);
  if (!ball) throw new Error("Missing source delivery");
  ball.wickets = [
    { kind: "caught", player_out: ball.batter, fielders: [{ name: "A1", substitute: true }] },
  ];
  const imported = fromCricsheet(raw);
  expect(
    imported.expected.sourceNormalizations.some(
      (entry) => entry.reason === "active_fielder_substitute_marker",
    ),
  ).toBe(true);
  verify(raw);
});
