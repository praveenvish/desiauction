import { canonicalJson, sportPack } from "@desiauction/core";
import { scoringEngine, unsupportedScoringMessage } from "./engine";
import {
  isRallyState,
  isDeliveryState,
  isPlacementState,
  scoringPlayerLines,
  replayScoringState,
  type ScoringState,
} from "./family-state";
import { reminderBoundariesFor } from "./reminder-boundaries";
import {
  parseSeasonScoringRules,
  placementFormat,
  ReplayError,
  REJECT_MESSAGES,
  type MatchEvent,
  type EventPayloads,
  type RejectReason,
} from "@desiauction/core/scoring";
import {
  registrations,
  competitions,
  auditLog,
  newId,
  fixtures,
  fixtureParticipants,
  matchEvents,
  matches,
  withTenantDb,
  type DbHandle,
  type Db,
} from "@desiauction/db";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { finalizeScoredMatch, revalidateScoredMatch, type FinalizationEffect } from "./finalize";
import { authorityKind } from "./authority";
import { recordScoringAuthority } from "./trust-ledger";
import { updateMatchTrust } from "./trust";
import { matchAgeDate, scoringNames, writeLiveState } from "./live-state";
import { scoringCapacity } from "./rate";
import { cancelFixture } from "../competition/fixture-aggregate";
import { propagateScoringStyle } from "./styles";
import { persistedMatchEvent } from "./persisted-event";
export { persistedMatchEvent } from "./persisted-event";
import { recoverableTossDispatch } from "./toss-reminder-delivery";
import { recoverableResultDispatch } from "./result-notice-delivery";

export type ClientEvent = Omit<MatchEvent, "seq" | "actorPersonId">;
export interface EventAck {
  eventId: string;
  seq: number | null;
  status: "stored" | "duplicate" | "rejected";
  reason?: RejectReason;
  message?: string;
}
export type AppendResult =
  | {
      ok: true;
      acks: EventAck[];
      lastSeq: number;
      phase: string;
      finalized?: FinalizationEffect;
      voided?: FinalizationEffect;
      tossAccepted?: { orgId: string; fixtureId: string };
    }
  | {
      ok: false;
      error: "forbidden" | "not_found" | "bad_payload" | "wrong_attempt" | "rate_limited";
      message: string;
    };
const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const CLIENT_EVENT_TYPES = [
  "lobby_round",
  "period_started",
  "period_ended",
  "score",
  "card",
  "sub",
  "foul",
  "shootout_attempt",
  "half_started",
  "half_ended",
  "clock",
  "raid",
  "technical_point",
  "green_card",
  "yellow_card",
  "red_card",
  "rubber_started",
  "rally",
  "game_conceded",
  "rubber_conceded",
  "timeout",
  "match_started",
  "lineup_confirmed",
  "toss",
  "innings_started",
  "ball",
  "new_batter",
  "bowler_set",
  "strike_swapped",
  "retire",
  "resume_batting",
  "penalty_runs",
  "substitute",
  "player_added",
  "conditions_changed",
  "style_set",
  "interrupt",
  "resume",
  "revise",
  "innings_closed",
  "super_over_started",
  "abandon",
  "walkover",
  "restart",
  "match_voided",
  "void",
  "amend",
  "finish",
] as const satisfies readonly MatchEvent["type"][];
const batchSchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  attempt: z.number().int().min(1),
  events: z
    .array(
      z.object({
        eventId: ulid,
        attempt: z.number().int().min(1),
        type: z.enum(CLIENT_EVENT_TYPES),
        v: z.literal(1),
        payload: z.unknown(),
        targetEventId: ulid.nullable().default(null),
        clientSeq: z.number().int().min(1),
        clientRecordedAt: z.iso.datetime({ offset: true }),
      }),
    )
    .min(1)
    .max(50),
});

