import { CRICKET_ROLE_KEYS } from "../../sports/cricket";
import { FORMAT_PRESETS } from "../formats";
import type { BallPayload, EventType, MatchEvent, NameBook, PayloadOf, WicketKind } from "../types";
import { applyEvent } from "./apply";
import { initialState, currentInnings } from "./state";
import type { MatchState } from "./state";
import { actualBallLimit } from "./overs";
import { deriveResult } from "./result";

export interface CricsheetWicket {
  kind: string;
  player_out: string;
  fielders?: { name?: string; substitute?: boolean; unknown?: boolean }[];
}
export interface CricsheetDelivery {
  batter: string;
  non_striker: string;
  bowler: string;
  runs: { batter: number; extras: number; total: number; non_boundary?: boolean };
  extras?: { wides?: number; noballs?: number; byes?: number; legbyes?: number; penalty?: number };
  wickets?: CricsheetWicket[];
  replacements?: {
    match?: { in: string; out: string; team: string; reason: string }[];
    role?: { in: string; out?: string; reason: string; role: string }[];
  };
}
export interface CricsheetInnings {
  team: string;
  super_over?: boolean;
  overs: { over: number; deliveries: CricsheetDelivery[] }[];
  miscounted_overs?: Record<string, { balls: number | string }>;
  penalty_runs?: { pre?: number; post?: number };
  target?: { runs: number; overs: number };
  absent_hurt?: string[];
}
export interface CricsheetJson {
  meta: { data_version: string; created: string; revision: number };
  info: {
    balls_per_over: number;
    overs: number;
    dates: string[];
    teams: string[];
    players: Record<string, string[]>;
    registry: { people: Record<string, string> };
    toss: { winner: string; decision: "bat" | "field" };
    outcome: {
      winner?: string;
      eliminator?: string;
      result?: string;
      method?: string;
      by?: { runs?: number; wickets?: number };
    };
    gender?: string;
    match_type?: string;
    event?: { name?: string };
    season?: string | number;
    team_type?: string;
    missing?: unknown[];
  };
  innings: CricsheetInnings[];
}
export interface CricsheetExpected {
  participants: {
    seq: number;
    inningsNo: number;
    over: number;
    batter: string;
    nonStriker: string;
    bowler: string;
  }[];
  normalizations: {
    seq: number;
    inningsNo: number;
    over: number;
    delivery: number;
    predicted: [string, string];
    observed: [string, string];
    preceding: CricsheetDelivery | null;
    reason: "unrepresented_end_change";
  }[];
  sourceNormalizations: {
    seq: number;
    reason:
      | "inferred_match_replacement_position"
      | "observed_innings_endpoint"
      | "expanded_retirement_batch"
      | "deduplicated_fielder_identity"
      | "active_fielder_substitute_marker";
    evidence: object;
  }[];
  names: NameBook;
}
function source(value: unknown): CricsheetJson {
  if (
    !value ||
    typeof value !== "object" ||
    !("meta" in value) ||
    !("info" in value) ||
    !("innings" in value)
  )
    throw new Error("Invalid Cricsheet document");
  const json = value as CricsheetJson;
  if (
    !["1.2.0", "1.3.0"].includes(json.meta.data_version) ||
    !Array.isArray(json.innings) ||
    json.info.teams.length !== 2 ||
    json.info.match_type !== "T20"
  )
    throw new Error("Unsupported Cricsheet schema");
  return json;
}
function oversUnits(overs: number, perOver: number): number {
  const full = Math.floor(overs);
  const remainder = Math.round((overs - full) * 10);
  if (!Number.isSafeInteger(full) || remainder >= perOver || remainder < 0)
    throw new Error("Invalid cricket overs notation");
  return full * perOver + remainder;
}
const [BATTER_ROLE, BOWLER_ROLE] = CRICKET_ROLE_KEYS;
const KINDS: Record<string, WicketKind> = {
  bowled: "bowled",
  caught: "caught",
  lbw: "lbw",
  stumped: "stumped",
  "run out": "run_out",
  "hit wicket": "hit_wicket",
  "obstructing the field": "obstructing",
  "hit the ball twice": "hit_twice",
  "timed out": "timed_out",
  "caught and bowled": "caught_and_bowled",
};

interface SourcePlan {
  activeFielders: string[];
  retireAfter: { name: string; kind: "hurt" | "out"; end?: "striker" | "non_striker" }[];
  retireBefore: string[];
  entries: { name: string; end: "striker" | "non_striker"; resume: boolean }[];
  adjustment: Omit<CricsheetExpected["normalizations"][number], "seq"> | null;
  bowlerSet: boolean;
  midOver: boolean;
}
export class CricsheetUnsupportedError extends Error {
  constructor(
    readonly reason: string,
    readonly evidence: string,
  ) {
    super(`${reason}: ${evidence}`);
    this.name = "CricsheetUnsupportedError";
  }
}
type SourceReplacement = NonNullable<
  NonNullable<CricsheetDelivery["replacements"]>["match"]
