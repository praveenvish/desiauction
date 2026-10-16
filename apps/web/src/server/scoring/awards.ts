import { persistPlacementAward } from "./placement-awards";
import { isPlacementState, isRaidState, isTimedState, replayScoringState } from "./family-state";
import { sportPack } from "@desiauction/core";
import { eligibleSeasonScorers } from "../insights/scorers";
import {
  deriveResult,
  raidEngine,
  timedEngine,
  scoreTimed,
  pickTimedMatchAwards,
  type TimedState,
  type PlacementState,
  placementPlayers,
  RAID_FORMAT_PRESETS,
  scoreKabaddi,
  pickKabaddiMatchAwards,
  type RaidState,
  formatByKey,
  pickMatchAwards,
  playerLines,
  scoreMatch,
  type MatchState,
} from "@desiauction/core/scoring";
import {
  auditLog,
  competitions,
  fixtures,
  fixtureResults,
  matchAwards,
  matches,
  matchEvents,
  matchPlayerLines,
  newId,
  registrations,
  type Db,
  type DbHandle,
  withTenantDb,
} from "@desiauction/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireCompetitionCapability } from "../competition/authz";
import { persistedMatchEvent } from "./persisted-event";
import { writeLiveState } from "./live-state";
import { recoverableResultDispatch } from "./result-notice-delivery";
import { reminderBoundariesFor } from "./reminder-boundaries";
import { revalidatePath } from "next/cache";

const MATCH_KINDS = ["player_of_match", "fighter_of_match", "top_fragger"] as const;
const SEASON_KINDS = [
  "season_mvp",
  "best_raider",
  "best_defender",
  "best_batter",
  "best_bowler",
  "best_fielder",
  "best_keeper",
  "emerging",
  "scorer_of_season",
] as const;
export type AwardKind = (typeof MATCH_KINDS)[number] | (typeof SEASON_KINDS)[number];
export type AwardAddress =
  { fixtureId: string; competitionId?: never } | { competitionId: string; fixtureId?: never };
export type AwardOverrideInput = AwardAddress & { reason: string } & (
    | { kind: Exclude<AwardKind, "scorer_of_season">; registrationId: string; personId?: never }
    | { kind: "scorer_of_season"; personId: string; registrationId?: never }
  );
