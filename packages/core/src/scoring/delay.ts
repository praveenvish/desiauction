import { publicFamilyPanel } from "./panels";
import type { ScoringFamily, PublicScoringState, PublicLiveState } from "./types";
export function publicLiveProjection(
  state: PublicScoringState,
  trustedFamily?: ScoringFamily,
): PublicScoringState | null {
  const envelope = publicFamilyPanel(state, trustedFamily);
  if (!envelope) return null;
  if (envelope.family === "placement") {
    if (!Array.isArray(state.teams)) return null;
    return {
      ...envelope,
      v: state.v,
      seq: state.seq,
      phase: state.phase,
      updatedAt: state.updatedAt,
      lastBallAt: null,
      teams: state.teams.map(({ id, name, initials }) => ({ id, name, initials })),
      tossLine: null,
      conditionsLine: state.conditionsLine,
      innings: [],
      situation: state.situation,
      batters: [],
      bowler: null,
      thisOver: [],
      recent: [],
      batterShots: {},
      ballsLeft: null,
      requiredRate: null,
      currentRate: "",
      result: state.result,
      trust: state.trust,
    };
  }
  if (Array.isArray(state.teams)) return null;
  const team = ({ id, name, initials }: PublicLiveState["teams"]["home"]) => ({
    id,
    name,
    initials,
  });
  return {
    ...envelope,
    v: state.v,
    seq: state.seq,
    phase: state.phase,
    updatedAt: state.updatedAt,
    lastBallAt: state.lastBallAt,
    teams: { home: team(state.teams.home), away: team(state.teams.away) },
    tossLine: state.tossLine,
    conditionsLine: state.conditionsLine,
    innings: state.innings.map(({ battingTeamId, runs, wickets, overs, target, superOver }) => ({
      battingTeamId,
      runs,
      wickets,
      overs,
      target,
      superOver,
    })),
    situation: state.situation,
    batters: state.batters.map(
      ({ id, name, initials, photoUrl, runs, balls, fours, sixes, onStrike, hand }) => ({
        id,
        name,
        initials,
        photoUrl,
        runs,
        balls,
        fours,
        sixes,
        onStrike,
        hand,
      }),
    ),
    bowler: state.bowler
      ? {
          id: state.bowler.id,
          name: state.bowler.name,
          style: state.bowler.style,
          figures: state.bowler.figures,
        }
      : null,
    thisOver: [...state.thisOver],
    recent: state.recent.map(({ seq, over, text }) => ({ seq, over, text })),
    batterShots: Object.fromEntries(
      Object.entries(state.batterShots).map(([id, shots]) => [
        id,
        shots.map(({ angle, runs }) => ({ angle, runs })),
      ]),
    ),
    ballsLeft: state.ballsLeft,
    requiredRate: state.requiredRate,
    currentRate: state.currentRate,
    result: state.result,
    trust: state.trust,
  };
}

/** Select only a released ring entry; no current-state fallback under delay. */
export function selectDelayedEntry<T extends { state: PublicScoringState }>(
  current: T,
  history: readonly (T & { updatedAt: string })[],
  trust: string,
  delaySeconds: number,
  nowMs: number,
): T | undefined {
  if (trust === "verified" || delaySeconds <= 0) return current;
  const cutoff = nowMs - delaySeconds * 1000;
  return history
    .filter(
      (entry) =>
        Number.isFinite(Date.parse(entry.updatedAt)) && Date.parse(entry.updatedAt) <= cutoff,
    )
    .at(-1);
}