>[number];
function replacementPositions(json: CricsheetJson) {
  const balls = json.innings.flatMap((i) => i.overs.flatMap((o) => o.deliveries));
  const positions = new Map<
    CricsheetDelivery,
    { replacement: SourceReplacement; recorded: number; inferred: number }[]
  >();
  for (const [recorded, ball] of balls.entries())
    for (const replacement of ball.replacements?.match ?? []) {
      const first = balls.findIndex((b) =>
        [b.batter, b.non_striker, b.bowler].includes(replacement.in),
      );
      const inferred = first < 0 ? recorded : Math.min(first, recorded);
      const lastOutgoing = balls.findLastIndex((b) =>
        [b.batter, b.non_striker, b.bowler].includes(replacement.out),
      );
      if (lastOutgoing >= inferred)
        throw new Error("Contradictory match replacement participation overlap");
      const effective = balls[inferred];
      if (!effective) throw new Error("Missing replacement position");
      positions.set(effective, [
        ...(positions.get(effective) ?? []),
        { replacement, recorded, inferred },
      ]);
    }
  return positions;
}
function terminalQuotaPlan(
  json: CricsheetJson,
  replacements: ReturnType<typeof replacementPositions>,
) {
  const roster = new Map(
    json.info.teams.map((team) => [
      team,
      new Set(
        (json.info.players[team] ?? []).filter(
          (name) =>
            ![...replacements.values()]
              .flat()
              .some(({ replacement: r }) => r.team === team && r.in === name),
        ),
      ),
    ]),
  );
  return json.innings.map((raw, index) => {
    const out = new Set<string>();
    const retired = new Set<string>();
    let runs = (raw.penalty_runs?.pre ?? 0) + (raw.penalty_runs?.post ?? 0);
    let legal = 0;
    for (const over of raw.overs)
      for (const ball of over.deliveries) {
        for (const { replacement: r } of replacements.get(ball) ?? []) {
          roster.get(r.team)?.delete(r.out);
          roster.get(r.team)?.add(r.in);
        }
        retired.delete(ball.batter);
        retired.delete(ball.non_striker);
        for (const wicket of ball.wickets ?? []) {
          if (["retired hurt", "retired not out"].includes(wicket.kind))
            retired.add(wicket.player_out);
          else out.add(wicket.player_out);
        }
        runs += ball.runs.total;
        if (!ball.extras?.wides && !ball.extras?.noballs) legal++;
      }
    const declarations = Object.fromEntries(
      Object.entries(raw.miscounted_overs ?? {}).map(([key, v]) => [key, Number(v.balls)]),
    );
    const limit = actualBallLimit(
      raw.target
        ? oversUnits(raw.target.overs, json.info.balls_per_over)
        : (raw.super_over ? 1 : json.info.overs) * json.info.balls_per_over,
      json.info.balls_per_over,
      declarations,
    );
    const available = [...(roster.get(raw.team) ?? [])].filter(
      (id) => !out.has(id) && !retired.has(id) && !raw.absent_hurt?.includes(id),
    );
    const natural =
      legal >= (limit ?? Infinity) ||
      out.size >= (raw.super_over ? 2 : 10) ||
      available.length < 2 ||
      (raw.target && runs >= raw.target.runs);
    if (index === json.innings.length - 1 || natural) return null;
    if (json.info.missing?.some((m) => /deliver|innings|overs/i.test(JSON.stringify(m))))
      throw new Error("Cannot infer endpoint with missing source deliveries");
    const last = raw.overs.at(-1);
    if (!last) throw new Error("Missing endpoint");
    return (
      last.over * json.info.balls_per_over +
      last.deliveries.filter((b) => !b.extras?.wides && !b.extras?.noballs).length
    );
  });
}
function outcomePreflight(json: CricsheetJson): void {
  const normal = json.innings.filter((i) => !i.super_over);
  const first = normal[0];
  const chase = normal[1];
  if (!first || !chase) return;
  const balls = (i: CricsheetInnings) => i.overs.flatMap((o) => o.deliveries);
  const total = (i: CricsheetInnings) =>
    balls(i).reduce(
      (sum, b) => sum + b.runs.total,
      (i.penalty_runs?.pre ?? 0) + (i.penalty_runs?.post ?? 0),
    );
  const target = chase.target?.runs ?? total(first) + 1;
  const runs = total(chase);
  const outcome = json.info.outcome;
  if (["D/L", "DLS"].includes(outcome.method ?? "")) {
    if (outcome.winner === chase.team && runs < target)
      throw new CricsheetUnsupportedError(
        "missing_effective_dls_target",
        JSON.stringify({ runs, target: chase.target ?? null, outcome }),
      );
    return;
  }
  if (outcome.method || outcome.eliminator || outcome.result === "no result") return;
  if (outcome.winner === chase.team && runs < target)
    throw new CricsheetUnsupportedError(
      "declared_chase_win_below_target",
      JSON.stringify({ runs, target, outcome }),
    );
  let prefix = chase.penalty_runs?.pre ?? 0;
  const deliveries = balls(chase);
  for (const [index, ball] of deliveries.entries()) {
    if (prefix >= target)
      throw new CricsheetUnsupportedError(
        "deliveries_after_target_attained",
        JSON.stringify({ delivery: index + 1, prefix, target, ball }),
      );
    prefix += ball.runs.total;
  }
  if (outcome.winner === first.team && runs < target) {
    const out = new Set<string>();
    const retired = new Set<string>();
    for (const ball of deliveries) {
      retired.delete(ball.batter);
      retired.delete(ball.non_striker);
      for (const wicket of ball.wickets ?? [])
        if (["retired hurt", "retired not out"].includes(wicket.kind))
          retired.add(wicket.player_out);
        else out.add(wicket.player_out);
    }
    const available = (json.info.players[chase.team] ?? []).filter(
      (id) => !out.has(id) && !retired.has(id) && !chase.absent_hurt?.includes(id),
    );
    const legal = deliveries.filter((b) => !b.extras?.wides && !b.extras?.noballs).length;
    const declarations = Object.fromEntries(
      Object.entries(chase.miscounted_overs ?? {}).map(([k, v]) => [k, Number(v.balls)]),
    );
    const quota = actualBallLimit(
      oversUnits(chase.target?.overs ?? json.info.overs, json.info.balls_per_over),
      json.info.balls_per_over,
      declarations,
    );
    if (out.size < 10 && available.length >= 2 && legal < (quota ?? Infinity))
      throw new CricsheetUnsupportedError(
        "unexplained_final_innings_termination",
        JSON.stringify({ runs, target, legal, quota, out: [...out], available, outcome }),
      );
  }
}
/** Source-only preflight; its output is fixed before any fold runs. */
function reconstructionPlan(json: CricsheetJson): Map<CricsheetDelivery, SourcePlan> {
  const plan = new Map<CricsheetDelivery, SourcePlan>();
  outcomePreflight(json);
  const replacements = replacementPositions(json);
  const rosters = json.info.teams.map(
    (team) =>
      new Set((json.info.players[team] ?? []).map((name) => json.info.registry.people[name])),
  );
  for (const id of rosters[0] ?? [])
    if (rosters[1]?.has(id))
      throw new CricsheetUnsupportedError("ambiguous_cross_team_registry_identity", String(id));
  // Classify source-domain limitations before running the scoring fold.
  if (json.info.outcome.method === "Awarded")
    throw new CricsheetUnsupportedError(
      "awarded_result_unsupported",
      JSON.stringify(json.info.outcome),
    );
  for (const [index, innings] of json.innings.entries()) {
    const participated = new Map<string, Set<number>>();
    let previousBowlers = new Set<string>();
    let possibleFreeHit: CricsheetDelivery | null = null;
    for (const over of innings.overs) {
      const bowlers = new Set(over.deliveries.map((ball) => ball.bowler));
      if (!innings.super_over)
        for (const name of bowlers) {
          const indexes = participated.get(name) ?? new Set<number>();
          indexes.add(over.over);
          participated.set(name, indexes);
          if (indexes.size > (FORMAT_PRESETS.t20.maxOversPerBowler ?? Infinity))
            throw new CricsheetUnsupportedError(
              "bowling_quota_outside_supported_profile",
              JSON.stringify({ innings: index + 1, bowler: name, overs: [...indexes] }),
            );
          if (previousBowlers.has(name) && FORMAT_PRESETS.t20.noConsecutiveOvers)
            throw new CricsheetUnsupportedError(
              "consecutive_overs_outside_supported_profile",
              JSON.stringify({
                innings: index + 1,
                bowler: name,
                overs: [over.over - 1, over.over],
              }),
            );
        }
      previousBowlers = bowlers;
      for (const [delivery, ball] of over.deliveries.entries()) {
        const evidence = JSON.stringify({
          innings: index + 1,
          over: over.over,
          delivery: delivery + 1,
          ball,
        });
        if (ball.extras?.wides && ball.runs.batter)
          throw new CricsheetUnsupportedError("incompatible_wide_batter_runs", evidence);
        const dismissals = (ball.wickets ?? []).filter(
          (w) => !["retired hurt", "retired not out", "retired out"].includes(w.kind),
        );
        if (dismissals.length > 1)
          throw new CricsheetUnsupportedError(
            dismissals.some((w) => w.kind === "timed out")
              ? "non_delivery_dismissal_unsupported"
              : "multiple_delivery_dismissals_unsupported",
            evidence,
          );
        if (
          possibleFreeHit &&
          (json.info.dates[0] ?? "") <= "2014-12-31" &&
          ball.wickets?.some(
            (w) =>
              ![
                "run out",
                "obstructing the field",
                "retired hurt",
                "retired not out",
                "retired out",
              ].includes(w.kind),
          )
        )
          throw new CricsheetUnsupportedError(
            "historical_free_hit_unresolved",
            JSON.stringify({
              date: json.info.dates[0],
              innings: index + 1,
              over: over.over,
              delivery: delivery + 1,
              noBall: possibleFreeHit,
              dismissal: ball,
              missing: "historical playing profile and no-ball subtype",
            }),
          );
        if (!ball.extras?.wides && !ball.extras?.noballs) possibleFreeHit = null;
        if (ball.extras?.noballs) possibleFreeHit = ball;
      }
    }
  }
  const normal = json.innings.filter((i) => !i.super_over);
  const firstInnings = normal[0];
  const chase = normal[1];
  if (firstInnings && chase && !json.info.outcome.method && !json.info.outcome.eliminator) {
    const tally = (i: CricsheetInnings) =>
      i.overs
        .flatMap((o) => o.deliveries)
        .reduce(
          (sum, b) => sum + b.runs.total,
          (i.penalty_runs?.pre ?? 0) + (i.penalty_runs?.post ?? 0),
        );
    const firstRuns = tally(firstInnings);
    const chaseRuns = tally(chase);
    const target = chase.target?.runs ?? firstRuns + 1;
    const wickets = chase.overs
      .flatMap((o) => o.deliveries)
      .flatMap((b) => b.wickets ?? [])
      .filter((w) => !["retired hurt", "retired not out"].includes(w.kind)).length;
    const outcome = json.info.outcome;
    if (
      (outcome.by?.runs !== undefined && outcome.by.runs !== target - 1 - chaseRuns) ||
      (outcome.by?.wickets !== undefined && outcome.by.wickets !== 10 - wickets)
    )
      throw new CricsheetUnsupportedError(
        "source_outcome_tally_conflict",
        JSON.stringify({ firstRuns, chaseRuns, target, wickets, outcome }),
      );
  }
  const activeRosters = new Map(
    json.info.teams.map((team) => [
      team,
      new Set(
        (json.info.players[team] ?? []).filter(
          (name) =>
            ![...replacements.values()]
              .flat()
              .some(({ replacement: r }) => r.team === team && r.in === name),
        ),
      ),
    ]),
  );
  for (const [index, innings] of json.innings.entries()) {
    const batters = new Set(
      innings.overs.flatMap((o) => o.deliveries.flatMap((b) => [b.batter, b.non_striker])),
    );
    const represented = [...replacements.values()]
      .flat()
      .filter(({ replacement: r }) => r.team === innings.team).length;
    if (batters.size > FORMAT_PRESETS.t20.playersPerSide + represented)
      throw new CricsheetUnsupportedError(
        "unrepresented_roster_replacement",
        JSON.stringify({
          innings: index + 1,
          batters: [...batters],
          representedReplacements: represented,
        }),
      );
    const first = innings.overs[0]?.deliveries[0];
    if (!first) throw new CricsheetUnsupportedError("empty_innings", String(index + 1));
    let striker: string | null = first.batter;
    let nonStriker: string | null = first.non_striker;
    let bowler: string | null = first.bowler;
    let previous: CricsheetDelivery | null = null;
    const retired = new Set<string>();
    for (const [overIndex, over] of innings.overs.entries()) {
      const count = over.deliveries.filter(
        (ball) => !ball.extras?.wides && !ball.extras?.noballs,
      ).length;
      const declaration = innings.miscounted_overs?.[String(over.over)];
      const length = declaration ? Number(declaration.balls) : json.info.balls_per_over;
      if (
        count > length ||
        (overIndex < innings.overs.length - 1 && count !== length) ||
        (declaration && count !== length)
      )
        throw new CricsheetUnsupportedError(
          "unexplained_over_length",
          `innings ${String(index + 1)} over ${String(over.over)}: ${String(count)}/${String(length)}`,
        );
      let legal = 0;
      for (const [deliveryIndex, ball] of over.deliveries.entries()) {
        for (const { replacement } of replacements.get(ball) ?? []) {
          activeRosters.get(replacement.team)?.delete(replacement.out);
          activeRosters.get(replacement.team)?.add(replacement.in);
          if (striker === replacement.out) striker = null;
          if (nonStriker === replacement.out) nonStriker = null;
        }
        const retireBefore: string[] = [];
        for (const replacement of ball.replacements?.role ?? [])
          if (
            replacement.role === BATTER_ROLE &&
            replacement.out &&
            (replacement.out === striker || replacement.out === nonStriker)
          ) {
            retireBefore.push(replacement.out);
            retired.add(replacement.out);
            if (striker === replacement.out) striker = null;
            if (nonStriker === replacement.out) nonStriker = null;
          }
        const entries: SourcePlan["entries"] = [];
        const incoming = [ball.batter, ball.non_striker].filter(
          (name) => name !== striker && name !== nonStriker,
        );
        for (const end of ["striker", "non_striker"] as const) {
          if ((end === "striker" ? striker : nonStriker) !== null) continue;
          const name = incoming.shift();
          if (!name)
            throw new CricsheetUnsupportedError(
              "unresolved_player_entry",
              `innings ${String(index + 1)} over ${String(over.over)}`,
            );
          entries.push({ name, end, resume: retired.has(name) });
          retired.delete(name);
          if (end === "striker") striker = name;
          else nonStriker = name;
        }
        let adjustment: SourcePlan["adjustment"] = null;
        if (striker !== ball.batter || nonStriker !== ball.non_striker) {
          if (
            !striker ||
            !nonStriker ||
            striker === nonStriker ||
            striker !== ball.non_striker ||
            nonStriker !== ball.batter
          )
            throw new CricsheetUnsupportedError(
              "non_reversal_identity_change",
              `innings ${String(index + 1)} over ${String(over.over)} delivery ${String(deliveryIndex + 1)}`,
            );
          adjustment = {
            inningsNo: index + 1,
            over: over.over,
            delivery: deliveryIndex + 1,
            predicted: [striker, nonStriker],
            observed: [ball.batter, ball.non_striker],
            preceding: previous,
            reason: "unrepresented_end_change",
          };
          [striker, nonStriker] = [nonStriker, striker];
        }
        const bowlerSet = bowler !== ball.bowler;
        const midOver = deliveryIndex > 0;
        if (bowlerSet && midOver && !ball.replacements?.role?.some((r) => r.role === BOWLER_ROLE))
          throw new CricsheetUnsupportedError(
            "unrepresented_mid_over_bowler",
            `innings ${String(index + 1)} over ${String(over.over)}`,
          );
        const retireAfter: SourcePlan["retireAfter"] = [];
        plan.set(ball, {
          activeFielders: [
            ...(activeRosters.get(json.info.teams.find((t) => t !== innings.team) ?? "") ?? []),
          ],
          retireBefore,
          retireAfter,
          entries,
          adjustment,
          bowlerSet,
          midOver,
        });
        bowler = ball.bowler;
        const extras = ball.extras;
        const physical = extras?.wides
          ? extras.wides - 1
          : !ball.runs.non_boundary && (ball.runs.batter === 4 || ball.runs.batter === 6)
            ? 0
            : ball.runs.batter +
              (extras?.byes ?? 0) +
              (extras?.legbyes ?? 0) +
              Math.max(0, (extras?.noballs ?? 1) - 1);
        if (physical % 2) [striker, nonStriker] = [nonStriker, striker];
        if (!extras?.wides && !extras?.noballs) {
          legal++;
          if (legal === length) {
            [striker, nonStriker] = [nonStriker, striker];
            bowler = null;
          }
        }
        for (const wicket of ball.wickets ?? []) {
          if (["retired hurt", "retired not out", "retired out"].includes(wicket.kind)) {
            const action: SourcePlan["retireAfter"][number] = {
              name: wicket.player_out,
              kind: wicket.kind === "retired out" ? "out" : "hurt",
            };
            if (striker !== wicket.player_out && nonStriker !== wicket.player_out) {
              if (wicket.kind !== "retired out" || (striker !== null && nonStriker !== null))
                throw new Error("Unrepresented off-crease retirement");
              action.end = striker === null ? "striker" : "non_striker";
            }
            retireAfter.push(action);
          }
          if (striker === wicket.player_out) striker = null;
          if (nonStriker === wicket.player_out) nonStriker = null;
          if (["retired hurt", "retired not out"].includes(wicket.kind))
            retired.add(wicket.player_out);
        }
        previous = ball;
      }
    }
  }
  return plan;
}