type AwardRow = typeof matchAwards.$inferSelect;
const currentOrder = [desc(matchAwards.createdAt), desc(matchAwards.id)];
function addressWhere(address: AwardAddress, kind: string) {
  return "fixtureId" in address
    ? and(
        eq(matchAwards.scope, "match"),
        eq(matchAwards.fixtureId, address.fixtureId),
        eq(matchAwards.kind, kind),
      )
    : and(
        eq(matchAwards.scope, "season"),
        isNull(matchAwards.fixtureId),
        eq(matchAwards.competitionId, address.competitionId),
        eq(matchAwards.kind, kind),
      );
}
/** Caller is inside a tenant transaction; match/competition mutations serialize this lookup. */
export async function currentAward(
  db: Db,
  address: AwardAddress,
  kind: AwardKind,
): Promise<AwardRow | null> {
  const [row] = await db
    .select()
    .from(matchAwards)
    .where(addressWhere(address, kind))
    .orderBy(...currentOrder)
    .limit(1);
  return row ?? null;
}
function insertionTime(now: Date, previous: AwardRow | null): Date {
  return new Date(
    Math.max(now.getTime(), previous ? previous.createdAt.getTime() + 1 : now.getTime()),
  );
}
/** Rebuildable projection and append-only picks, under the append boundary's match lock. */
export async function persistFinalizedLinesAndAwards(
  db: Db,
  fixture: { id: string; orgId: string; competitionId: string },
  sport: string,
  actorId: string,
  state: MatchState | RaidState | TimedState | PlacementState,
  now: Date,
): Promise<void> {
  if (isPlacementState(state)) return persistPlacementAward(db, fixture, actorId, state, now);
  const [match] = await db.select().from(matches).where(eq(matches.fixtureId, fixture.id));
  const raid = isRaidState(state),
    timed = isTimedState(state),
    scoring = sportPack(sport)?.scoring;
  const frozenKey = (match?.format as { key?: unknown } | undefined)?.key;
  if (
    !match ||
    typeof frozenKey !== "string" ||
    !(timed
      ? scoring?.family === "timed" && scoring.formats.some((format) => format.key === frozenKey)
      : raid
        ? Object.values(RAID_FORMAT_PRESETS).some((format) => format.key === frozenKey)
        : formatByKey(frozenKey)) ||
    state.format?.key !== frozenKey ||
    match.awardVersion !==
      `${timed && scoring?.family === "timed" ? (scoring.awardTable === "unscored" ? "unscored/timed" : scoring.awardTable) : raid ? "kabaddi-v1" : "cricket-v1"}/${frozenKey}`
  ) {
    throw new Error("Unsupported or inconsistent frozen award configuration");
  }
  if (timed && scoring?.family === "timed" && scoring.awardTable === "unscored") return;
  const lines = isTimedState(state)
    ? timedEngine.playerLines(state)
    : isRaidState(state)
      ? raidEngine.playerLines(state)
      : playerLines(state);
  const points = isTimedState(state)
    ? scoreTimed(lines, state)
    : isRaidState(state)
      ? scoreKabaddi(lines)
      : scoreMatch(lines, state, frozenKey);
  const candidates = [...lines.values()].map((line) => {
    const score = points.get(line.registrationId);
    if (!score) throw new Error("Canonical player has no award score");
    return {
      registrationId: line.registrationId,
      teamId: line.teamId,
      points: score.points,
      lines: score.lines,
    };
  });
  await db.delete(matchPlayerLines).where(eq(matchPlayerLines.fixtureId, fixture.id));
  if (candidates.length > 0) {
    await db.insert(matchPlayerLines).values(
      candidates.map((candidate) => ({
        fixtureId: fixture.id,
        registrationId: candidate.registrationId,
        orgId: fixture.orgId,
        competitionId: fixture.competitionId,
        teamId: candidate.teamId,
        sport,
        formatKey: frozenKey,
        conditions: state.conditions,
        stats: lines.get(candidate.registrationId),
        points: candidate.points.toFixed(2),
        pointsLines: candidate.lines,
        trustLevel: match.trustLevel,
        createdAt: now,
      })),
    );
  }
  const picks = isTimedState(state)
    ? pickTimedMatchAwards(candidates, timedEngine.deriveResult(state))
    : isRaidState(state)
      ? pickKabaddiMatchAwards(candidates, raidEngine.deriveResult(state))
      : pickMatchAwards(candidates, deriveResult(state));
  for (const kind of ["player_of_match", "fighter_of_match"] as const) {
    const where = addressWhere({ fixtureId: fixture.id }, kind);
    const [override] = await db
      .select({ id: matchAwards.id })
      .from(matchAwards)
      .where(and(where, eq(matchAwards.source, "organizer")))
      .limit(1);
    if (override) continue;
    const previous = await currentAward(db, { fixtureId: fixture.id }, kind);
    const pick = picks[kind];
    const winner = pick?.registrationId ?? null;
    const score = pick?.points.toFixed(2) ?? null;
    if (
      previous?.source === "auto" &&
      previous.computedRegistrationId === winner &&
      previous.winnerRegistrationId === winner &&
      previous.score === score
    )
      continue;
    await db.insert(matchAwards).values({
      id: newId(),
      fixtureId: fixture.id,
      orgId: fixture.orgId,
      competitionId: fixture.competitionId,
      scope: "match",
      kind,
      computedRegistrationId: winner,
      winnerRegistrationId: winner,
      source: "auto",
      score,
      actorPersonId: actorId,
      createdAt: insertionTime(now, previous),
    });
  }
}

