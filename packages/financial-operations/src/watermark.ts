/**
 * Watermarks and the fiscal calendar (IP-6_ARCHITECTURE §2/§9, ADR-3).
 *
 * A watermark names the settlement stream prefixes an operational artifact
 * stood on: a map of `"{streamType}:{streamId}" → seq`. Every finops surface
 * and every attestation carries one, so staleness is a rendered fact, never a
 * hidden one — and every quoted settlement fact is re-derivable by folding the
 * frozen streams to the pinned frontier.
 *
 * Pure throughout: date arithmetic is UTC-offset arithmetic on injected epoch
 * milliseconds — no ambient clock, no locale, no Intl.
 */

import { obj } from "./events";

/** `"{streamType}:{streamId}" → consumed-through seq`. Values are seqs ≥ 0. */
export type Watermark = Readonly<Record<string, number>>;

export function watermarkKey(streamType: string, streamId: string): string {
  return `${streamType}:${streamId}`;
}

/** A payload field parsed as a watermark — null when any entry is not a seq. */
export function watermarkOf(value: unknown): Watermark | null {
  const record = obj(value);
  if (record === null) {
    return null;
  }
  const entries: Record<string, number> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
      return null;
    }
    entries[key] = raw;
  }
  return entries;
}

/**
 * Monotonicity: `next` regresses nothing `prev` already recorded. New streams
 * may appear; known streams may only hold or advance. A regression means an
 * artifact claims to stand on LESS history than its predecessor — fail closed.
 */
export function watermarkAdvances(prev: Watermark, next: Watermark): boolean {
  return Object.entries(prev).every(([key, seq]) => (next[key] ?? -1) >= seq);
}

/** Deterministic canonical form (sorted keys) — the digestable bytes. */
export function canonicalWatermark(watermark: Watermark): Watermark {
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(watermark).sort()) {
    sorted[key] = watermark[key] ?? 0;
  }
  return sorted;
}

// --- The Indian fiscal calendar (IST, April–March) ----------------------------------

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The IST calendar date (`yyyy-mm-dd`) of an epoch instant. */
export function istDateOf(atMs: number): string {
  return new Date(atMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The fiscal year (`2026-27`) a calendar date belongs to. */
export function fiscalYearOf(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${String(start)}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function isFiscalYear(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) {
    return false;
  }
  const start = Number(value.slice(0, 4));
  return Number(value.slice(5, 7)) === (start + 1) % 100;
}

/** First and last IST calendar dates of a fiscal year. */
export function fiscalYearBounds(fy: string): { start: string; end: string } {
  const start = Number(fy.slice(0, 4));
  return { start: `${String(start)}-04-01`, end: `${String(start + 1)}-03-31` };
}

/** The IST calendar day before a date — pure string arithmetic via UTC. */
export function previousDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return new Date(parsed.getTime() - 86_400_000).toISOString().slice(0, 10);
}
