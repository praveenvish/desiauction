import { integer, isRecord, oneOf } from "../validate-primitives";
import type { RaidPanel } from "./public-state";
export function projectRaidPanel(raw: unknown): RaidPanel | null {
  if (
    !isRecord(raw) ||
    raw.v !== 1 ||
    !integer(raw.half, 0, 2) ||
    typeof raw.halfClosed !== "boolean" ||
    typeof raw.running !== "boolean" ||
    !oneOf(raw.nextRaidingSide, ["home", "away"]) ||
    !(raw.formatKey === null || oneOf(raw.formatKey, ["pkl_40", "kabaddi_30"])) ||
    !(
      raw.clockAnchorAtMs === null ||
      integer(raw.clockAnchorAtMs, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
    ) ||
    !integer(raw.halfDurationMs, 0, 1200000) ||
    !integer(raw.halfElapsedMs, 0, 1200000) ||
    !integer(raw.raidElapsedMs, 0, 30000)
  )
    return null;
  const numbers = (value: unknown, max: number) =>
    isRecord(value) && integer(value.home, 0, max) && integer(value.away, 0, max)
      ? { home: value.home, away: value.away }
      : null;
  const points = numbers(raw.points, Number.MAX_SAFE_INTEGER),
    matCount = numbers(raw.matCount, 7),
    outCount = numbers(raw.outCount, 7);
  if (
    !points ||
    !matCount ||
    !outCount ||
    !isRecord(raw.doOrDie) ||
    typeof raw.doOrDie.home !== "boolean" ||
    typeof raw.doOrDie.away !== "boolean"
  )
    return null;
  if (raw.formatKey === "kabaddi_30" && raw.halfElapsedMs > 900000) return null;
  if (
    raw.halfDurationMs !==
      (raw.formatKey === "pkl_40" ? 1200000 : raw.formatKey === "kabaddi_30" ? 900000 : 0) ||
    raw.halfElapsedMs > raw.halfDurationMs
  )
    return null;
  return {
    v: 1,
    formatKey: raw.formatKey as RaidPanel["formatKey"],
    half: raw.half as RaidPanel["half"],
    halfClosed: raw.halfClosed,
    clockAnchorAtMs: raw.clockAnchorAtMs,
    halfDurationMs: raw.halfDurationMs,
    halfElapsedMs: raw.halfElapsedMs,
    running: raw.running,
    raidElapsedMs: raw.raidElapsedMs,
    nextRaidingSide: raw.nextRaidingSide as RaidPanel["nextRaidingSide"],
    points,
    matCount,
    outCount,
    doOrDie: { home: raw.doOrDie.home, away: raw.doOrDie.away },
  };
}
