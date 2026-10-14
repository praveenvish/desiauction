import { parseBowlingStyle } from "@desiauction/core";
import { replayMatch, type MatchState } from "@desiauction/core/scoring";
import type { LocalEntry } from "../local-entry";
export function menuItems(organiser: boolean, interrupted: boolean) {
  return [
    "shot-map",
    "theme",
    "penalty",
    "substitute",
    interrupted ? "resume" : "interrupt",
    "revise",
    "conditions",
    "no-result",
    "restart",
    ...(organiser ? ["void"] : []),
  ];
}
/** Restart is acknowledged before these events are queued in its new attempt. */
export function restartSetupEntries(state: MatchState, restartId: string): LocalEntry[] {
  const index = state.eventHistory.findIndex(
    (event) => event.eventId === restartId && event.type === "restart",
  );
  if (index < 0) return [];
  const previous = state.eventHistory.slice(0, index);
  const prior = replayMatch(previous);
  if (!prior.format || !prior.teams) return [];
  const entries: LocalEntry[] = [
    {
      type: "match_started",
      payload: {
        format: prior.format,
        conditions: prior.conditions,
        homeTeamId: prior.teams.home,
        awayTeamId: prior.teams.away,
        ...(prior.originalTieSetting ? { superOverTie: prior.originalTieSetting } : {}),
        ...(prior.competition ? { competition: prior.competition } : {}),
      },
    },
  ];
  const registrationIds = new Set<string>();
  for (const teamId of [prior.teams.home, prior.teams.away]) {
    const lineup = previous.findLast(
      (event) =>
        event.attempt === prior.attempt &&
        event.type === "lineup_confirmed" &&
        (event.payload as { teamId?: string }).teamId === teamId,
    );
    if (!lineup) return [];
    const payload = lineup.payload as { battingOrder: string[]; substitutes: string[] };
    for (const id of [...payload.battingOrder, ...payload.substitutes]) registrationIds.add(id);
    entries.push({ type: "lineup_confirmed", payload: lineup.payload } as LocalEntry);
  }
  for (const registrationId of [...registrationIds].sort()) {
    const style = prior.styles[registrationId];
    const bowlingStyle = parseBowlingStyle(style?.bowlingStyle ?? "");
    if (style?.battingHand || bowlingStyle)
      entries.push({
        type: "style_set",
        payload: {
          registrationId,
          ...(style?.battingHand ? { battingHand: style.battingHand } : {}),
          ...(bowlingStyle ? { bowlingStyle } : {}),
        },
      });
  }
  return entries;
}

/** Accepted style evidence, even if changed since seeding, must never be overwritten. */
export function missingRestartSetupEntries(state: MatchState, restartId: string): LocalEntry[] {
  return restartSetupEntries(state, restartId).filter((entry) => {
    if (entry.type === "match_started") return !state.format;
    if (entry.type === "lineup_confirmed") return !state.lineups[entry.payload.teamId];
    if (entry.type === "style_set")
      return !state.eventHistory.some(
        (event) =>
          event.attempt === state.attempt &&
          event.type === "style_set" &&
          (event.payload as { registrationId?: string }).registrationId ===
            entry.payload.registrationId,
      );
    return false;
  });
}
