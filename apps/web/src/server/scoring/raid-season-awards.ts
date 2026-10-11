import {
  raidEngine,
  scoreKabaddi,
  kabaddiSeasonPlayers,
  pickKabaddiSeasonAwards,
  type KabaddiSeasonMatch,
} from "@desiauction/core/scoring";
import {
  auditLog,
  competitions,
  fixtures,
  fixtureResults,
  matches,
  matchEvents,
  matchAwards,
  newId,
  type Db,
} from "@desiauction/db";
import { and, eq, inArray, isNotNull, desc } from "drizzle-orm";
import { requireCompetitionCapability } from "../competition/authz";
import { persistedMatchEvent } from "./persisted-event";
import { replayScoringState, isRaidState } from "./family-state";
function durableOptions(raw: unknown): { bestN?: number } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !("kabaddiAwards" in raw)) return {};
  const options = raw.kabaddiAwards;
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new Error("Invalid durable kabaddi award options");
  if (!("bestN" in options)) return {};
  const bestN = options.bestN;
  if (typeof bestN !== "number" || !Number.isSafeInteger(bestN) || bestN < 1)
    throw new Error("Invalid durable kabaddi bestN");
  return { bestN };
}
export async function raidSeasonAwardComputation(db: Db, competitionId: string) {
  const [competition] = await db
    .select()
    .from(competitions)
    .where(eq(competitions.id, competitionId));
  if (competition?.sport !== "kabaddi") return null;
  const completed = await db
    .select({ fixture: fixtures, match: matches })
    .from(fixtures)
    .innerJoin(
      matches,
      and(
        eq(matches.fixtureId, fixtures.id),
        eq(matches.orgId, fixtures.orgId),
        eq(matches.competitionId, fixtures.competitionId),
      ),
    )
    .innerJoin(
      fixtureResults,
      and(
        eq(fixtureResults.fixtureId, fixtures.id),
        eq(fixtureResults.orgId, fixtures.orgId),
        eq(fixtureResults.competitionId, fixtures.competitionId),
      ),
    )
    .where(
      and(
        eq(fixtures.orgId, competition.orgId),
        eq(fixtures.competitionId, competitionId),
        eq(fixtures.status, "completed"),
        eq(fixtureResults.source, "scored"),
        inArray(matches.trustLevel, ["verified", "confirmed"]),
        isNotNull(matches.finishedAt),
        inArray(matches.phase, ["finished", "final", "no_result", "abandoned", "walkover"]),
      ),
    )
    .orderBy(fixtures.id)
    .for("share", { of: matches });
  const canonical: KabaddiSeasonMatch[] = [];
  for (const { fixture, match } of completed) {
    const rows = await db
      .select()
      .from(matchEvents)
      .where(
        and(
          eq(matchEvents.fixtureId, fixture.id),
          eq(matchEvents.orgId, competition.orgId),
          eq(matchEvents.competitionId, competitionId),
        ),
      )
      .orderBy(matchEvents.seq);
    const state = replayScoringState("kabaddi", rows.map(persistedMatchEvent));
    const key =
      match.format && typeof match.format === "object" && "key" in match.format
        ? match.format.key
        : null;
    if (
      !isRaidState(state) ||
      !state.finished ||
      !state.format ||
      state.lastSeq !== match.lastSeq ||
      state.attempt !== match.attempt ||
      state.format.key !== key ||
      match.awardVersion !== `kabaddi-v1/${state.format.key}`
    )
      throw new Error("Kabaddi season award revision is inconsistent");
    const lines = raidEngine.playerLines(state);
    canonical.push({
      fixtureId: fixture.id,
      completed: true,
      voided: false,
      trust: match.trustLevel,
      teamIds: [fixture.homeTeamId, fixture.awayTeamId].filter((id): id is string => id !== null),
      players: lines,
      scores: scoreKabaddi(lines),
    });
  }
  const players = kabaddiSeasonPlayers(canonical, durableOptions(competition.scoringRules));
  return {
    competition,
    players,
    picks: pickKabaddiSeasonAwards(players),
    matchCount: canonical.length,
  };
}
export async function persistRaidSeasonAwards(
  db: Db,
  competitionId: string,
  actorId: string,
  now: Date,
) {
  const computation = await raidSeasonAwardComputation(db, competitionId);
  if (!computation) return [];
  const { competition, picks } = computation;
  await requireCompetitionCapability(
    db,
    actorId,
    { orgId: competition.orgId, competitionId },
    "fixture.manage",
  );
  const stored = [];
  for (const kind of ["season_mvp", "best_raider", "best_defender"] as const) {
    const where = and(
      eq(matchAwards.orgId, competition.orgId),
      eq(matchAwards.competitionId, competitionId),
      eq(matchAwards.scope, "season"),
      eq(matchAwards.kind, kind),
    );
    const [override] = await db
      .select({ id: matchAwards.id })
      .from(matchAwards)
      .where(and(where, eq(matchAwards.source, "organizer")))
      .limit(1);
    if (override) continue;
    const [previous] = await db
      .select()
      .from(matchAwards)
      .where(where)
      .orderBy(desc(matchAwards.createdAt), desc(matchAwards.id))
      .limit(1);
    const pick = picks[kind],
      winner = pick?.registrationId ?? null,
      score = pick
        ? (kind === "best_raider"
            ? pick.raidPoints
            : kind === "best_defender"
              ? pick.tacklePoints
              : pick.points
          ).toFixed(2)
        : null;
    if (
      previous?.source === "auto" &&
      previous.computedRegistrationId === winner &&
      previous.winnerRegistrationId === winner &&
      previous.score === score
    )
      continue;
    const [row] = await db
      .insert(matchAwards)
      .values({
        id: newId(),
        fixtureId: null,
        orgId: competition.orgId,
        competitionId,
        scope: "season",
        kind,
        source: "auto",
        computedRegistrationId: winner,
        winnerRegistrationId: winner,
        score,
        actorPersonId: actorId,
        createdAt: new Date(
          Math.max(now.getTime(), previous ? previous.createdAt.getTime() + 1 : now.getTime()),
        ),
      })
      .returning();
    if (!row) throw new Error("Kabaddi season award was not stored");
    stored.push(row);
    await db.insert(auditLog).values({
      id: newId(),
      actor: actorId,
      action: "match.award.computed",
      scopeType: "org",
      scopeId: competition.orgId,
      subject: competitionId,
      meta: { awardId: row.id, scope: "season", kind, computedRegistrationId: winner, score },
      at: now,
    });
  }
  return stored;
}
