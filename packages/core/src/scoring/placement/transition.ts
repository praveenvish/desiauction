import type { ApplyResult, MatchEvent } from "../types";
import type { PlacementEventPayloads } from "./payloads";
import { validatePlacementPayload } from "./validate";
import { placementFormat } from "./formats";
import type { PlacementState } from "./state";
type Event = {
  [T in keyof PlacementEventPayloads]: MatchEvent<T, PlacementEventPayloads[T]>;
}[keyof PlacementEventPayloads];
export function placementTransition(
  state: PlacementState,
  raw: MatchEvent,
): ApplyResult<PlacementState> {
  const bad = { ok: false, reason: "bad_payload" } as const;
  if (raw.attempt !== state.attempt) return { ok: false, reason: "wrong_attempt" };
  const valid = validatePlacementPayload(raw.type, raw.payload);
  if (!valid.ok) return valid;
  if (state.terminal === "void" || (state.finished && raw.type !== "match_voided"))
    return { ok: false, reason: "already_finished" };
  if (
    state.interrupted &&
    !["resume", "abandon", "match_voided", "conditions_changed"].includes(raw.type)
  )
    return { ok: false, reason: "not_live" };
  const next = structuredClone(state),
    event = raw as Event;
  switch (event.type) {
    case "match_started":
      if (next.format) return bad;
      next.format = placementFormat(event.payload.format);
      next.teamIds = [...event.payload.teamIds];
      next.conditions = event.payload.conditions;
      next.competition = event.payload.competition ?? next.competition;
      break;
    case "lineup_confirmed": {
      const { teamId, players } = event.payload;
      if (
        !next.format ||
        next.rounds.length ||
        !next.teamIds.includes(teamId) ||
        next.squads[teamId] ||
        players.some((id) => Object.values(next.squads).some((squad) => squad.includes(id)))
      )
        return bad;
      next.squads[teamId] = [...players];
      break;
    }
    case "lobby_round": {
      const { round, rows } = event.payload;
      if (
        !next.format ||
        next.teamIds.some((id) => !next.squads[id]) ||
        round !== next.rounds.length + 1 ||
        round > next.format.rounds ||
        rows.length !== next.teamIds.length ||
        new Set(rows.map((x) => x.teamId)).size !== rows.length
      )
        return bad;
      for (const row of rows) {
        const squad = next.squads[row.teamId];
        if (
          !squad ||
          row.placement > next.teamIds.length ||
          Object.keys(row.playerKills).length !== squad.length ||
          squad.some((id) => !(id in row.playerKills)) ||
          Object.values(row.playerKills).reduce((a, b) => a + b, 0) !== row.kills
        )
          return bad;
      }
      next.rounds.push({
        ...event.payload,
        eventId: event.eventId,
        clientRecordedAt: event.clientRecordedAt,
      });
      break;
    }
    case "finish":
      if (!next.format || next.rounds.length !== next.format.rounds) return bad;
      next.finished = true;
      break;
    case "interrupt":
      if (!next.format || next.interrupted) return bad;
      next.interrupted = true;
      break;
    case "resume":
      if (!next.interrupted) return bad;
      next.interrupted = false;
      break;
    case "conditions_changed":
      next.conditions = event.payload.conditions;
      break;
    case "abandon":
      if (!next.format) return bad;
      next.terminal = "abandoned";
      next.finished = true;
      break;
    case "match_voided":
      if (!next.format) return bad;
      next.terminal = "void";
      next.finished = true;
      break;
    default:
      return bad;
  }
  next.phase =
    next.terminal === "void"
      ? "void"
      : next.terminal === "abandoned"
        ? "abandoned"
        : next.finished
          ? "finished"
          : next.interrupted
            ? "interrupted"
            : next.format && next.rounds.length === next.format.rounds
              ? "result_reached"
              : next.teamIds.length && next.teamIds.every((id) => next.squads[id]?.length)
                ? "live"
                : "not_started";
  return {
    ok: true,
    state: {
      ...next,
      lastSeq: event.seq,
      lastEventAt: event.clientRecordedAt,
      eventHistory: [...state.eventHistory, event],
    },
  };
}
