import {
  auditLog,
  competitions,
  fixtureParticipants,
  fixtureResults,
  fixtures,
  newId,
  teams,
  type Db,
} from "@desiauction/db";
import {
  buildStandings,
  scoreWithinBounds,
  sportPackFor,
  standingsRulesOf,
  type SportPack,
  type AnyResultInput,
  type LobbyPlacement,
  type ResultOutcome,
  type StandingsRow,
} from "@desiauction/core";
import { and, eq, inArray } from "drizzle-orm";

/**
 * RESULTS, AND THE TABLE DERIVED FROM THEM.
 *
 * A fixture could be scheduled, published, started and marked `completed` while
 * the product recorded nothing about how it went. A club could run a whole
 * season through this platform and nothing here could say who won a match, let
 * alone who was top.
 *
 * There is no standings table and there should not be. A stored table drifts
 * from the results beneath it the moment somebody amends a scorecard, and then
 * two screens disagree about who qualifies; deriving costs one pass over a
 * season's fixtures and cannot disagree with itself.
 */

export const RESULT_OUTCOMES: readonly ResultOutcome[] = [
  "home_win",
  "away_win",
  "tie",
  "no_result",
  "abandoned",
];

export function isResultOutcome(value: string): value is ResultOutcome {
  return (RESULT_OUTCOMES as readonly string[]).includes(value);
}

export interface RecordResultInput {
  readonly outcome: ResultOutcome;
  /**
   * Per-side score components, keyed by the SEASON'S pack (Phase 2):
   * `{ runs, wickets, balls }` in cricket, `{ goals }` in football. Absent
   * keys mean "not recorded", which is different from zero and stays different
   * all the way into the league table.
   */
  readonly homeScore?: Readonly<Record<string, number | null>>;
  readonly awayScore?: Readonly<Record<string, number | null>>;
  readonly method?: string | null;
  readonly note?: string | null;
}

export type RecordResultOutcome =
  | { ok: true; amended: boolean }
  | {
      ok: false;
      reason: "unknown_fixture" | "not_played" | "impossible_score" | "winner_without_score";
    };

/**
 * Ten wickets, and a score cannot be negative. Cheap, and it catches a typo.
 *
 * The bounds are the SEASON'S pack (SP-1 Phase 1). Phase 0 left this reaching
 * for `DEFAULT_SPORT` with a note that the right pack was the competition's and
 * the compiler would say so once the column existed. It does, and it did.
 */
/**
 * The scoreline as it is stored: only the pack's own components, and only the
 * ones actually given. `undefined` is dropped rather than written as null —
 * "not recorded" is the absence of a key, which is what the league table reads
 * when it decides a rate cannot be computed.
 */
function buildScore(
  pack: SportPack,
  r: RecordResultInput,
): { home?: Record<string, number>; away?: Record<string, number> } {
  const side = (given: Readonly<Record<string, number | null>> | undefined) => {
    const out: Record<string, number> = {};
    for (const field of pack.result.scoreFields) {
      const value = given?.[field.key];
      if (value != null) {
        out[field.key] = value;
      }
    }
    return out;
  };
  return { home: side(r.homeScore), away: side(r.awayScore) };
}

/**
 * Record or amend a result.
 *
 * Upsert by fixture, because a result is the CURRENT truth about a match, not a
 * log of guesses. Scorers correct themselves — a misread scoreboard, a late
 * penalty run — and a second row would leave the table asking which to believe.
 * The audit row carries who changed it and when, which is the part worth
 * keeping.
 */
/** One squad's finish, as a scorer reads it off the result screen. */
export interface LobbyResultEntry {
  teamId: string;
  /** 1 is the win. Two squads may share a placement. */
  placement: number;
  score?: Record<string, number>;
}

export type RecordLobbyOutcome =
  | { ok: true; amended: boolean }
  | {
      ok: false;
      reason:
        | "unknown_fixture"
        | "not_a_lobby"
        | "not_played"
        | "incomplete"
        | "invalid_placement"
        | "impossible_score";
    };

/**
 * RECORD A LOBBY: where every squad finished, and what it did there.
 *
 * The sibling of `recordFixtureResult` and deliberately separate, for the same
 * reason `createLobbyFixture` is: the two shapes validate different things. A
 * duel needs a winner backed by a score; a lobby needs every scheduled squad
 * placed, because a table that silently drops one has quietly changed the
 * competition.
 *
 * NO `fixture_results` ROW. That table holds a scoreline between two sides and
 * its `outcome` has no word for "twenty-five squads played and nobody beat
 * anybody". A lobby's result IS its participants' placements, which is where
 * the standings read looks.
 */