/** Caller owns a withTenantDb transaction; finish and result are atomic. */
export async function appendScoringEvents(
  db: Db,
  fixtureId: string,
  actorId: string,
  raw: unknown,
  now = new Date(),
): Promise<AppendResult> {
  const parsed = batchSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: "bad_payload", message: REJECT_MESSAGES.bad_payload };
  const input = parsed.data;
  const [match] = await db
    .select()
    .from(matches)
    .where(eq(matches.fixtureId, fixtureId))
    .for("update");
  if (!match) {
    const [unstarted] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
    if (unstarted && (await authorityKind(db, actorId, unstarted))) {
      const [season] = await db
        .select()
        .from(competitions)
        .where(eq(competitions.id, unstarted.competitionId));
      if (season && !scoringEngine(season.sport))
        return {
          ok: false,
          error: "bad_payload",
          message: unsupportedScoringMessage(season.sport),
        };
    }
    return { ok: false, error: "not_found", message: "Match not found." };
  }
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  if (!fixture) throw new Error("Scored fixture is missing");
  const authority = await authorityKind(db, actorId, fixture);
  if (!authority) return { ok: false, error: "forbidden", message: "You cannot score this match." };
  if (input.events.some((event) => event.type === "match_voided") && authority !== "a")
    return { ok: false, error: "forbidden", message: "Only an organiser can void the match." };
  // F09: once finished, a correction comes from the scorer who finished the
  // match or from an organiser — never from whoever holds the claim since.
  let correctsFinished = authority === "a";
  if (!correctsFinished && match.finishedAt !== null) {
    const [finisher] = await db
      .select({ actor: matchEvents.actorPersonId })
      .from(matchEvents)
      .where(
        and(eq(matchEvents.fixtureId, fixtureId), lte(matchEvents.receivedAt, match.finishedAt)),
      )
      .orderBy(desc(matchEvents.seq))
      .limit(1);
    correctsFinished = finisher?.actor === actorId;
  }
  const emptyStart =
    match.scorerPersonId === null &&
    match.lastSeq === 0 &&
    input.events[0]?.type === "match_started";
  if (!emptyStart && (match.scorerPersonId !== actorId || match.scorerDeviceId !== input.deviceId))
    return {
      ok: false,
      error: "forbidden",
      message: "Take the scoring claim on this device first.",
    };
  if (
    input.attempt !== match.attempt ||
    input.events.some((event) => event.attempt !== input.attempt)
  )
    return { ok: false, error: "wrong_attempt", message: REJECT_MESSAGES.wrong_attempt };
  const [competition] = await db
    .select()
    .from(competitions)
    .where(eq(competitions.id, match.competitionId));
  if (!competition) throw new Error("Scored season is missing");
  const engine = scoringEngine(competition.sport);
  if (!engine)
    return {
      ok: false,
      error: "bad_payload",
      message: unsupportedScoringMessage(competition.sport),
    };
  const rows = await db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.fixtureId, fixtureId))
    .orderBy(matchEvents.seq);
  if (rows.length !== match.lastSeq || rows.some((row, index) => row.seq !== index + 1))
    throw new Error("Scoring history and match sequence disagree; retry after recovery");
  let history = rows.map(persistedMatchEvent);
  let state: ScoringState;
  try {
    state = replayScoringState(competition.sport, history);
  } catch (error) {
    if (!(error instanceof ReplayError)) throw error;
    return {
      ok: false,
      error: "bad_payload",
      message: "Scoring history is unavailable. Retry after recovery.",
    };
  }
  const known = new Map(history.map((event) => [event.eventId, event.seq]));
  const wanted = new Set(
    input.events.filter((event) => !known.has(event.eventId)).map((event) => event.eventId),
  );
  if (wanted.size > (await scoringCapacity(db, fixtureId, now)))
    return {
      ok: false,
      error: "rate_limited",
      message: "Too many scoring entries. Wait a minute and retry.",
    };
  const rules = parseSeasonScoringRules(competition.scoringRules);
  const acks: EventAck[] = [];
  let skipped = false;
  let stored = 0;
  const acceptedEvents: MatchEvent[] = [];
  let needsFinalize = false;
  let tossAccepted = false;
  let voided: FinalizationEffect | undefined;
  for (const event of input.events) {
    if (skipped) {
      acks.push({
        eventId: event.eventId,
        seq: null,
        status: "rejected",
        reason: "bad_payload",
        message: "Skipped after an earlier refusal.",
      });
      continue;
    }
    const duplicate = known.get(event.eventId);
    if (duplicate !== undefined) {
      acks.push({ eventId: event.eventId, seq: duplicate, status: "duplicate" });
      continue;
    }
    const correction = event.type === "void" || event.type === "amend";
    let refusal: RejectReason | null = null;
    if (correction && (match.finishedAt !== null || match.phase === "final")) {
      if (
        !correctsFinished || match.phase === "final"
          ? authority !== "a"
          : match.finishedAt === null ||
            now.getTime() - match.finishedAt.getTime() > rules.editWindowHours * 3_600_000
      )
        refusal = "already_finished";
    }
    let candidate = {
      ...event,
      seq: (history.at(-1)?.seq ?? 0) + 1,
      actorPersonId: actorId,
    } as MatchEvent;
    if (!refusal && "family" in state && state.family === "timed") {
      let root =
        candidate.type === "amend"
          ? history.find((entry) => entry.eventId === candidate.targetEventId)
          : candidate;
      const seen = new Set<string>();
      while (root?.type === "amend" && root.targetEventId && !seen.has(root.eventId)) {
        seen.add(root.eventId);
        root = history.find((entry) => entry.eventId === root?.targetEventId);
      }
      const payload =
        candidate.type === "amend"
          ? (candidate.payload as { payload: unknown }).payload
          : candidate.payload;
      if (
        root?.type === "lineup_confirmed" &&
        payload &&
        typeof payload === "object" &&
        "startingActive" in payload &&
        "players" in payload &&
        Array.isArray(payload.players)
      ) {
        const ids = payload.players.filter((id): id is string => typeof id === "string");
        const profiles = ids.length
          ? await db
              .select({ id: registrations.id, role: registrations.role })
              .from(registrations)
              .where(
                and(
                  inArray(registrations.id, ids),
                  eq(registrations.orgId, match.orgId),
                  eq(registrations.competitionId, match.competitionId),
                  eq(registrations.status, "approved"),
                ),
              )
          : [];
        const frozen: Record<string, string | null> = {};
        for (const accepted of history)
          if (accepted.type === "lineup_confirmed" && "startingActive" in accepted.payload)
            for (const id of accepted.payload.players)
              if (!(id in frozen)) frozen[id] = accepted.payload.roles?.[id] ?? null;
        const roles = Object.fromEntries(
          ids.flatMap((id) => {
            const role = id in frozen ? frozen[id] : profiles.find((row) => row.id === id)?.role;
            return role &&
              sportPack(competition.sport)?.roles.values.some((value) => value.key === role)
              ? [[id, role]]
              : [];
          }),
        );
        const corrected = { ...payload, roles };
        candidate = {
          ...candidate,
          payload: candidate.type === "amend" ? { payload: corrected } : corrected,
        } as MatchEvent;
      }
    }
    let next = state;
    if (!refusal) {
      try {
        next = replayScoringState(competition.sport, [...history, candidate]);
      } catch (error) {
        if (!(error instanceof ReplayError)) throw error;
        refusal = error.reason;
      }
    }
    if (!refusal && isPlacementState(next)) {
      const scheduled = await db
        .select({ teamId: fixtureParticipants.teamId })
        .from(fixtureParticipants)
        .where(
          and(
            eq(fixtureParticipants.fixtureId, fixtureId),
            eq(fixtureParticipants.orgId, match.orgId),
            eq(fixtureParticipants.competitionId, match.competitionId),
          ),
        );
      if (
        next.teamIds.length !== scheduled.length ||
        scheduled.some((row) => !next.teamIds.includes(row.teamId)) ||
        (next.format &&
          JSON.stringify(next.format) !== JSON.stringify(placementFormat(match.format)))
      )
        refusal = "bad_payload";
    }
    if (
      !refusal &&
      !isPlacementState(next) &&
      next.teams &&
      (next.teams.home !== fixture.homeTeamId || next.teams.away !== fixture.awayTeamId)
    )
      refusal = "bad_payload";
    // Every attempt of a cricket match keeps the format frozen when scoring
    // started: a restart re-sends match_started and may not change it.
    if (
      !refusal &&
      isDeliveryState(next) &&
      candidate.type === "match_started" &&
      next.format &&
      canonicalJson(next.format) !== canonicalJson(match.format)
    )
      refusal = "bad_payload";
    if (
      !refusal &&
      (candidate.type === "rubber_started" ||
        candidate.type === "player_added" ||
        candidate.type === "match_started" ||
        candidate.type === "substitute" ||
        candidate.type === "sub" ||
        candidate.type === "lineup_confirmed" ||
        candidate.type === "amend")
    ) {
      // Every player the match can name must be an approved registration of
      // that team in this season, for every sport, cricket included.
      const wanted = isDeliveryState(next)
        ? Object.entries(next.lineups).flatMap(([teamId, lineup]) =>
            [...lineup.battingOrder, ...lineup.substitutes].map((id) => ({ id, teamId })),
          )
        : candidate.type === "lineup_confirmed" || candidate.type === "amend"
          ? Object.entries(next.squads).flatMap(([teamId, ids]) =>
              ids.map((id) => ({ id, teamId })),
            )
          : [...scoringPlayerLines(next)].map(([id, player]) => ({
              id,
              teamId: player.teamId,
            }));
      const eligible = wanted.length
        ? await db
            .select({ id: registrations.id, teamId: registrations.teamId })
            .from(registrations)
            .where(
              and(
                inArray(
                  registrations.id,
                  wanted.map((row) => row.id),
                ),
                eq(registrations.orgId, match.orgId),
                eq(registrations.competitionId, match.competitionId),
                eq(registrations.status, "approved"),
              ),
            )
        : [];
      if (
        wanted.some(
          (row) => !eligible.some((player) => player.id === row.id && player.teamId === row.teamId),
        )
      )
        refusal = "bad_payload";
    }
    if (refusal) {
      let message =
        isRallyState(state) && refusal === "innings_over"
          ? "This game is complete."
          : REJECT_MESSAGES[refusal];
      if (message.includes("{name}")) {
        const names = await scoringNames(
          db,
          match.competitionId,
          matchAgeDate(fixture.kickoffAt, match.startedAt),
        );
        const payload = event.payload;
        const bowlerId =
          payload &&
          typeof payload === "object" &&
          "bowlerId" in payload &&
          typeof payload.bowlerId === "string"
            ? payload.bowlerId
            : "";
        message = message
          .replace("{name}", names.players[bowlerId]?.name ?? "That bowler")
          .replace(
            "{n}",
            String(isDeliveryState(state) ? (state.format?.maxOversPerBowler ?? 0) : 0),
          );
      }
      if (message.includes("{extra}")) {
        const payload = event.payload;
        const extras =
          payload && typeof payload === "object" && "extras" in payload ? payload.extras : null;
        const wide = extras && typeof extras === "object" && "wides" in extras && extras.wides;
        message = message.replace("{extra}", wide ? "wide" : "no ball");
      }
      acks.push({
        eventId: event.eventId,
        seq: null,
        status: "rejected",
        reason: refusal,
        message,
      });
      skipped = true;
      continue;
    }
    const inserted = await db
      .insert(matchEvents)
      .values({
        ...candidate,
        fixtureId,
        orgId: match.orgId,
        competitionId: match.competitionId,
        clientRecordedAt: new Date(candidate.clientRecordedAt),
        receivedAt: now,
      })
      .onConflictDoNothing({ target: [matchEvents.fixtureId, matchEvents.eventId] })
      .returning({ seq: matchEvents.seq });
    if (inserted.length === 0)
      throw new Error("Unexpected event writer bypassed the match lock; retry");
    if (candidate.type === "match_voided") {
      const reason = (candidate.payload as EventPayloads["match_voided"]).reason;
      if (fixture.status !== "completed" && fixture.status !== "cancelled") {
        const cancelled = await cancelFixture(db, competition, fixtureId, actorId, reason);
        if (!cancelled.ok) throw new Error("Voided fixture could not be cancelled");
      }
      await db.insert(auditLog).values({
        id: newId(),
        actor: actorId,
        action: "match.voided",
        scopeType: "org",
        scopeId: match.orgId,
        subject: fixtureId,
        meta: {
          reason,
          eventId: candidate.eventId,
          attempt: candidate.attempt,
          seq: candidate.seq,
        },
        at: now,
      });
      voided = { fixtureId, slug: competition.slug };
    }
    if (candidate.type === "style_set")
      await propagateScoringStyle(
        db,
        { orgId: match.orgId, competitionId: match.competitionId, fixtureId, actorId },
        candidate.payload as EventPayloads["style_set"],
      );
    if (
      candidate.type === "finish" ||
      (isPlacementState(next) && candidate.type === "abandon") ||
      (correction && (match.finishedAt !== null || state.finished || match.phase === "final"))
    )
      needsFinalize = true;
    history = [...history, candidate];
    state = next;
    if (candidate.type === "toss") tossAccepted = true;
    acceptedEvents.push(candidate);
    stored += 1;
    known.set(candidate.eventId, candidate.seq);
    acks.push({ eventId: candidate.eventId, seq: candidate.seq, status: "stored" });
  }
  const phase =
    state.phase === "void"
      ? "void"
      : match.phase === "final" && state.attempt === match.attempt
        ? "final"
        : state.phase;
  let finalized: FinalizationEffect | undefined;
  if (stored > 0) {
    await recordScoringAuthority(db, fixture, actorId, authority, acceptedEvents, now);
    const finishedAt =
      state.phase === "void"
        ? match.finishedAt
        : state.finished
          ? (match.finishedAt ?? now)
          : state.attempt !== match.attempt
            ? null
            : match.finishedAt;
    await db
      .update(matches)
      .set({
        lastSeq: state.lastSeq,
        attempt: state.attempt,
        phase,
        finishedAt,
        updatedAt: now,
        ...(emptyStart
          ? {
              scorerPersonId: actorId,
              scorerDeviceId: input.deviceId,
              scorerClaimedAt: now,
              startedAt: now,
            }
          : {}),
      })
      .where(eq(matches.fixtureId, fixtureId));
    if (needsFinalize && state.phase !== "void")
      finalized = await finalizeScoredMatch(db, fixtureId, actorId, state, now);
    else if (state.finished && state.phase !== "void")
      await updateMatchTrust(db, fixtureId, state, now, { finalizedRevision: true });
    await writeLiveState(db, {
      fixtureId,
      orgId: match.orgId,
      competitionId: match.competitionId,
      kickoffAt: fixture.kickoffAt,
      startedAt: match.startedAt ?? (emptyStart ? now : null),
      state,
      now,
      phase,
    });
    await db.execute(
      sql`select pg_notify('match_live', ${fixtureId + ":" + String(state.lastSeq)})`,
    );
  }
  return {
    ok: true,
    acks,
    lastSeq: history.at(-1)?.seq ?? 0,
    phase,
    ...(finalized ? { finalized } : {}),
    ...(voided ? { voided } : {}),
    ...(tossAccepted ? { tossAccepted: { orgId: fixture.orgId, fixtureId } } : {}),
  };
}

/** HTTP/application boundary: no page invalidation can run before commit. */
export async function appendScoringRequest(
  handle: DbHandle,
  context: { personId: string; orgId: string },
  fixtureId: string,
  raw: unknown,
  now = new Date(),
) {
  const result = await withTenantDb(handle, context, (db) =>
    appendScoringEvents(db, fixtureId, context.personId, raw, now),
  );
  if (!result.ok) return result;
  const { finalized, voided, tossAccepted, ...response } = result;
  if (finalized) {
    revalidateScoredMatch(finalized);
    await recoverableResultDispatch(context.orgId, fixtureId, reminderBoundariesFor(handle));
  }
  if (voided) revalidateScoredMatch(voided);
  if (tossAccepted)
    await recoverableTossDispatch(tossAccepted.orgId, fixtureId, reminderBoundariesFor(handle));
  return response;
}
