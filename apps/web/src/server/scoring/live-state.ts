import {
  isDeliveryState,
  isRaidState,
  isTimedState,
  isPlacementState,
  scoringPublicState,
  scoringStateMatchesSport,
  type ScoringState,
} from "./family-state";
import { initialsOf } from "@desiauction/core";
import {
  publicScorecard,
  publicCharts,
  overlayProjection,
  type OverlayProjection,
  type NameBook,
  type PublicScoringState as PublicLiveState,
  type PublicScorecard,
  type PublicCharts,
} from "@desiauction/core/scoring";
import {
  competitions,
  matches,
  matchLiveState,
  people,
  registrations,
  teams,
  type Db,
} from "@desiauction/db";
import { eq, sql } from "drizzle-orm";
import {
  publicPhotoUrl,
  shownName,
  shownPhotoKey,
  shownPhotoConsentAt,
} from "../competition/shown-name";
import { storage } from "../media";
import { publicName } from "./public-name";
import { resultDetailsFor, type PublicResultDetails } from "./result-details";

export interface LiveHistoryEntry {
  updatedAt: string;
  state: PublicLiveState;
  scorecard?: PublicScorecard;
  charts?: PublicCharts;
  resultDetails?: PublicResultDetails;
  overlay?: OverlayProjection;
}
export type StoredLiveState = PublicLiveState & {
  history: LiveHistoryEntry[];
  scorecard?: PublicScorecard;
  charts?: PublicCharts;
  resultDetails?: PublicResultDetails;
  overlay?: OverlayProjection;
};

function kolkataDay(value: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (key: string) => parts.find((item) => item.type === key)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
/** Scheduling CAS refuses changes after start; age never follows read time. */
export function matchAgeDate(kickoffAt: string | null, startedAt: Date | null): Date {
  const day = kickoffAt?.slice(0, 10) ?? (startedAt ? kolkataDay(startedAt) : null);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Match age date is missing");
  const date = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day)
    throw new Error("Match age date is invalid");
  return date;
}

export async function scoringNames(
  db: Db,
  competitionId: string,
  ageDate: Date,
): Promise<NameBook> {
  const [teamRows, players] = await Promise.all([
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.competitionId, competitionId)),
    db
      .select({
        id: registrations.id,
        name: shownName,
        dateOfBirth: registrations.dateOfBirth,
        adultConfirmedAt: registrations.adultConfirmedAt,
        photoKey: shownPhotoKey,
        photoConsentAt: shownPhotoConsentAt,
      })
      .from(registrations)
      .innerJoin(people, eq(people.id, registrations.personId))
      .where(eq(registrations.competitionId, competitionId)),
  ]);
  const names: NameBook = { teams: {}, players: {} };
  for (const team of teamRows)
    names.teams[team.id] = { ...team, initials: initialsOf(team.name) || "?" };
  const day = ageDate.toISOString().slice(0, 10);
  for (const row of players) {
    const shown = row.name ?? "Player";
    const { name, initials, minor } = publicName({ name: shown }, row, ageDate);
    const adultConfirmedAt =
      row.adultConfirmedAt && kolkataDay(row.adultConfirmedAt) <= day ? row.adultConfirmedAt : null;
    names.players[row.id] = {
      name,
      initials,
      photoUrl: minor
        ? null
        : publicPhotoUrl({ ...row, adultConfirmedAt }, ageDate, (key) => storage.readUrl(key)),
    };
  }
  return names;
}

function historyOf(raw: unknown): LiveHistoryEntry[] {
  if (!raw || typeof raw !== "object" || !("history" in raw) || !Array.isArray(raw.history))
    return [];
  return raw.history.filter((entry: unknown): entry is LiveHistoryEntry => {
    if (!entry || typeof entry !== "object" || !("updatedAt" in entry) || !("state" in entry))
      return false;
    return (
      typeof entry.updatedAt === "string" &&
      entry.state !== null &&
      typeof entry.state === "object" &&
      "seq" in entry.state &&
      typeof entry.state.seq === "number"
    );
  });
}

export async function writeLiveState(
  db: Db,
  input: {
    fixtureId: string;
    orgId: string;
    competitionId: string;
    kickoffAt: string | null;
    startedAt: Date | null;
    state: ScoringState;
    now: Date;
    phase?: PublicLiveState["phase"];
  },
): Promise<void> {
  const [competition] = await db
    .select({ sport: competitions.sport })
    .from(competitions)
    .where(eq(competitions.id, input.competitionId));
  if (!competition || !scoringStateMatchesSport(input.state, competition.sport))
    throw new Error("Snapshot season has no matching scoring engine");
  const names = await scoringNames(
    db,
    input.competitionId,
    matchAgeDate(input.kickoffAt, input.startedAt),
  );
  const [previous] = await db
    .select({ state: matchLiveState.state, updatedAt: matchLiveState.updatedAt })
    .from(matchLiveState)
    .where(eq(matchLiveState.fixtureId, input.fixtureId));
  // Nondecreasing representation time preserves the delay after a clock regression.
  // Match-lock serialization makes history insertion order authoritative for ties.
  const updatedAt = new Date(
    Math.max(input.now.getTime(), previous?.updatedAt.getTime() ?? input.now.getTime()),
  );
  const [match] = await db
    .select({ trust: matches.trustLevel })
    .from(matches)
    .where(eq(matches.fixtureId, input.fixtureId));
  if (!match) throw new Error("Snapshot match is missing");
  const state = {
    ...scoringPublicState(input.state, names),
    trust: match.trust,
    updatedAt: updatedAt.toISOString(),
    ...(input.phase ? { phase: input.phase } : {}),
  };
  let sidecars: Omit<LiveHistoryEntry, "state" | "updatedAt"> = {};
  if (isDeliveryState(input.state)) {
    const resultDetails = await resultDetailsFor(db, input.fixtureId, input.state, names);
    sidecars = {
      scorecard: publicScorecard(input.state, names),
      overlay: overlayProjection(input.state),
      charts: publicCharts(input.state, names),
      ...(resultDetails ? { resultDetails } : {}),
    };
  }
  if (isRaidState(input.state) || isTimedState(input.state) || isPlacementState(input.state)) {
    const resultDetails = await resultDetailsFor(db, input.fixtureId, input.state, names);
    sidecars = resultDetails ? { resultDetails } : {};
  }
  const history = [
    ...historyOf(previous?.state),
    {
      updatedAt: state.updatedAt,
      state,
      ...sidecars,
    },
  ].slice(-30);
  const stored: StoredLiveState = {
    ...state,
    ...sidecars,
    history,
  };
  await db
    .insert(matchLiveState)
    .values({
      fixtureId: input.fixtureId,
      orgId: input.orgId,
      competitionId: input.competitionId,
      seq: input.state.lastSeq,
      state: stored,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: matchLiveState.fixtureId,
      set: { seq: input.state.lastSeq, state: stored, updatedAt },
      setWhere: sql`${matchLiveState.orgId} = ${input.orgId} and ${matchLiveState.competitionId} = ${input.competitionId}`,
    });
}