export function preflightCricsheet(input: unknown): { adjustments: number } {
  const plan = reconstructionPlan(source(input));
  return { adjustments: [...plan.values()].filter((entry) => entry.adjustment !== null).length };
}

/** Deterministic source transitions; never repairs an ordinary strike mismatch. */
export function fromCricsheet(input: unknown): {
  events: MatchEvent[];
  expected: CricsheetExpected;
} {
  const json = source(input);
  const plan = reconstructionPlan(json);
  const replacementPlan = replacementPositions(json);
  const terminalPlan = terminalQuotaPlan(json, replacementPlan);
  const sourceNormalizations: CricsheetExpected["sourceNormalizations"] = [];
  const events: MatchEvent[] = [];
  const participants: CricsheetExpected["participants"] = [];
  const normalizations: CricsheetExpected["normalizations"] = [];
  const names: NameBook = { teams: {}, players: {} };
  const teamIds = new Map(
    json.info.teams.map((name, index) => [name, `team-${String(index + 1)}`]),
  );
  const teamId = (name: string): string => {
    const id = teamIds.get(name);
    if (!id) throw new Error(`Unknown source team: ${name}`);
    return id;
  };
  const playerId = (name: string): string => {
    const id = json.info.registry.people[name];
    if (!id) throw new Error(`Missing registry entry: ${name}`);
    return `cs-${id}`;
  };
  for (const name of json.info.teams)
    names.teams[teamId(name)] = {
      id: teamId(name),
      name,
      initials: name
        .split(" ")
        .map((p) => p[0])
        .join("")
        .slice(0, 3),
    };
  for (const name of Object.keys(json.info.registry.people))
    names.players[playerId(name)] = {
      name,
      initials: name
        .split(" ")
        .map((p) => p[0])
        .join("")
        .slice(0, 3),
      photoUrl: null,
    };
  let state = initialState();
  function emit<T extends EventType>(type: T, payload: PayloadOf<T>): void {
    const seq = events.length + 1;
    const event: MatchEvent<T> = {
      eventId: `cs-event-${String(seq)}`,
      seq,
      attempt: 1,
      type,
      v: 1,
      payload,
      targetEventId: null,
      actorPersonId: "cricsheet",
      clientSeq: seq,
      clientRecordedAt: `${json.info.dates[0] ?? "2000-01-01"}T00:00:00.000Z`,
    };
    const result = applyEvent(state, event);
    if (!result.ok) throw new Error(`Cricsheet ${type} #${String(seq)}: ${result.reason}`);
    state = result.state;
    events.push(event);
  }
  const competition =
    json.info.event?.name && json.info.season !== undefined
      ? { name: json.info.event.name, season: String(json.info.season) }
      : undefined;
  const boundaryProfile =
    competition?.name === "Indian Premier League" && competition.season === "2014";
  emit("match_started", {
    ...(competition ? { competition } : {}),
    ...(boundaryProfile ? { superOverTie: "boundary_count" as const } : {}),
    format: {
      ...FORMAT_PRESETS.t20,
      oversPerInnings: json.info.overs,
      ballsPerOver: json.info.balls_per_over,
    },
    conditions: {},
    homeTeamId: teamId(json.info.teams[0] ?? ""),
    awayTeamId: teamId(json.info.teams[1] ?? ""),
  });
  const replacements = json.innings.flatMap((i) =>
    i.overs.flatMap((o) => o.deliveries.flatMap((b) => b.replacements?.match ?? [])),
  );
  for (const name of json.info.teams) {
    const roster = json.info.players[name];
    if (!roster) throw new Error("Missing source roster");
    const incoming = new Set(replacements.filter((r) => r.team === name).map((r) => r.in));
    const battingOrder = roster.filter((p) => !incoming.has(p)).map(playerId);
    const temporaryFielders = json.innings
      .filter((i) => i.team !== name)
      .flatMap((i) =>
        i.overs.flatMap((o) =>
          o.deliveries.flatMap((b) =>
            (b.wickets ?? []).flatMap((w) =>
              (w.fielders ?? []).filter((f) => f.substitute && !!f.name).map((f) => f.name ?? ""),
            ),
          ),
        ),
      );
    const substitutes = [...new Set([...incoming, ...temporaryFielders])]
      .filter((p) => !battingOrder.includes(playerId(p)))
      .map(playerId);
    emit("lineup_confirmed", {
      teamId: teamId(name),
      battingOrder,
      substitutes,
      captainId: battingOrder[0] ?? "",
      keeperId: battingOrder[1] ?? "",
    });
  }
  emit("toss", {
    winnerTeamId: teamId(json.info.toss.winner),
    decision: json.info.toss.decision === "field" ? "bowl" : "bat",
  });
  const appliedReplacements = new Set<
    NonNullable<NonNullable<CricsheetDelivery["replacements"]>["match"]>[number]
  >();
  function replaceBefore(ball: CricsheetDelivery): void {
    for (const { replacement, recorded, inferred } of replacementPlan.get(ball) ?? []) {
      if (appliedReplacements.has(replacement)) continue;
      emit("substitute", {
        teamId: teamId(replacement.team),
        inId: playerId(replacement.in),
        outId: playerId(replacement.out),
        kind:
          replacement.reason === "concussion_substitute"
            ? "concussion"
            : replacement.reason === "impact_player"
              ? "impact"
              : "tactical",
      });
      appliedReplacements.add(replacement);
      if (recorded !== inferred)
        sourceNormalizations.push({
          seq: events.length,
          reason: "inferred_match_replacement_position",
          evidence: { ...replacement, recorded, inferred },
        });
    }
  }
  function penalty(team: string, amount: number): void {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount % 5 !== 0)
      throw new Error("Unsupported penalty amount");
    for (let runs = 0; runs < amount; runs += 5)
      emit("penalty_runs", { teamId: teamId(team), runs: 5, reason: "other" });
  }
  for (const [index, raw] of json.innings.entries()) {
    const first = raw.overs[0]?.deliveries[0];
    if (!first) throw new Error("Source innings has no deliveries");
    if (index > 0 && !currentInnings(state)?.closed)
      throw new Error("Source innings ended without a representable closure");
    if (raw.super_over && index % 2 === 0) emit("super_over_started", {});
    const declarations: Record<string, number> = {};
    for (const [over, declared] of Object.entries(raw.miscounted_overs ?? {})) {
      const count = Number(declared.balls);
      const actual = raw.overs
        .find((o) => String(o.over) === over)
        ?.deliveries.filter((b) => !b.extras?.wides && !b.extras?.noballs).length;
      if (actual !== count) throw new Error(`Declared over ${over} differs from raw tally`);
      if (count !== json.info.balls_per_over) declarations[over] = count;
    }
    replaceBefore(first);
    emit("innings_started", {
      inningsNo: index + 1,
      battingTeamId: teamId(raw.team),
      strikerId: playerId(first.batter),
      nonStrikerId: playerId(first.non_striker),
      bowlerId: playerId(first.bowler),
      ...(raw.super_over ? { superOver: true } : {}),
      ...(raw.absent_hurt?.length ? { absentBatterIds: raw.absent_hurt.map(playerId) } : {}),
      ...(Object.keys(declarations).length ? { miscountedOvers: declarations } : {}),
    });
    const rawDeliveries = raw.overs.flatMap((over) => over.deliveries);
    const beforeLastRuns = rawDeliveries
      .slice(0, -1)
      .reduce((sum, ball) => sum + ball.runs.total, raw.penalty_runs?.pre ?? 0);
    const terminalTarget =
      !!raw.target &&
      ["D/L", "DLS"].includes(json.info.outcome.method ?? "") &&
      (beforeLastRuns >= raw.target.runs ||
        rawDeliveries.slice(0, -1).filter((b) => !b.extras?.wides && !b.extras?.noballs).length >=
          (actualBallLimit(
            oversUnits(raw.target.overs, json.info.balls_per_over),
            json.info.balls_per_over,
            declarations,
          ) ?? Infinity));
    if (
      raw.target &&
      !terminalTarget &&
      (raw.target.runs !== currentInnings(state)?.target ||
        oversUnits(raw.target.overs, json.info.balls_per_over) !==
          currentInnings(state)?.maxBalls ||
        ["D/L", "DLS"].includes(json.info.outcome.method ?? ""))
    )
      emit("revise", {
        inningsNo: index + 1,
        maxBalls: oversUnits(raw.target.overs, json.info.balls_per_over),
        targetRuns: raw.target.runs,
        method:
          json.info.outcome.method === "D/L" || json.info.outcome.method === "DLS"
            ? "dls"
            : "manual",
      });
    if (raw.penalty_runs?.pre) {
      penalty(raw.team, raw.penalty_runs.pre);
    }
    for (const over of raw.overs) {
      for (const ball of over.deliveries) {
        replaceBefore(ball);
        const step = plan.get(ball);
        if (!step) throw new Error("Missing precomputed source transition");
        for (const name of step.retireBefore)
          emit("retire", { registrationId: playerId(name), kind: "hurt" });
        for (const entry of step.entries) {
          if (entry.resume) emit("resume_batting", { registrationId: playerId(entry.name) });
          else emit("new_batter", { registrationId: playerId(entry.name), end: entry.end });
        }
        if (step.adjustment) {
          emit("strike_swapped", {});
          normalizations.push({ ...step.adjustment, seq: events.length });
        }
        const role = ball.replacements?.role?.find((r) => r.role === BOWLER_ROLE);
        if (step.bowlerSet)
          emit("bowler_set", {
            bowlerId: playerId(ball.bowler),
            midOver: step.midOver,
            ...(role ? { reason: role.reason === "injury" ? "injury" : "other" } : {}),
          });
        participants.push({
          seq: events.length + 1,
          inningsNo: index + 1,
          over: over.over,
          batter: playerId(ball.batter),
          nonStriker: playerId(ball.non_striker),
          bowler: playerId(ball.bowler),
        });
        const dismissal = ball.wickets?.find(
          (w) => !["retired hurt", "retired not out", "retired out"].includes(w.kind),
        );
        const kind = dismissal ? KINDS[dismissal.kind] : undefined;
        if (dismissal && !kind) throw new Error(`Unsupported dismissal: ${dismissal.kind}`);
        const extras: BallPayload["extras"] = {
          ...(ball.extras?.wides ? { wides: ball.extras.wides } : {}),
          ...(ball.extras?.noballs
            ? {
                noBall: true,
                ...(ball.extras.noballs !== 1 ? { noBallRuns: ball.extras.noballs } : {}),
              }
            : {}),
          ...(ball.extras?.byes ? { byes: ball.extras.byes } : {}),
          ...(ball.extras?.legbyes ? { legByes: ball.extras.legbyes } : {}),
        };
        emit("ball", {
          bowlerId: playerId(ball.bowler),
          strikerId: playerId(ball.batter),
          nonStrikerId: playerId(ball.non_striker),
          runsBat: ball.runs.batter,
          extras,
          ...(!ball.runs.non_boundary && (ball.runs.batter === 4 || ball.runs.batter === 6)
            ? { boundary: ball.runs.batter }
            : {}),
          ...(dismissal && kind
            ? {
                wicket: {
                  kind,
                  playerOutId: playerId(dismissal.player_out),
                  fielderIds: [
                    ...new Set(
                      (dismissal.fielders ?? [])
                        .filter((f) => !!f.name)
                        .map((f) => playerId(f.name ?? "")),
                    ),
                  ],
                  ...((dismissal.fielders ?? []).some((f) => !f.name)
                    ? {
                        unknownFielderCount: (dismissal.fielders ?? []).filter((f) => !f.name)
                          .length,
                      }
                    : {}),
                  ...((dismissal.fielders ?? []).some(
                    (f) => f.substitute && !!f.name && !step.activeFielders.includes(f.name),
                  )
                    ? {
                        substituteFielderIds: (dismissal.fielders ?? [])
                          .filter(
                            (f) =>
                              f.substitute && !!f.name && !step.activeFielders.includes(f.name),
                          )
                          .map((f) => playerId(f.name ?? "")),
                      }
                    : {}),
                },
              }
            : {}),
        });
        if (ball.extras?.penalty) {
          penalty(raw.team, ball.extras.penalty);
        }
        const activeMarkers = (dismissal?.fielders ?? []).filter(
          (f) => f.substitute && f.name && step.activeFielders.includes(f.name),
        );
        if (activeMarkers.length)
          sourceNormalizations.push({
            seq: events.length,
            reason: "active_fielder_substitute_marker",
            evidence: { inningsNo: index + 1, over: over.over, fielders: activeMarkers },
          });
        const namedFielders = (dismissal?.fielders ?? [])
          .filter((f) => !!f.name)
          .map((f) => playerId(f.name ?? ""));
        if (new Set(namedFielders).size < namedFielders.length)
          sourceNormalizations.push({
            seq: events.length,
            reason: "deduplicated_fielder_identity",
            evidence: { inningsNo: index + 1, over: over.over, fielders: namedFielders },
          });
        if (step.retireAfter.length > 1)
          sourceNormalizations.push({
            seq: events.length,
            reason: "expanded_retirement_batch",
            evidence: { inningsNo: index + 1, over: over.over, retirements: step.retireAfter },
          });
        for (const action of step.retireAfter) {
          if (action.end)
            emit("new_batter", { registrationId: playerId(action.name), end: action.end });
          emit("retire", { registrationId: playerId(action.name), kind: action.kind });
        }
      }
    }
    if (terminalTarget && raw.target)
      emit("revise", {
        inningsNo: index + 1,
        maxBalls: oversUnits(raw.target.overs, json.info.balls_per_over),
        targetRuns: raw.target.runs,
        method: "dls",
      });
    const endpoint = terminalPlan[index];
    if (endpoint !== null && endpoint !== undefined) {
      const declarations = Object.fromEntries(
        Object.entries(raw.miscounted_overs ?? {}).map(([key, v]) => [key, Number(v.balls)]),
      );
      const legal = rawDeliveries.filter((b) => !b.extras?.wides && !b.extras?.noballs).length;
      if (actualBallLimit(endpoint, json.info.balls_per_over, declarations) !== legal)
        throw new Error("Unrepresentable source endpoint");
      emit("revise", {
        inningsNo: index + 1,
        maxBalls: endpoint,
        method: ["D/L", "DLS"].includes(json.info.outcome.method ?? "") ? "dls" : "manual",
      });
      sourceNormalizations.push({
        seq: events.length,
        reason: "observed_innings_endpoint",
        evidence: { inningsNo: index + 1, endpoint, legalBalls: legal },
      });
    }
    if (raw.penalty_runs?.post) {
      penalty(raw.team, raw.penalty_runs.post);
    }
  }
  if (json.info.outcome.result === "no result")
    emit("abandon", { kind: "no_result", reason: "Cricsheet outcome" });
  return { events, expected: { participants, normalizations, sourceNormalizations, names } };
}

