import type { ApplyResult, MatchEvent } from "../types";
import type { TypedRallyEvent, Side } from "./events";
import { fixtureWinner, other, type RallyState, type Rubber, type RallyGame } from "./state";
import { validateRallyPayload } from "./validate";
import { rallyFormat } from "./formats";
const refused = { ok: false, reason: "bad_payload" } as const;
function closeGame(rubber: Rubber, game: RallyGame, winner: Side, needed: number) {
  game.winner = winner;
  if (rubber.games.filter((entry) => entry.winner === winner).length >= needed)
    rubber.winner = winner;
}
export function rallyTransition(state: RallyState, raw: MatchEvent): ApplyResult<RallyState> {
  if (raw.attempt !== state.attempt) return { ok: false, reason: "wrong_attempt" };
  const valid = validateRallyPayload(raw.type, raw.payload);
  if (!valid.ok) return valid;
  if (state.terminal === "void" || (state.finished && raw.type !== "match_voided"))
    return { ok: false, reason: "already_finished" };
  if (
    state.interrupted &&
    !["resume", "conditions_changed", "abandon", "walkover", "match_voided"].includes(raw.type)
  )
    return { ok: false, reason: "not_live" };
  const event = raw as TypedRallyEvent;
  const next: RallyState = {
    ...state,
    conditions: structuredClone(state.conditions),
    squads: structuredClone(state.squads),
    rubbers: structuredClone(state.rubbers),
    participants: structuredClone(state.participants),
    rallies: [...state.rallies],
  };
  const rubber = next.rubbers.at(-1),
    game = rubber?.games.at(-1);
  switch (event.type) {
    case "match_started": {
      if (state.format) return refused;
      if (
        state.competition &&
        event.payload.competition &&
        (state.competition.name !== event.payload.competition.name ||
          state.competition.season !== event.payload.competition.season)
      )
        return refused;
      next.format = rallyFormat(event.payload.format);
      next.conditions = structuredClone(event.payload.conditions);
      next.teams = { home: event.payload.homeTeamId, away: event.payload.awayTeamId };
      next.competition = event.payload.competition
        ? { ...event.payload.competition }
        : state.competition;
      break;
    }
    case "lineup_confirmed": {
      const { teamId, players } = event.payload;
      if (
        !state.teams ||
        !Object.values(state.teams).includes(teamId) ||
        state.squads[teamId] ||
        state.rubbers.length
      )
        return refused;
      if (
        Object.values(state.squads)
          .flat()
          .some((id) => players.includes(id))
      )
        return { ok: false, reason: "unknown_player" };
      next.squads[teamId] = [...players];
      break;
    }
    case "rubber_started": {
      const { rubberNo, homePlayers, awayPlayers, firstServer } = event.payload;
      if (
        !state.format ||
        !state.teams ||
        !state.squads[state.teams.home] ||
        !state.squads[state.teams.away] ||
        fixtureWinner(state)
      )
        return refused;
      for (const side of ["home", "away"] as const) {
        const players = side === "home" ? homePlayers : awayPlayers;
        if (!players.every((id) => state.squads[state.teams?.[side] ?? ""]?.includes(id)))
          return { ok: false, reason: "unknown_player" };
      }
      if (!rubber || rubber.winner) {
        if (rubberNo !== (rubber?.no ?? 0) + 1 || rubberNo > state.format.rubbers) return refused;
        next.rubbers.push({
          no: rubberNo,
          active: { home: [...homePlayers], away: [...awayPlayers] },
          games: [],
          winner: null,
        });
      } else {
        if (
          rubberNo !== rubber.no ||
          !game?.winner ||
          !(["home", "away"] as const).every((side) => {
            const supplied = side === "home" ? homePlayers : awayPlayers;
            return (
              supplied.length === rubber.active[side].length &&
              supplied.every((id) => rubber.active[side].includes(id))
            );
          })
        )
          return refused;
      }
      const current = next.rubbers.at(-1);
      if (!current) return refused;
      current.games.push({
        no: current.games.length + 1,
        points: { home: 0, away: 0 },
        firstServer,
        server: firstServer,
        winner: null,
      });
      for (const side of ["home", "away"] as const)
        for (const id of current.active[side])
          next.participants[id] ??= {
            teamId: state.teams[side],
            stats: {
              ralliesWon: 0,
              aces: 0,
              winners: 0,
              errors: 0,
              kills: 0,
              blocks: 0,
              faults: 0,
            },
          };
      next.streak = null;
      break;
    }
    case "rally": {
      if (!rubber || !game || !state.format) return { ok: false, reason: "not_live" };
      if (game.winner || rubber.winner || fixtureWinner(state))
        return { ok: false, reason: "innings_over", detail: "This game is complete." };
      const { winner, playerId, endedBy } = event.payload;
      next.rallies.push({
        eventId: raw.eventId,
        seq: raw.seq,
        clientRecordedAt: raw.clientRecordedAt,
        winner,
        ...(endedBy ? { endedBy } : {}),
        ...(playerId ? { playerId } : {}),
      });
      if (playerId) {
        const side = endedBy === "error" || endedBy === "fault" ? other(winner) : winner;
        if (!rubber.active[side].includes(playerId)) return { ok: false, reason: "unknown_player" };
        const participant = next.participants[playerId];
        if (!participant) return refused;
        if (side === winner) participant.stats.ralliesWon += 1;
        if (endedBy) {
          const key = {
            ace: "aces",
            winner: "winners",
            error: "errors",
            kill: "kills",
            block: "blocks",
            fault: "faults",
          } as const;
          participant.stats[key[endedBy]] += 1;
        }
      }
      if (state.format.serve !== "side_out" || game.server === winner) game.points[winner] += 1;
      next.streak =
        state.streak?.side === winner
          ? { side: winner, count: state.streak.count + 1 }
          : { side: winner, count: 1 };
      if (state.format.serve === "two_each") {
        const threshold = state.format.pointsToWin - 1,
          total = game.points.home + game.points.away;
        const turns =
          game.points.home >= threshold && game.points.away >= threshold
            ? threshold + Math.floor((total - 2 * threshold) / state.format.changeServeAtDeuce)
            : Math.floor(total / 2);
        game.server = turns % 2 === 0 ? game.firstServer : other(game.firstServer);
      } else game.server = winner;
      const target =
        game.no === state.format.gamesToWin * 2 - 1
          ? (state.format.decidingPointsToWin ?? state.format.pointsToWin)
          : state.format.pointsToWin;
      if (
        (game.points[winner] >= target &&
          game.points[winner] - game.points[other(winner)] >= state.format.winBy) ||
        (state.format.cap !== null && game.points[winner] >= state.format.cap)
      )
        closeGame(rubber, game, winner, state.format.gamesToWin);
      break;
    }
    case "game_conceded":
      if (!rubber || !game || game.winner || rubber.winner || !state.format) return refused;
      closeGame(rubber, game, other(event.payload.side), state.format.gamesToWin);
      break;
    case "rubber_conceded":
      if (!rubber || rubber.winner) return refused;
      if (game && !game.winner) game.winner = other(event.payload.side);
      rubber.winner = other(event.payload.side);
      break;
    case "substitute": {
      if (
        state.format?.key !== "volleyball_bo5" ||
        !rubber ||
        rubber.winner ||
        fixtureWinner(state) ||
        !state.teams
      )
        return refused;
      const { side, inId, outId } = event.payload;
      if (
        !rubber.active[side].includes(outId) ||
        rubber.active[side].includes(inId) ||
        !state.squads[state.teams[side]]?.includes(inId)
      )
        return { ok: false, reason: "unknown_player" };
      rubber.active[side] = rubber.active[side].map((id) => (id === outId ? inId : id));
      next.participants[inId] ??= {
        teamId: state.teams[side],
        stats: { ralliesWon: 0, aces: 0, winners: 0, errors: 0, kills: 0, blocks: 0, faults: 0 },
      };
      break;
    }
    case "timeout":
      if (!game || game.winner || rubber?.winner || fixtureWinner(state)) return refused;
      break;
    case "conditions_changed":
      if (!state.format) return refused;
      next.conditions = { ...next.conditions, ...structuredClone(event.payload.conditions) };
      break;
    case "interrupt":
      if (!state.format || fixtureWinner(state)) return refused;
      next.interrupted = true;
      break;
    case "resume":
      if (!state.interrupted) return refused;
      next.interrupted = false;
      break;
    case "abandon":
      if (!state.format) return refused;
      next.terminal = event.payload.kind;
      next.finished = true;
      break;
    case "walkover":
      if (!state.teams || !Object.values(state.teams).includes(event.payload.winnerTeamId))
        return refused;
      next.terminal = "walkover";
      next.walkoverWinner = event.payload.winnerTeamId;
      next.finished = true;
      break;
    case "finish":
      if (!fixtureWinner(state)) return refused;
      next.finished = true;
      break;
    case "match_voided":
      next.terminal = "void";
      next.finished = true;
      break;
    default:
      return refused;
  }
  next.phase =
    next.terminal === "void"
      ? "void"
      : next.terminal === "walkover"
        ? "walkover"
        : next.terminal === "abandoned"
          ? "abandoned"
          : next.terminal === "no_result"
            ? "no_result"
            : next.finished
              ? "finished"
              : next.interrupted
                ? "interrupted"
                : fixtureWinner(next)
                  ? "result_reached"
                  : next.rubbers.length
                    ? "live"
                    : "not_started";
  return {
    ok: true,
    state: {
      ...next,
      lastSeq: raw.seq,
      lastEventAt: raw.clientRecordedAt,
      eventHistory: [...state.eventHistory, raw],
    },
  };
}