export async function recordLobbyResult(
  db: Db,
  input: {
    orgId: string;
    fixtureId: string;
    actorId: string;
    placements: readonly LobbyResultEntry[];
  },
): Promise<RecordLobbyOutcome> {
  const [fixture] = await db
    .select({
      id: fixtures.id,
      competitionId: fixtures.competitionId,
      status: fixtures.status,
      homeTeamId: fixtures.homeTeamId,
      sport: competitions.sport,
    })
    .from(fixtures)
    .innerJoin(competitions, eq(competitions.id, fixtures.competitionId))
    .where(and(eq(fixtures.id, input.fixtureId), eq(fixtures.orgId, input.orgId)))
    .limit(1);
  if (fixture === undefined) {
    return { ok: false, reason: "unknown_fixture" };
  }
  if (fixture.homeTeamId !== null) {
    // A duel. Recording placements against it would put a finishing order on a
    // match that has two sides and a winner.
    return { ok: false, reason: "not_a_lobby" };
  }
  // The same gate a duel result passes: a result belongs to a match that
  // happened, and a draft or cancelled fixture has not been played.
  if (
    fixture.status === "draft" ||
    fixture.status === "scheduled" ||
    fixture.status === "cancelled"
  ) {
    return { ok: false, reason: "not_played" };
  }

  const scheduled = await db
    .select({ teamId: fixtureParticipants.teamId, placement: fixtureParticipants.placement })
    .from(fixtureParticipants)
    .where(eq(fixtureParticipants.fixtureId, input.fixtureId));
  const expected = new Set(scheduled.map((row) => row.teamId));
  const given = new Set(input.placements.map((entry) => entry.teamId));
  /*
   * EVERY SCHEDULED SQUAD, AND NO OTHERS. A partial result is the dangerous
   * one: the squads named would take their points and the squads omitted would
   * silently show as not having played, which is a different competition from
   * the one that happened.
   */
  if (given.size !== input.placements.length || given.size !== expected.size) {
    return { ok: false, reason: "incomplete" };
  }
  for (const teamId of given) {
    if (!expected.has(teamId)) {
      return { ok: false, reason: "incomplete" };
    }
  }
  for (const entry of input.placements) {
    // A placement is a position IN THIS LOBBY. Twenty-sixth of twenty-five is
    // not a finish, it is a typo, and the CHECK below would take it.
    if (
      !Number.isInteger(entry.placement) ||
      entry.placement < 1 ||
      entry.placement > expected.size
    ) {
      return { ok: false, reason: "invalid_placement" };
    }
  }
  const pack = sportPackFor(fixture.sport);
  for (const entry of input.placements) {
    if (!scoreWithinBounds(pack, entry.score ?? {})) {
      return { ok: false, reason: "impossible_score" };
    }
  }

  const amended = scheduled.some((row) => row.placement !== null);
  await db.transaction(async (tx) => {
    for (const entry of input.placements) {
      await tx
        .update(fixtureParticipants)
        .set({ placement: entry.placement, score: entry.score ?? {} })
        .where(
          and(
            eq(fixtureParticipants.fixtureId, input.fixtureId),
            eq(fixtureParticipants.teamId, entry.teamId),
          ),
        );
    }
    await tx.insert(auditLog).values({
      id: newId(),
      actor: input.actorId,
      action: amended ? "fixture.result_amended" : "fixture.result_recorded",
      scopeType: "org",
      scopeId: input.orgId,
      subject: input.fixtureId,
      meta: { shape: "lobby", squads: String(input.placements.length) },
    });
  });
  return { ok: true, amended };
}

