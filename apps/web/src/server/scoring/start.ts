import {
  parseBattingStyle,
  parseBowlingStyle,
  fixtureTransition,
  sportPack,
} from "@desiauction/core";
import {
  BATTING_HANDS,
  formatByKey,
  parseSeasonScoringRules,
  lobbyFormat,
  ReplayError,
  type Conditions,
  type EventPayloads,
  type MatchEvent,
  type RallyEventPayloads,
  type RaidEventPayloads,
  type TimedEventPayloads,
} from "@desiauction/core/scoring";
import {
  auditLog,
  competitions,
  fixtures,
  fixtureParticipants,
  matches,
  matchEvents,
  newId,
  registrations,
  type Db,
} from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { saveLineup } from "../competition/lineups";
import { authorityKind } from "./authority";
import { representedTeams, recordScoringAuthority } from "./trust-ledger";
import { syncAuctionOwnersToManagers } from "./managers";
import { scoringEngine, unsupportedScoringMessage } from "./engine";
import { replayScoringState } from "./family-state";
import { writeLiveState } from "./live-state";
import { scoringShareToken } from "./share-token";

export interface StartScoredMatchInput {
  deviceId: string;
  formatKey: string;
  conditions: Conditions;
  lineups: [EventPayloads["lineup_confirmed"], EventPayloads["lineup_confirmed"]];
}
export interface StartRallyMatchInput {
  deviceId: string;
  formatKey: string;
  conditions: Conditions;
  lineups: [RallyEventPayloads["lineup_confirmed"], RallyEventPayloads["lineup_confirmed"]];
}
export interface StartRaidMatchInput {
  deviceId: string;
  formatKey: string;
  conditions: Conditions;
  lineups: [RaidEventPayloads["lineup_confirmed"], RaidEventPayloads["lineup_confirmed"]];
}
export interface StartTimedMatchInput {
  deviceId: string;
  formatKey: string;
  conditions: Conditions;
  lineups: [TimedEventPayloads["lineup_confirmed"], TimedEventPayloads["lineup_confirmed"]];
}
const startSchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  formatKey: z.string().min(1),
  rounds: z.number().int().min(1).max(100).optional(),
  representedTeamId: z.string().optional(),
  conditions: z.custom<Conditions>(
    (value) => value !== null && typeof value === "object" && !Array.isArray(value),
  ),
  lineups: z
    .array(
      z.union([
        z
          .object({
            teamId: z.string().min(1),
            players: z.array(z.string().min(1)).min(1),
            startingActive: z.array(z.string().min(1)).min(1),
            roles: z.record(z.string(), z.string()).optional(),
          })
          .strict(),
        z
          .object({
            teamId: z.string().min(1),
            players: z.array(z.string().min(1)).min(7),
            startingMat: z.array(z.string().min(1)).length(7),
          })
          .strict(),
        z.object({
          teamId: z.string().min(1),
          battingOrder: z.array(z.string().min(1)),
          captainId: z.string().min(1),
          keeperId: z.string().min(1),
          substitutes: z.array(z.string().min(1)),
        }),
        z
          .object({ teamId: z.string().min(1), players: z.array(z.string().min(1)).min(1) })
          .strict(),
      ]),
    )
    .min(2)
    .max(25),
});
export type StartScoredMatchResult =
  | { ok: true; fixtureId: string; attempt: number; lastSeq: number; phase: string }
  | { ok: false; error: "bad_payload" | "forbidden" | "not_found"; message: string };
const refused = (
  error: "bad_payload" | "forbidden" | "not_found",
  message: string,
): StartScoredMatchResult => ({ ok: false, error, message });

