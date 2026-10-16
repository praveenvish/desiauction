import { placementPlayers, publicCharts, timedSport } from "@desiauction/core/scoring";
import type {
  AwardLine,
  MatchState,
  RaidState,
  TimedState,
  PlacementState,
  NameBook,
  PlayerLine,
} from "@desiauction/core/scoring";
import { matchAwards, matchPlayerLines, type Db } from "@desiauction/db";
import { and, desc, eq } from "drizzle-orm";

export interface PublicMatchAward {
  kind: "player_of_match" | "fighter_of_match" | "top_fragger";
  name: string;
  initials: string;
  photoUrl: string | null;
  teamId: string;
  figures: string;
  points: number;
  lines: AwardLine[];
  source: "auto" | "organizer" | "fans";
  computedName: string | null;
  shots: { angle: number; runs: number }[];
}
export interface PublicResultDetails {
  v: 1;
  seq: number;
  revision: string;
  awards: PublicMatchAward[];
}
export function playerFigures(line: PlayerLine): string {
  if (line.placement) return `${String(line.placement.kills)} kills`;
  if (line.timed)
    return `${String(line.timed.points)} points · ${String(line.timed.goals)} goals · ${String(line.timed.assists)} assists`;
  if (line.raid)
    return `${String(line.raid.raidPoints)} raid points · ${String(line.raid.tacklePoints)} tackle points`;
  const parts: string[] = [];
  if (line.batting)
    parts.push(
      `${String(line.batting.runs)}${line.batting.notOut ? "*" : ""} (${String(line.batting.balls)})`,
    );
  if (line.bowling && line.bowling.legalBalls > 0)
    parts.push(`${String(line.bowling.wickets)} for ${String(line.bowling.runs)}`);
  return parts.join(" · ") || "Match participant";
}
/** Called after FIN-1 projection writes, within the same locked tenant transaction. */
export async function resultDetailsFor(
  db: Db,
  fixtureId: string,
  state: MatchState | RaidState | TimedState | PlacementState,
  names: NameBook,
): Promise<PublicResultDetails | undefined> {
  if (!state.finished || state.phase === "void") return undefined;
  const rows = await db
    .select()
    .from(matchAwards)
    .where(and(eq(matchAwards.fixtureId, fixtureId), eq(matchAwards.scope, "match")))
    .orderBy(desc(matchAwards.createdAt), desc(matchAwards.id));
  if ("family" in state && state.family === "placement") {
    const row = rows.find((x) => x.kind === "top_fragger"),
      id = row?.winnerRegistrationId;
    const player = id ? placementPlayers(state).get(id) : null,
      identity = id ? names.players[id] : null;
    if (!row || !identity || !player)
      return { v: 1, seq: state.lastSeq, revision: row?.id ?? "", awards: [] };
    return {
      v: 1,
      seq: state.lastSeq,
      revision: row.id,
      awards: [
        {
          kind: "top_fragger",
          name: identity.name,
          initials: identity.initials,
          photoUrl: identity.photoUrl,
          teamId: player.teamId,
          figures: `${String(player.kills)} kills`,
          points: player.kills,
          lines: [],
          source: row.source,
          computedName: row.computedRegistrationId
            ? (names.players[row.computedRegistrationId]?.name ?? null)
            : null,
          shots: [],
        },
      ],
    };
  }
  const lines = await db
    .select()
    .from(matchPlayerLines)
    .where(eq(matchPlayerLines.fixtureId, fixtureId));
  const awards: PublicMatchAward[] = [];
  const revisions: string[] = [];
  for (const kind of ["player_of_match", "fighter_of_match"] as const) {
    const row = rows.find((award) => award.kind === kind);
    if (!row) continue;
    revisions.push(row.id);
    const registrationId = row.winnerRegistrationId;
    if (!registrationId) continue;
    const candidate = lines.find((line) => line.registrationId === registrationId);
    const identity = names.players[registrationId];
    if (!candidate || !identity) continue;
    const stats = candidate.stats as PlayerLine;
    const points = Number(candidate.points);
    if (!Number.isFinite(points)) throw new Error("Award points are invalid");
    const explanation = candidate.pointsLines as AwardLine[];
    const computedName = row.computedRegistrationId
      ? (names.players[row.computedRegistrationId]?.name ?? null)
      : null;
    awards.push({
      kind,
      name: identity.name,
      initials: identity.initials,
      photoUrl: identity.photoUrl ?? null,
      teamId: candidate.teamId,
      figures:
        stats.timed && "family" in state && state.family === "timed" && state.format
          ? timedSport(state.format) === "basketball"
            ? `${String(stats.timed.points)} points · ${String(stats.timed.fouls)} fouls`
            : `${String(stats.timed.goals)} goals · ${String(stats.timed.assists)} assists`
          : playerFigures(stats),
      points,
      lines: explanation.map(({ code, label, qty, points }) => ({ code, label, qty, points })),
      source: row.source,
      computedName,
      shots:
        "family" in state
          ? []
          : publicCharts(state, names).innings.flatMap((innings) =>
              innings.shots
                .filter((shot) => shot.batterId === registrationId)
                .map(({ angle, runs }) => ({ angle, runs })),
            ),
    });
  }
  return { v: 1, seq: state.lastSeq, revision: revisions.join("-"), awards };
}
/** Explicit fields keep arbitrary stored keys out of anonymous responses. */
export function resultDetailsProjection(details: PublicResultDetails): PublicResultDetails {
  return {
    v: 1,
    seq: details.seq,
    revision: details.revision,
    awards: details.awards.map(
      ({
        kind,
        name,
        initials,
        photoUrl,
        teamId,
        figures,
        points,
        lines,
        source,
        computedName,
        shots,
      }) => ({
        kind,
        name,
        initials,
        photoUrl,
        teamId,
        figures,
        points,
        source,
        computedName,
        lines: lines.map(({ code, label, qty, points }) => ({ code, label, qty, points })),
        shots: shots.map(({ angle, runs }) => ({ angle, runs })),
      }),
    ),
  };
}