export async function recordFixtureResult(
  db: Db,
  input: {
    orgId: string;
    fixtureId: string;
    actorId: string;
    result: RecordResultInput;
  },
): Promise<RecordResultOutcome> {
  const [fixture] = await db
    .select({
      id: fixtures.id,
      competitionId: fixtures.competitionId,
      status: fixtures.status,
      homeTeamId: fixtures.homeTeamId,
      awayTeamId: fixtures.awayTeamId,
      /* SP-1 Phase 1: the season's sport decides which pack judges the score. */
      sport: competitions.sport,
    })
    .from(fixtures)
    .innerJoin(competitions, eq(competitions.id, fixtures.competitionId))
    .where(and(eq(fixtures.id, input.fixtureId), eq(fixtures.orgId, input.orgId)))
    .limit(1);
  if (fixture === undefined) {
    return { ok: false, reason: "unknown_fixture" };
  }
  /*
   * A result belongs to a match that happened. `draft` and `scheduled` fixtures
   * have not been played, and recording a result against one would put a score
   * on a game nobody turned up to — and then into the table.
   */
  if (
    fixture.status === "draft" ||
    fixture.status === "scheduled" ||
    fixture.status === "cancelled"
  ) {
    return { ok: false, reason: "not_played" };
  }
  const r = input.result;
  const pack = sportPackFor(fixture.sport);
  if (!scoreWithinBounds(pack, r.homeScore ?? {}) || !scoreWithinBounds(pack, r.awayScore ?? {})) {
    return { ok: false, reason: "impossible_score" };
  }
  /*
   * A declared winner needs a score behind it. Without this a fixture could
   * report "home won" with both innings blank, which puts two points on the
   * table and contributes nothing to net run rate — a team could climb on
   * results that say nothing about how they played.
   */
  const decided = r.outcome === "home_win" || r.outcome === "away_win" || r.outcome === "tie";
  /*
   * A declared winner needs a score behind it. "A score" is the pack's FIRST
   * score field — runs in cricket, goals in football — because that is the
   * component every result of that sport has: a cricket result without runs, or
   * a football result without goals, says nothing about how the match was won
   * and would still put points on the table.
   */
  const primary = pack.result.scoreFields[0]?.key ?? "";
  const homePrimary = r.homeScore?.[primary];
  const awayPrimary = r.awayScore?.[primary];
  if (decided && (homePrimary == null || awayPrimary == null)) {
    return { ok: false, reason: "winner_without_score" };
  }

  const winnerTeamId =
    r.outcome === "home_win"
      ? fixture.homeTeamId
      : r.outcome === "away_win"
        ? fixture.awayTeamId
        : null;

  const [existing] = await db
    .select({ fixtureId: fixtureResults.fixtureId })
    .from(fixtureResults)
    .where(eq(fixtureResults.fixtureId, input.fixtureId))
    .limit(1);
  const amended = existing !== undefined;

  const values = {
    fixtureId: input.fixtureId,
    orgId: input.orgId,
    competitionId: fixture.competitionId,
    outcome: r.outcome,
    winnerTeamId,
    score: buildScore(pack, r),
    method: r.method ?? null,
    note: r.note ?? null,
    recordedBy: input.actorId,
  };
  await db
    .insert(fixtureResults)
    .values(values)
    .onConflictDoUpdate({
      target: fixtureResults.fixtureId,
      set: { ...values, updatedAt: new Date() },
    });

  await db.insert(auditLog).values({
    id: newId(),
    actor: input.actorId,
    // Amending a result moves a league table, so the two are named apart: "who
    // changed this after it was first recorded" is the question an aggrieved
    // club asks, and one action for both cannot answer it.
    action: amended ? "fixture.result.amended" : "fixture.result.recorded",
    scopeType: "org",
    scopeId: input.orgId,
    subject: input.fixtureId,
    // The primary component by the pack's own name — "runs" in cricket,
    // "goals" in football — so an audit row reads correctly for its sport.
    meta: {
      outcome: r.outcome,
      [`home_${primary}`]: homePrimary ?? null,
      [`away_${primary}`]: awayPrimary ?? null,
    },
  });
  return { ok: true, amended };
}

export interface ResultRow {
  readonly fixtureId: string;
  readonly outcome: ResultOutcome;
  readonly winnerTeamId: string | null;
  /** The scoreline in the season's own shape; null when none was recorded. */
  readonly score: { home?: Record<string, number>; away?: Record<string, number> } | null;
  readonly method: string | null;
  readonly note: string | null;
}

/** One fixture's result, or null when it has not been recorded. */
export async function resultOf(db: Db, fixtureId: string): Promise<ResultRow | null> {
  const [row] = await db
    .select()
    .from(fixtureResults)
    .where(eq(fixtureResults.fixtureId, fixtureId))
    .limit(1);
  return row === undefined ? null : toResultRow(row);
}

/** Every recorded result in a competition, keyed by fixture. */
export async function resultsOf(db: Db, competitionId: string): Promise<Map<string, ResultRow>> {
  const rows = await db
    .select()
    .from(fixtureResults)
    .where(eq(fixtureResults.competitionId, competitionId));
  return new Map(rows.map((row) => [row.fixtureId, toResultRow(row)]));
}

function toResultRow(row: typeof fixtureResults.$inferSelect): ResultRow {
  return {
    fixtureId: row.fixtureId,
    outcome: row.outcome,
    winnerTeamId: row.winnerTeamId,
    score: row.score,
    method: row.method,
    note: row.note,
  };
}

