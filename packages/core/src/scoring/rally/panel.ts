import { isRecord, integer } from "../validate-primitives";
import { RALLY_FORMAT_KEYS } from "./format-keys";
import type { RallyPanel } from "./public-state";
import type { Side } from "./events";
const side = (value: unknown): value is Side | null =>
  value === null || value === "home" || value === "away";
export function projectRallyPanel(raw: unknown): RallyPanel | null {
  if (
    !isRecord(raw) ||
    raw.v !== 1 ||
    !side(raw.server) ||
    !isRecord(raw.points) ||
    !integer(raw.points.home) ||
    !integer(raw.points.away) ||
    !isRecord(raw.score) ||
    !isRecord(raw.score.home) ||
    !isRecord(raw.score.away)
  )
    return null;
  const formatKey = raw.formatKey;
  if (formatKey !== null && !Object.values(RALLY_FORMAT_KEYS).some((key) => key === formatKey))
    return null;
  if (
    (raw.rubberNo !== null && !integer(raw.rubberNo, 1, 5)) ||
    (raw.gameNo !== null && !integer(raw.gameNo, 1, 5)) ||
    !Array.isArray(raw.rubbers) ||
    raw.rubbers.length > 5
  )
    return null;
  const scoreKeys = formatKey === "volleyball_bo5" ? ["sets", "points"] : ["rubbers", "games"];
  const home: Record<string, number> = {},
    away: Record<string, number> = {};
  for (const key of scoreKeys) {
    const h = raw.score.home[key],
      a = raw.score.away[key];
    if (!integer(h) || !integer(a)) return null;
    home[key] = h;
    away[key] = a;
  }
  const rubbers: RallyPanel["rubbers"] = [];
  for (const entry of raw.rubbers) {
    if (
      !isRecord(entry) ||
      !integer(entry.no, 1, 5) ||
      !side(entry.winner) ||
      !Array.isArray(entry.games) ||
      entry.games.length > 5
    )
      return null;
    const games: RallyPanel["rubbers"][number]["games"] = [];
    for (const game of entry.games) {
      if (
        !isRecord(game) ||
        !integer(game.no, 1, 5) ||
        !integer(game.home) ||
        !integer(game.away) ||
        !side(game.winner)
      )
        return null;
      games.push({ no: game.no, home: game.home, away: game.away, winner: game.winner });
    }
    rubbers.push({ no: entry.no, winner: entry.winner, games });
  }
  let streak: RallyPanel["streak"] = null;
  if (raw.streak !== null) {
    if (
      !isRecord(raw.streak) ||
      !side(raw.streak.side) ||
      raw.streak.side === null ||
      !integer(raw.streak.count, 1)
    )
      return null;
    streak = { side: raw.streak.side, count: raw.streak.count };
  }
  return {
    v: 1,
    formatKey: formatKey as string | null,
    server: raw.server,
    rubberNo: raw.rubberNo,
    gameNo: raw.gameNo,
    points: { home: raw.points.home, away: raw.points.away },
    score: { home, away },
    rubbers,
    streak,
  };
}
