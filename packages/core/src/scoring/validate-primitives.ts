import type { ValidationResult } from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
export function ids(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isId) && new Set(value).size === value.length;
}
export function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
export function checked(ok: boolean): ValidationResult {
  return ok ? { ok: true } : { ok: false, reason: "bad_payload" };
}

export function oneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
}

export function validConditions(value: unknown): boolean {
  if (!isRecord(value) || !keys(value, ["timeOfDay", "ball", "ground", "pitch"])) return false;
  if (value.timeOfDay !== undefined && !oneOf(value.timeOfDay, ["day", "day_night", "night"]))
    return false;
  if (value.ground !== undefined && !oneOf(value.ground, ["full", "half", "box", "indoor"]))
    return false;
  if (value.pitch !== undefined && !oneOf(value.pitch, ["turf", "matting", "astroturf", "cement"]))
    return false;
  if (value.ball !== undefined) {
    const ball = value.ball;
    if (
      !isRecord(ball) ||
      !keys(ball, ["type", "colour"]) ||
      !oneOf(ball.type, ["leather", "tennis", "tape", "rubber"])
    )
      return false;
    if (
      ball.colour !== undefined &&
      (ball.type !== "leather" || !oneOf(ball.colour, ["red", "white", "pink"]))
    )
      return false;
  }
  return true;
}