export interface StandingsView {
  readonly rows: readonly (StandingsRow & { readonly teamName: string })[];
  /** The season's pack — the table's columns and their order are its rules. */
  readonly sport: SportPack;
  /** How many fixtures have a result, of how many that were played. */
  readonly recorded: number;
  readonly playable: number;
}

/**
 * The table, derived on read.
 *
 * `recorded` and `playable` ride along so the page can say how complete it is.
 * A league table built from three of twenty results is not wrong, but presenting
 * it without saying so invites somebody to read it as the season's standing.
 */
export async function standingsOf(db: Db, competitionId: string): Promise<StandingsView> {
  const [seasonRow] = await db
    .select({ sport: competitions.sport })
    .from(competitions)
    .where(eq(competitions.id, competitionId))
    .limit(1);
  // The season's pack decides which components are summed, which tiebreaks are
  // applied and in what order — the whole table, in other words.
  const pack = sportPackFor(seasonRow?.sport ?? null);
  const [teamRows, resultRows, playedFixtures] = await Promise.all([
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.competitionId, competitionId)),
    db
      .select({
        fixtureId: fixtureResults.fixtureId,
        outcome: fixtureResults.outcome,
        score: fixtureResults.score,
      })
      .from(fixtureResults)
      .where(eq(fixtureResults.competitionId, competitionId)),
    db
      .select({
        id: fixtures.id,
        homeTeamId: fixtures.homeTeamId,
        awayTeamId: fixtures.awayTeamId,
      })
      .from(fixtures)
      .where(
        and(
          eq(fixtures.competitionId, competitionId),
          inArray(fixtures.status, ["in_progress", "completed"]),
        ),
      ),
  ]);

  const sides = new Map(playedFixtures.map((row) => [row.id, row]));
  const inputs: AnyResultInput[] = [];

  /*
   * THE LOBBIES, folded from their participants.
   *
   * A lobby's result is not in `fixture_results` — see `recordLobbyResult` —
   * so it is read straight off the squads. Only lobbies whose fixture is played
   * count, the same authority a duel result answers to, and only squads that
   * have actually been PLACED: a scheduled-but-unrecorded lobby would otherwise
   * award every squad the points for finishing nowhere.
   */
  const lobbyIds = playedFixtures.filter((row) => row.homeTeamId === null).map((row) => row.id);
  if (lobbyIds.length > 0) {
    const participants = await db
      .select({
        fixtureId: fixtureParticipants.fixtureId,
        teamId: fixtureParticipants.teamId,
        placement: fixtureParticipants.placement,
        score: fixtureParticipants.score,
      })
      .from(fixtureParticipants)
      .where(inArray(fixtureParticipants.fixtureId, lobbyIds));
    const byFixture = new Map<string, LobbyPlacement[]>();
    for (const row of participants) {
      if (row.placement === null) {
        continue;
      }
      const list = byFixture.get(row.fixtureId) ?? [];
      list.push({
        teamId: row.teamId,
        placement: row.placement,
        ...(row.score !== null ? { score: row.score } : {}),
      });
      byFixture.set(row.fixtureId, list);
    }
    for (const placements of byFixture.values()) {
      inputs.push({ placements });
    }
  }

  for (const result of resultRows) {
    const fixture = sides.get(result.fixtureId);
    if (fixture === undefined) {
      // A result whose fixture has been cancelled or rolled back to scheduled.
      // Excluded rather than counted: the fixture is the authority on whether
      // the match stands, and a stale result must not hold points open.
      continue;
    }
    if (fixture.homeTeamId === null || fixture.awayTeamId === null) {
      /*
       * A LOBBY. Its result is not a scoreline between two sides — it is a
       * placement per squad in `fixture_participants` — so there is nothing
       * here to fold into a duel. Skipped rather than coerced: inventing a
       * home and an away for twenty-five squads would put two of them in a
       * match that never happened.
       *
       * The lobby fold is `foldLobby`, and the read that feeds it lands with
       * the participant writer.
       */
      continue;
    }
    inputs.push({
      homeTeamId: fixture.homeTeamId,
      awayTeamId: fixture.awayTeamId,
      outcome: result.outcome,
      ...(result.score?.home !== undefined ? { homeScore: result.score.home } : {}),
      ...(result.score?.away !== undefined ? { awayScore: result.score.away } : {}),
    });
  }

  const names = new Map(teamRows.map((row) => [row.id, row.name]));
  const rows = buildStandings(
    teamRows.map((row) => row.id),
    inputs,
    standingsRulesOf(pack),
  ).map((row) => ({ ...row, teamName: names.get(row.teamId) ?? row.teamId }));

  return { rows, sport: pack, recorded: inputs.length, playable: playedFixtures.length };
}