export function toCricsheet(state: MatchState, names: NameBook): object {
  if (!state.teams || !state.format || !state.toss)
    throw new Error("Cannot export an unprepared match");
  const format = state.format;
  const teamName = (id: string) => names.teams[id]?.name ?? id;
  const playerName = (id: string) => names.players[id]?.name ?? id;
  const registry: Record<string, string> = {};
  for (const [id, player] of Object.entries(names.players))
    registry[player.name] = id.startsWith("cs-") ? id.slice(3) : id;
  const history = state.eventHistory.filter((event) => event.attempt === state.attempt);
  const players: Record<string, string[]> = {};
  for (const event of history)
    if (event.type === "lineup_confirmed") {
      const lineup = event.payload as PayloadOf<"lineup_confirmed">;
      const incoming = history
        .filter((e) => e.type === "substitute")
        .map((e) => e.payload as PayloadOf<"substitute">)
        .filter((e) => e.teamId === lineup.teamId)
        .map((e) => e.inId);
      players[teamName(lineup.teamId)] = [...lineup.battingOrder, ...new Set(incoming)].map(
        playerName,
      );
    }
  const exportedBySeq = new Map<number, CricsheetDelivery>();
  const innings: CricsheetInnings[] = state.innings.map((i) => ({
    team: teamName(i.battingTeamId),
    ...(i.superOver ? { super_over: true } : {}),
    ...(i.absentBatterIds.length ? { absent_hurt: i.absentBatterIds.map(playerName) } : {}),
    ...(Object.keys(i.miscountedOvers).length
      ? {
          miscounted_overs: Object.fromEntries(
            Object.entries(i.miscountedOvers).map(([index, count]) => [index, { balls: count }]),
          ),
        }
      : {}),
    ...(i.target !== null && i.maxBalls !== null
      ? {
          target: {
            runs: i.target,
            overs:
              Math.floor(i.maxBalls / format.ballsPerOver) +
              (i.maxBalls % format.ballsPerOver) / 10,
          },
        }
      : {}),
    overs: i.overs.map((over, index) => ({
      over: index,
      deliveries: over.balls.map((ball) => {
        const extras = {
          ...(ball.extras.wides ? { wides: ball.extras.wides } : {}),
          ...(ball.extras.noBall ? { noballs: ball.extras.noBallRuns ?? format.noBallRuns } : {}),
          ...(ball.extras.byes ? { byes: ball.extras.byes } : {}),
          ...(ball.extras.legByes ? { legbyes: ball.extras.legByes } : {}),
        };
        const delivery: CricsheetDelivery = {
          batter: playerName(ball.strikerId),
          non_striker: playerName(ball.nonStrikerId ?? ""),
          bowler: playerName(ball.bowlerId),
          runs: {
            batter: ball.runsBat,
            extras: ball.total - ball.runsBat,
            total: ball.total,
            ...(!ball.boundary && (ball.runsBat === 4 || ball.runsBat === 6)
              ? { non_boundary: true }
              : {}),
          },
          ...(Object.keys(extras).length ? { extras } : {}),
          ...(ball.wicket
            ? {
                wickets: [
                  {
                    kind:
                      Object.entries(KINDS).find(([, kind]) => kind === ball.wicket?.kind)?.[0] ??
                      "",
                    player_out: playerName(ball.wicket.playerOutId),
                    fielders: [
                      ...ball.wicket.fielderIds.map((id) => ({
                        name: playerName(id),
                        ...(ball.wicket?.substituteFielderIds?.includes(id)
                          ? { substitute: true }
                          : {}),
                      })),
                      ...Array.from({ length: ball.wicket.unknownFielderCount ?? 0 }, () => ({
                        unknown: true,
                      })),
                    ],
                  },
                ],
              }
            : {}),
        };
        exportedBySeq.set(ball.seq, delivery);
        return delivery;
      }),
    })),
  }));
  let currentIndex = -1;
  let previousBall: CricsheetDelivery | undefined;
  for (const event of history) {
    if (event.type === "innings_started") {
      currentIndex++;
      previousBall = undefined;
    }
    if (event.type === "ball") previousBall = exportedBySeq.get(event.seq);
    if (event.type === "retire") {
      if (!previousBall) throw new Error("Retirement before source deliveries is unsupported");
      const retire = event.payload as PayloadOf<"retire">;
      previousBall.wickets = [
        ...(previousBall.wickets ?? []),
        {
          kind: retire.kind === "out" ? "retired out" : "retired hurt",
          player_out: playerName(retire.registrationId),
        },
      ];
    }
    if (event.type === "substitute" || event.type === "bowler_set") {
      const next = history.find((e) => e.seq > event.seq && e.type === "ball");
      const delivery = next ? exportedBySeq.get(next.seq) : undefined;
      if (!delivery) continue;
      if (event.type === "substitute") {
        const replacement = event.payload as PayloadOf<"substitute">;
        delivery.replacements = {
          ...delivery.replacements,
          match: [
            ...(delivery.replacements?.match ?? []),
            {
              in: playerName(replacement.inId),
              out: playerName(replacement.outId),
              team: teamName(replacement.teamId),
              reason:
                replacement.kind === "concussion"
                  ? "concussion_substitute"
                  : replacement.kind === "impact"
                    ? "impact_player"
                    : "supersub",
            },
          ],
        };
      } else {
        const replacement = event.payload as PayloadOf<"bowler_set">;
        if (replacement.midOver)
          delivery.replacements = {
            ...delivery.replacements,
            role: [
              {
                in: playerName(replacement.bowlerId),
                role: BOWLER_ROLE,
                reason: replacement.reason ?? "other",
              },
            ],
          };
      }
    }
    if (event.type === "penalty_runs") {
      const penalty = event.payload as PayloadOf<"penalty_runs">;
      const index = state.innings.findLastIndex(
        (i, idx) => idx <= currentIndex && i.battingTeamId === penalty.teamId,
      );
      const raw = innings[index];
      if (!raw) throw new Error("Pending pre-innings penalties are outside imported domain");
      if (previousBall && index === currentIndex) {
        previousBall.extras = {
          ...previousBall.extras,
          penalty: (previousBall.extras?.penalty ?? 0) + penalty.runs,
        };
        previousBall.runs.extras += penalty.runs;
        previousBall.runs.total += penalty.runs;
      } else raw.penalty_runs = { pre: (raw.penalty_runs?.pre ?? 0) + penalty.runs };
    }
  }
  const derived = deriveResult(state);
  const result = derived?.winnerTeamId
    ? {
        winner: teamName(derived.winnerTeamId),
        ...(derived.method === "dls" ? { method: "D/L" } : {}),
        ...(derived.method === "super_over"
          ? { eliminator: teamName(derived.winnerTeamId), result: "tie" }
          : {}),
        ...(/^by \d+ runs$/.test(derived.marginText)
          ? { by: { runs: Number(derived.marginText.split(" ")[1]) } }
          : /^by \d+ wickets$/.test(derived.marginText)
            ? { by: { wickets: Number(derived.marginText.split(" ")[1]) } }
            : {}),
      }
    : { result: state.outcome === "no_result" ? "no result" : "tie" };
  return {
    meta: { data_version: "1.3.0", created: "2000-01-01", revision: 1 },
    info: {
      balls_per_over: format.ballsPerOver,
      overs: format.oversPerInnings,
      dates: [history[0]?.clientRecordedAt.slice(0, 10) ?? "2000-01-01"],
      match_type: "T20",
      gender: "male",
      ...(state.competition
        ? { event: { name: state.competition.name }, season: state.competition.season }
        : {}),
      teams: [teamName(state.teams.home), teamName(state.teams.away)],
      players,
      registry: { people: registry },
      toss: {
        winner: teamName(state.toss.winnerTeamId),
        decision: state.toss.decision === "bat" ? "bat" : "field",
      },
      outcome: {
        ...result,
        ...(state.innings.some((i) => i.targetMethod === "dls") ? { method: "D/L" } : {}),
      },
    },
    innings,
  };
}
