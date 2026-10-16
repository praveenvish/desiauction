import { integer, isRecord, oneOf } from "../validate-primitives";
import { TIMED_FORMAT_PRESETS } from "./formats";
import type { TimedPanel } from "./public-state";
function numbers(raw: unknown): { home: number; away: number } | null {
  return isRecord(raw) && integer(raw.home) && integer(raw.away)
    ? { home: raw.home, away: raw.away }
    : null;
}
export function projectTimedPanel(raw: unknown): TimedPanel | null {
  if (
    !isRecord(raw) ||
    raw.v !== 1 ||
    !integer(raw.period, 0, 4) ||
    typeof raw.periodClosed !== "boolean" ||
    typeof raw.running !== "boolean" ||
    !integer(raw.periodDurationMs) ||
    !integer(raw.periodElapsedMs) ||
    !integer(raw.gameClockMs) ||
    !(raw.clockAnchorAtMs === null || integer(raw.clockAnchorAtMs, Number.MIN_SAFE_INTEGER)) ||
    !Array.isArray(raw.timeline) ||
    raw.timeline.length > 12
  )
    return null;
  const format = Object.values(TIMED_FORMAT_PRESETS).find((entry) => entry.key === raw.formatKey);
  if (
    !(raw.formatKey === null || format) ||
    raw.periodDurationMs !== (format?.periodMinutes ?? 0) * 60000 ||
    raw.periodElapsedMs > raw.periodDurationMs ||
    raw.period > (format?.periods ?? 0) ||
    raw.gameClockMs > (format ? format.periods * format.periodMinutes * 60000 : 0)
  )
    return null;
  const points = numbers(raw.points);
  if (!points) return null;
  let shootout: TimedPanel["shootout"] = null;
  if (raw.shootout !== null) {
    const s = raw.shootout;
    if (
      !isRecord(s) ||
      !oneOf(s.nextSide, ["home", "away"]) ||
      !(s.winner === null || oneOf(s.winner, ["home", "away"]))
    )
      return null;
    const score = numbers(s.points),
      attempts = numbers(s.attempts);
    if (
      !score ||
      !attempts ||
      score.home > attempts.home ||
      score.away > attempts.away ||
      !format?.shootout ||
      raw.running ||
      !raw.periodClosed ||
      raw.period !== format.periods
    )
      return null;
    shootout = {
      points: score,
      attempts,
      nextSide: s.nextSide as "home" | "away",
      winner: s.winner as "home" | "away" | null,
    };
  }
  const timeline: TimedPanel["timeline"] = [];
  for (const e of raw.timeline) {
    if (
      !isRecord(e) ||
      !integer(e.seq, 1) ||
      !integer(e.period, 1, format?.periods ?? 0) ||
      !integer(e.gameClockMs, 0, raw.gameClockMs) ||
      !oneOf(e.kind, ["score", "card"]) ||
      !(e.side === null || oneOf(e.side, ["home", "away"])) ||
      !integer(e.points, 0, 3) ||
      !(e.playerName === null || typeof e.playerName === "string") ||
      !(e.assistName === null || typeof e.assistName === "string") ||
      !(e.colour === null || oneOf(e.colour, ["yellow", "red", "green"]))
    )
      return null;
    timeline.push({
      seq: e.seq,
      period: e.period,
      gameClockMs: e.gameClockMs,
      kind: e.kind as "score" | "card",
      side: e.side as "home" | "away" | null,
      points: e.points,
      playerName: e.playerName,
      assistName: e.assistName,
      colour: e.colour as "yellow" | "red" | "green" | null,
    });
  }
  return {
    v: 1,
    formatKey: raw.formatKey as string | null,
    period: raw.period,
    periodClosed: raw.periodClosed,
    periodDurationMs: raw.periodDurationMs,
    periodElapsedMs: raw.periodElapsedMs,
    gameClockMs: raw.gameClockMs,
    clockAnchorAtMs: raw.clockAnchorAtMs,
    running: raw.running,
    points,
    shootout,
    timeline,
  };
}
