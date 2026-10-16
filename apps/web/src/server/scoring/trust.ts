import {
  computeTrust,
  detectPace,
  detectRallyPace,
  detectRaidPace,
  timedActivity,
  placementActivity,
  timedLiveMinimum,
  type TrustReason,
} from "@desiauction/core/scoring";
import {
  organizations,
  fixtures,
  matches,
  matchEvents,
  people,
  registrations,
  type Db,
} from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  appendTrustEvidence,
  effectiveTrustDecisions,
  historicalAuthority,
  sameTrustRevision,
  trustEvidence,
} from "./trust-ledger";
import {
  isRallyState,
  isRaidState,
  isTimedState,
  isPlacementState,
  isDeliveryState,
  scoringPlayerLines,
  type ScoringState,
} from "./family-state";
import { overlappingPlay, playWindow } from "./trust-facts";
import { writeLiveState } from "./live-state";
import { linkedTrustEvidence } from "./linked-trust-evidence";
import { SCORING_SYSTEM_ACTOR } from "./system-actor";

/** Caller holds the match lock; no elevated write and no award/result redispatch. */
export async function updateMatchTrust(
  db: Db,
  fixtureId: string,
  state: ScoringState,
  now: Date,
  options: { finalizedRevision?: boolean; refreshSnapshot?: boolean } = {},
) {
  const [match] = await db.select().from(matches).where(eq(matches.fixtureId, fixtureId));
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  if (!match || !fixture || match.attempt !== state.attempt || match.lastSeq !== state.lastSeq)
    throw new Error("Trust revision is inconsistent");
  const revision = { attempt: state.attempt, lastSeq: state.lastSeq };
  let evidence = await trustEvidence(db, fixture);
  let completion = evidence.find(
    (row) =>
      row.action === "match.trust.finalized_revision" && sameTrustRevision(row.meta, revision),
  );
  if (options.finalizedRevision && !completion) {
    await appendTrustEvidence(
      db,
      fixture,
      match.scorerPersonId ?? SCORING_SYSTEM_ACTOR,
      "match.trust.finalized_revision",
      revision,
      now,
    );
    evidence = await trustEvidence(db, fixture);
    completion = evidence.find(
      (row) =>
        row.action === "match.trust.finalized_revision" && sameTrustRevision(row.meta, revision),
    );
  }
  const rows = await db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.fixtureId, fixtureId))
    .orderBy(matchEvents.seq);
  const canonicalBalls = isRallyState(state)
    ? state.rallies
    : isRaidState(state)
      ? state.raids
      : isPlacementState(state)
        ? placementActivity(state)
        : isTimedState(state)
          ? timedActivity(state)
          : state.innings
              .flatMap((innings) => innings.overs.flatMap((over) => over.balls))
              .filter((ball) => ball.legal);
  const paceRecords = canonicalBalls.flatMap((ball) => {
    const receipt = rows.find(
      (row) => row.eventId === ball.eventId && row.attempt === state.attempt,
    );
    return receipt
      ? [
          {
            legal: true,
            clientRecordedAt: ball.clientRecordedAt,
            receivedAt: receipt.receivedAt.toISOString(),
          },
        ]
      : [];
  });
  const pace = isRallyState(state)
    ? detectRallyPace(paceRecords)
    : isRaidState(state) || isTimedState(state) || isPlacementState(state)
      ? detectRaidPace(paceRecords)
      : detectPace(paceRecords);
  const liveScored =
    paceRecords.length === canonicalBalls.length &&
    pace.liveScored &&
    (!isTimedState(state) || timedLiveMinimum(state));
  const authority = historicalAuthority(evidence, state.eventHistory);
  const linked = await linkedTrustEvidence(db, match, state, evidence);
  const decisions = effectiveTrustDecisions(linked, revision);
  const opposing =
    authority.representedTeamId === fixture.homeTeamId
      ? fixture.awayTeamId
      : authority.representedTeamId === fixture.awayTeamId
        ? fixture.homeTeamId
        : null;
  const opposingManagerConfirmed = isPlacementState(state)
    ? authority.complete &&
      authority.representedTeamId !== null &&
      state.teamIds.includes(authority.representedTeamId) &&
      state.teamIds
        .filter((id) => id !== authority.representedTeamId)
        .every((id) =>
          linked.some(
            (row) =>
              row.action === "match.trust.confirmation" &&
              sameTrustRevision(row.meta, revision) &&
              row.meta.teamId === id &&
              row.meta.verdict === "confirmed",
          ),
        )
    : opposing !== null &&
      linked.some(
        (row) =>
          row.action === "match.trust.confirmation" &&
          sameTrustRevision(row.meta, revision) &&
          row.meta.teamId === opposing &&
          row.meta.verdict === "confirmed",
      );
  const lines = scoringPlayerLines(state);
  const ids = [...lines.keys()];
  const players = ids.length
    ? await db
        .select({
          id: registrations.id,
          personId: registrations.personId,
          phone: people.phone,
          email: people.email,
        })
        .from(registrations)
        .innerJoin(people, eq(people.id, registrations.personId))
        .where(
          and(
            eq(registrations.orgId, fixture.orgId),
            eq(registrations.competitionId, fixture.competitionId),
            inArray(registrations.id, ids),
          ),
        )
    : [];
  const signals: TrustReason[] = [...pace.signals];
  const teamsByPerson = new Map<string, Set<string>>();
  for (const player of players) {
    const line = lines.get(player.id);
    if (!line) continue;
    const sides = teamsByPerson.get(player.personId) ?? new Set<string>();
    sides.add(line.teamId);
    teamsByPerson.set(player.personId, sides);
  }
  if ([...teamsByPerson.values()].some((sides) => sides.size > 1))
    signals.push("same_person_both_sides");
  const opposingTeams = isPlacementState(state)
    ? state.teamIds.filter((id) => id !== authority.representedTeamId)
    : opposing
      ? [opposing]
      : [];
  for (const opponentTeam of opposingTeams) {
    const opponent = players.filter((player) => lines.get(player.id)?.teamId === opponentTeam);
    if (opponent.length && opponent.every((player) => !player.phone && !player.email))
      signals.push("opponent_all_guests");
  }
  const scoringActors = new Set(
    state.eventHistory
      .filter((event) => event.attempt === state.attempt && event.type === "ball")
      .map((event) => event.actorPersonId),
  );
  for (const player of players) {
    if (!isDeliveryState(state)) break;
    const line = lines.get(player.id);
    if (!line || !scoringActors.has(player.personId)) continue;
    const teamRuns = state.innings
      .filter((innings) => !innings.superOver && innings.battingTeamId === line.teamId)
      .reduce((sum, innings) => sum + innings.runs, 0);
    if (teamRuns > 0 && (line.batting?.runs ?? 0) >= teamRuns * 0.5)
      signals.push("scorer_is_top_scorer");
  }
  if (await overlappingPlay(fixture, state, playWindow(state, rows, now), now))
    signals.push("overlapping_matches");
  const [organization] = await db
    .select({ kind: organizations.kind })
    .from(organizations)
    .where(eq(organizations.id, fixture.orgId));
  if (!organization) throw new Error("Trust organization is missing");
  const computed = computeTrust({
    authority: authority.authority,
    kind: organization.kind,
    confirmations: {
      organiserVerified: decisions.organiserVerified,
      opposingManagerConfirmed,
      disputed: decisions.disputed,
    },
    liveScored,
    viewerPeak: match.viewerPeak,
    finishedAt: completion?.at.toISOString() ?? null,
    now: now.toISOString(),
    signals,
  });
  const level = decisions.platformExcluded || decisions.manualHold ? "flagged" : computed.level;
  const changed =
    level !== match.trustLevel ||
    JSON.stringify(computed.reasons) !== JSON.stringify(match.trustReasons);
  if (changed) {
    await db
      .update(matches)
      .set({ trustLevel: level, trustReasons: computed.reasons, updatedAt: now })
      .where(eq(matches.fixtureId, fixtureId));
    if (options.refreshSnapshot)
      await writeLiveState(db, {
        fixtureId,
        orgId: match.orgId,
        competitionId: match.competitionId,
        kickoffAt: fixture.kickoffAt,
        startedAt: match.startedAt,
        state,
        phase: match.phase,
        now,
      });
  }
  return {
    level,
    reasons: computed.reasons,
    changed,
    authority,
    opposingTeamId: opposing,
    revision,
  };
}