/** One tenant transaction owns the fixture lock, validation, claim and all writes. */
export async function startScoredMatch(
  db: Db,
  fixtureId: string,
  actorId: string,
  rawInput: unknown,
): Promise<StartScoredMatchResult> {
  const parsed = startSchema.safeParse(rawInput);
  if (!parsed.success) return refused("bad_payload", "Check the match setup.");
  const input = parsed.data;
  const [identity] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  if (!identity) return refused("not_found", "Match not found.");
  // Provisioning advisory locks precede fixture and match locks.
  await syncAuctionOwnersToManagers(db, identity.competitionId, actorId);
  const [fixture] = await db
    .select()
    .from(fixtures)
    .where(eq(fixtures.id, fixtureId))
    .for("update");
  if (!fixture) throw new Error("Scoring fixture disappeared during setup");
  if (fixture.orgId !== identity.orgId || fixture.competitionId !== identity.competitionId)
    throw new Error("Scoring fixture identity changed during setup");
  const authority = await authorityKind(db, actorId, fixture);
  if (!authority) return refused("forbidden", "You cannot score this match.");
  const [competition] = await db
    .select()
    .from(competitions)
    .where(eq(competitions.id, fixture.competitionId));
  if (!competition) return refused("not_found", "Match not found.");
  const engine = scoringEngine(competition.sport);
  if (!engine) return refused("bad_payload", unsupportedScoringMessage(competition.sport));
  const [existing] = await db.select().from(matches).where(eq(matches.fixtureId, fixtureId));
  if (existing) {
    if (existing.scorerPersonId !== actorId)
      return refused("forbidden", "Another scorer holds this match.");
    return {
      ok: true,
      fixtureId,
      attempt: existing.attempt,
      lastSeq: existing.lastSeq,
      phase: existing.phase,
    };
  }
  const transition = fixtureTransition(fixture.status, { type: "start" });
  if (!transition.ok) return refused("bad_payload", "Publish the match first");

  const packScoring = sportPack(competition.sport)?.scoring;
  const placement = packScoring?.family === "placement";
  if (!placement && (!fixture.homeTeamId || !fixture.awayTeamId || input.lineups.length !== 2))
    return refused("bad_payload", "Choose both teams first.");
  const scheduled = placement
    ? await db
        .select({ teamId: fixtureParticipants.teamId, placement: fixtureParticipants.placement })
        .from(fixtureParticipants)
        .where(
          and(
            eq(fixtureParticipants.fixtureId, fixtureId),
            eq(fixtureParticipants.orgId, fixture.orgId),
            eq(fixtureParticipants.competitionId, fixture.competitionId),
          ),
        )
    : [];
  if (
    placement &&
    (scheduled.some((row) => row.placement !== null) ||
      scheduled.length !== input.lineups.length ||
      scheduled.some((row) => !input.lineups.some((side) => side.teamId === row.teamId)))
  )
    return refused("bad_payload", "Confirm every scheduled squad before scoring.");
  let representedTeamId: string | undefined;
  if (placement && authority === "d") {
    const candidates = await representedTeams(db, fixture, actorId);
    representedTeamId =
      input.representedTeamId ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!representedTeamId || !candidates.includes(representedTeamId))
      return refused("bad_payload", "Choose the squad you represent.");
  }
  const rally = packScoring?.family === "rally";
  const raid = packScoring?.family === "raid";
  const timed = packScoring?.family === "timed";
  if (
    input.lineups.some(
      (side) =>
        "players" in side !== (rally || raid || timed || placement) ||
        "startingMat" in side !== raid ||
        "startingActive" in side !== timed,
    )
  )
    return refused("bad_payload", "Check the match lineup format.");
  const format = placement
    ? lobbyFormat(
        input.rounds ?? 1,
        sportPack(competition.sport)?.standings.lobby ?? { placement: [], perScore: { kills: 1 } },
      )
    : rally || raid || timed
      ? packScoring.formats.find((value) => value.key === input.formatKey)
      : formatByKey(input.formatKey);
  if (!format) return refused("bad_payload", "Choose a supported match format.");
  if (
    new Set(input.lineups.map((side) => side.teamId)).size !== input.lineups.length ||
    (!placement &&
      (!input.lineups.some((side) => side.teamId === fixture.homeTeamId) ||
        !input.lineups.some((side) => side.teamId === fixture.awayTeamId)))
  )
    return refused("bad_payload", "Confirm both teams' lineups.");
  if (placement && input.formatKey !== `lobby_${String(input.rounds ?? 1)}`)
    return refused("bad_payload", "Choose a supported lobby format.");
  const now = new Date();
  const rules = parseSeasonScoringRules(competition.scoringRules);
  const started: MatchEvent<"match_started"> = {
    eventId: newId(),
    seq: 1,
    attempt: 1,
    type: "match_started",
    v: 1,
    payload:
      "rounds" in format
        ? { format, conditions: input.conditions, teamIds: scheduled.map((row) => row.teamId) }
        : "rubbers" in format
          ? {
              format,
              conditions: input.conditions,
              homeTeamId: fixture.homeTeamId as string,
              awayTeamId: fixture.awayTeamId as string,
            }
          : "periods" in format
            ? {
                format,
                conditions: input.conditions,
                homeTeamId: fixture.homeTeamId as string,
                awayTeamId: fixture.awayTeamId as string,
              }
            : "halves" in format
              ? {
                  format,
                  conditions: input.conditions,
                  homeTeamId: fixture.homeTeamId as string,
                  awayTeamId: fixture.awayTeamId as string,
                }
              : {
                  format,
                  conditions: input.conditions,
                  homeTeamId: fixture.homeTeamId as string,
                  awayTeamId: fixture.awayTeamId as string,
                  superOverTie: rules.superOverTie,
                },
    targetEventId: null,
    actorPersonId: actorId,
    clientSeq: 1,
    clientRecordedAt: now.toISOString(),
  };
  const events: MatchEvent[] = [
    started,
    ...input.lineups.map((payload, index): MatchEvent<"lineup_confirmed"> => ({
      eventId: newId(),
      seq: index + 2,
      attempt: 1,
      type: "lineup_confirmed",
      v: 1,
      payload,
      targetEventId: null,
      actorPersonId: actorId,
      clientSeq: index + 2,
      clientRecordedAt: now.toISOString(),
    })),
  ];
  const squadIds = (side: (typeof input.lineups)[number]) =>
    "players" in side ? side.players : [...side.battingOrder, ...side.substitutes];
  const allIds = input.lineups.flatMap(squadIds);
  if (new Set(allIds).size !== allIds.length)
    return refused("bad_payload", "Each player can appear only once.");
  const profiles: {
    id: string;
    battingStyle: string | null;
    bowlingStyle: string | null;
    role: string | null;
  }[] = [];
  for (const side of input.lineups) {
    const wanted = squadIds(side);
    const eligible = wanted.length
      ? await db
          .select({
            id: registrations.id,
            role: registrations.role,
            battingStyle: registrations.battingStyle,
            bowlingStyle: registrations.bowlingStyle,
          })
          .from(registrations)
          .where(
            and(
              inArray(registrations.id, wanted),
              eq(registrations.competitionId, fixture.competitionId),
              eq(registrations.orgId, fixture.orgId),
              eq(registrations.teamId, side.teamId),
              eq(registrations.status, "approved"),
            ),
          )
      : [];
    if (eligible.length !== wanted.length)
      return refused("bad_payload", "Every player must be approved for this team.");
    profiles.push(...eligible);
  }
  const seededStyles: { registrationId: string; eventId: string; source: string }[] = [];
  for (const profile of (rally || raid || timed || placement ? [] : profiles).sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const batting = parseBattingStyle(profile.battingStyle ?? "");
    const battingHand = BATTING_HANDS.find((hand) =>
      batting?.startsWith(parseBattingStyle(hand) ?? "!"),
    );
    const bowlingStyle = parseBowlingStyle(profile.bowlingStyle ?? "");
    if (!battingHand && !bowlingStyle) continue;
    const eventId = newId();
    const seq = events.length + 1;
    events.push({
      eventId,
      seq,
      attempt: 1,
      type: "style_set",
      v: 1,
      payload: {
        registrationId: profile.id,
        ...(battingHand ? { battingHand } : {}),
        ...(bowlingStyle ? { bowlingStyle } : {}),
      },
      targetEventId: null,
      actorPersonId: actorId,
      clientSeq: seq,
      clientRecordedAt: now.toISOString(),
    });
    seededStyles.push({ registrationId: profile.id, eventId, source: "registration_profile" });
  }
  if (timed) {
    const roles = Object.fromEntries(
      profiles
        .filter(
          (p) => p.role && sportPack(competition.sport)?.roles.values.some((r) => r.key === p.role),
        )
        .map((p) => [p.id, p.role as string]),
    );
    for (const [index, event] of events.entries())
      if (event.type === "lineup_confirmed" && "startingActive" in event.payload)
        events[index] = {
          ...event,
          payload: {
            ...event.payload,
            roles: Object.fromEntries(
              event.payload.players.flatMap((id) => (roles[id] ? [[id, roles[id]]] : [])),
            ),
          },
        } as MatchEvent;
  }
  let state;
  try {
    state = replayScoringState(competition.sport, events);
  } catch (error) {
    if (error instanceof ReplayError)
      return refused("bad_payload", "Check the match conditions and lineups.");
    throw error;
  }
  await db.insert(matches).values({
    fixtureId,
    orgId: fixture.orgId,
    competitionId: fixture.competitionId,
    format,
    conditions: input.conditions,
    awardVersion: placement
      ? `top-fragger-v1/${format.key}`
      : rally
        ? `unscored/rally/${format.key}`
        : raid
          ? `kabaddi-v1/${format.key}`
          : timed
            ? `${packScoring.awardTable === "unscored" ? "unscored/timed" : packScoring.awardTable}/${format.key}`
            : `cricket-v1/${format.key}`,
    phase: state.phase,
    scorerPersonId: actorId,
    scorerClaimedAt: now,
    scorerDeviceId: input.deviceId,
    shareToken: scoringShareToken(),
    lastSeq: state.lastSeq,
    startedAt: now,
    updatedAt: now,
  });
  for (const side of input.lineups) {
    const saved = await saveLineup(db, {
      competitionId: fixture.competitionId,
      orgId: fixture.orgId,
      fixtureId,
      teamId: side.teamId,
      registrationIds: "players" in side ? side.players : side.battingOrder,
      actorId,
    });
    if (!saved.ok) throw new Error("Validated scoring lineup could not be stored");
  }
  await db.insert(matchEvents).values(
    events.map((event) => ({
      ...event,
      fixtureId,
      orgId: fixture.orgId,
      competitionId: fixture.competitionId,
      clientRecordedAt: now,
      receivedAt: now,
    })),
  );
  await recordScoringAuthority(db, fixture, actorId, authority, events, now, representedTeamId);
  await db
    .update(fixtures)
    .set({ status: transition.next, startedAt: now })
    .where(eq(fixtures.id, fixtureId));
  await db.insert(auditLog).values({
    id: newId(),
    actor: actorId,
    action: "match.started",
    scopeType: "org",
    scopeId: fixture.orgId,
    subject: fixtureId,
    meta: { formatKey: format.key, deviceId: input.deviceId, seededStyles },
  });
  if (placement) {
    await writeLiveState(db, {
      fixtureId,
      orgId: fixture.orgId,
      competitionId: fixture.competitionId,
      kickoffAt: fixture.kickoffAt,
      startedAt: now,
      state,
      now,
    });
  }
  return { ok: true, fixtureId, attempt: 1, lastSeq: state.lastSeq, phase: state.phase };
}