/** Organiser mutation; callers supply their existing withTenantDb transaction. */
export async function overrideAward(
  db: Db,
  input: AwardOverrideInput & { actorId: string },
  now = new Date(),
): Promise<AwardRow> {
  const fixtureId = input.fixtureId;
  const competitionId = input.competitionId;
  if ((fixtureId === undefined) === (competitionId === undefined))
    throw new Error("Exactly one award address is required");
  if (
    (fixtureId !== undefined && fixtureId.length !== 26) ||
    (competitionId !== undefined && competitionId.length !== 26)
  )
    throw new Error("Invalid award address");
  const reason = input.reason.trim();
  if (!reason) throw new Error("An award override needs a reason");
  let scope: "match" | "season";
  let orgId: string;
  let resolvedCompetitionId: string;
  let chosenScore: string | null = null;
  if (fixtureId) {
    if (input.kind === "scorer_of_season") throw new Error("Invalid match award kind");
    if (!(MATCH_KINDS as readonly string[]).includes(input.kind))
      throw new Error("Invalid match award kind");
    const [match] = await db
      .select()
      .from(matches)
      .where(eq(matches.fixtureId, fixtureId))
      .for("update");
    if (match?.awardVersion.startsWith("unscored/"))
      throw new Error("Player awards are unavailable for rally scoring");
    if (!match || match.phase === "void" || !match.finishedAt)
      throw new Error("A finalized nonvoid match is required");
    const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
    if (
      !fixture ||
      fixture.status !== "completed" ||
      fixture.competitionId !== match.competitionId ||
      fixture.orgId !== match.orgId
    )
      throw new Error("Award fixture is inconsistent");
    orgId = fixture.orgId;
    resolvedCompetitionId = fixture.competitionId;
    await requireCompetitionCapability(
      db,
      input.actorId,
      { orgId, competitionId: resolvedCompetitionId },
      "fixture.manage",
    );
    if (match.awardVersion.startsWith("top-fragger-v1/")) {
      if (input.kind !== "top_fragger")
        throw new Error("Only top fragger is available for lobby scoring");
      const [season] = await db
        .select({ sport: competitions.sport })
        .from(competitions)
        .where(eq(competitions.id, fixture.competitionId));
      const rows = await db
        .select()
        .from(matchEvents)
        .where(eq(matchEvents.fixtureId, fixtureId))
        .orderBy(matchEvents.seq);
      if (!season) throw new Error("Award season is missing");
      const state = replayScoringState(season.sport, rows.map(persistedMatchEvent));
      if (
        !isPlacementState(state) ||
        !state.finished ||
        state.terminal ||
        state.lastSeq !== match.lastSeq ||
        state.attempt !== match.attempt
      )
        throw new Error("A finalized scored lobby is required");
      const candidate = placementPlayers(state).get(input.registrationId);
      if (!candidate) throw new Error("Winner must be a canonical match participant");
      chosenScore = String(candidate.kills);
    } else {
      if (input.kind === "top_fragger")
        throw new Error("Top fragger is available only for lobby scoring");
      const [result] = await db
        .select({ fixtureId: fixtureResults.fixtureId })
        .from(fixtureResults)
        .where(
          and(
            eq(fixtureResults.fixtureId, fixtureId),
            eq(fixtureResults.orgId, orgId),
            eq(fixtureResults.competitionId, resolvedCompetitionId),
            eq(fixtureResults.source, "scored"),
          ),
        );
      if (!result) throw new Error("A finalized scored result is required");
      const [candidate] = await db
        .select()
        .from(matchPlayerLines)
        .where(
          and(
            eq(matchPlayerLines.fixtureId, fixtureId),
            eq(matchPlayerLines.registrationId, input.registrationId),
            eq(matchPlayerLines.orgId, orgId),
            eq(matchPlayerLines.competitionId, resolvedCompetitionId),
          ),
        );
      if (!candidate) throw new Error("Winner must be a canonical match participant");
      chosenScore = candidate.points;
    }
    scope = "match";
  } else {
    if (competitionId === undefined) throw new Error("Award season is missing");
    if (!(SEASON_KINDS as readonly string[]).includes(input.kind))
      throw new Error("Invalid season award kind");
    const [competition] = await db
      .select()
      .from(competitions)
      .where(eq(competitions.id, competitionId))
      .for("update");
    if (!competition) throw new Error("Award season is missing");
    if (
      ["rally", "timed", "placement"].includes(sportPack(competition.sport)?.scoring?.family ?? "")
    )
      throw new Error("Player awards are unavailable for rally scoring");
    if (
      competition.sport === "kabaddi"
        ? !["season_mvp", "best_raider", "best_defender"].includes(input.kind)
        : ["best_raider", "best_defender"].includes(input.kind)
    )
      throw new Error("Unsupported award kind for this sport");
    orgId = competition.orgId;
    resolvedCompetitionId = competition.id;
    await requireCompetitionCapability(
      db,
      input.actorId,
      { orgId, competitionId: resolvedCompetitionId },
      "fixture.manage",
    );
    scope = "season";
  }
  if (input.kind === "scorer_of_season") {
    const scorer = (await eligibleSeasonScorers(db, resolvedCompetitionId)).find(
      (row) => row.personId === input.personId,
    );
    if (!scorer)
      throw new Error("Winner must have eligible scoring participation in the award season");
    chosenScore = scorer.completedVerifiedMatches.toFixed(2);
  } else {
    const [registration] = await db
      .select({ id: registrations.id })
      .from(registrations)
      .where(
        and(
          eq(registrations.id, input.registrationId),
          eq(registrations.competitionId, resolvedCompetitionId),
          eq(registrations.orgId, orgId),
        ),
      );
    if (!registration) throw new Error("Winner must belong to the award season");
  }
  const address: AwardAddress = fixtureId
    ? { fixtureId }
    : { competitionId: resolvedCompetitionId };
  const previous = await currentAward(db, address, input.kind);
  const [computed] = await db
    .select()
    .from(matchAwards)
    .where(and(addressWhere(address, input.kind), eq(matchAwards.source, "auto")))
    .orderBy(...currentOrder)
    .limit(1);
  const [row] = await db
    .insert(matchAwards)
    .values({
      id: newId(),
      fixtureId: fixtureId ?? null,
      orgId,
      competitionId: resolvedCompetitionId,
      scope,
      kind: input.kind,
      computedRegistrationId:
        input.kind === "scorer_of_season" ? null : (computed?.computedRegistrationId ?? null),
      winnerRegistrationId: input.kind === "scorer_of_season" ? null : input.registrationId,
      computedPersonId:
        input.kind === "scorer_of_season" ? (computed?.computedPersonId ?? null) : null,
      winnerPersonId: input.kind === "scorer_of_season" ? input.personId : null,
      source: "organizer",
      reason,
      score: chosenScore,
      actorPersonId: input.actorId,
      createdAt: insertionTime(now, previous),
    })
    .returning();
  if (!row) throw new Error("Award override was not stored");
  await db.insert(auditLog).values({
    id: newId(),
    actor: input.actorId,
    action: "match.award.overridden",
    scopeType: "org",
    scopeId: orgId,
    subject: fixtureId ?? resolvedCompetitionId,
    meta: {
      awardId: row.id,
      kind: input.kind,
      scope,
      winnerRegistrationId: row.winnerRegistrationId,
      computedRegistrationId: row.computedRegistrationId,
      winnerPersonId: row.winnerPersonId,
      computedPersonId: row.computedPersonId,
      reason,
    },
    at: now,
  });
  if (fixtureId) {
    const [match] = await db.select().from(matches).where(eq(matches.fixtureId, fixtureId));
    const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
    if (!match || !fixture) throw new Error("Award match disappeared");
    const events = await db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.fixtureId, fixtureId))
      .orderBy(matchEvents.seq);
    const [season] = await db
      .select({ sport: competitions.sport })
      .from(competitions)
      .where(eq(competitions.id, fixture.competitionId));
    if (!season) throw new Error("Award season is missing");
    const state = replayScoringState(season.sport, events.map(persistedMatchEvent));
    if (
      state.lastSeq !== match.lastSeq ||
      state.attempt !== match.attempt ||
      !state.finished ||
      state.phase === "void"
    )
      throw new Error("Award revision is inconsistent");
    await writeLiveState(db, {
      fixtureId,
      orgId,
      competitionId: resolvedCompetitionId,
      kickoffAt: fixture.kickoffAt,
      startedAt: match.startedAt,
      state,
      now,
      phase: match.phase === "final" ? "final" : state.phase,
    });
  }
  return row;
}

/** Application boundary: no notification or page refresh runs before the override commits. */
export async function overrideAwardRequest(
  handle: DbHandle,
  context: { personId: string; orgId: string },
  input: AwardOverrideInput,
  now = new Date(),
) {
  const result = await withTenantDb(handle, context, async (db) => {
    const row = await overrideAward(db, { ...input, actorId: context.personId }, now);
    const [season] = await db
      .select({ slug: competitions.slug })
      .from(competitions)
      .where(eq(competitions.id, row.competitionId));
    return { row, slug: season?.slug };
  });
  if (result.slug) revalidatePath(`/c/${result.slug}`);
  if (result.row.fixtureId)
    await recoverableResultDispatch(
      context.orgId,
      result.row.fixtureId,
      reminderBoundariesFor(handle),
    );
  return result.row;
}
