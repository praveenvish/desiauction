import { demoAvailability, demoBlackouts, demoBookings } from "@desiauction/db";
import { and, gte, isNull, lt } from "drizzle-orm";

import { db } from "../db";

/**
 * WHAT TIMES ARE FREE — derived, never stored.
 *
 * There is no `demo_slots` table and there must never be one. What is on offer
 * next Tuesday is a pure function of three things: the recurring availability
 * windows, the blackout dates, and the bookings that already exist. Materialise
 * that and you need a job to keep it true, and the failure mode of the job is a
 * calendar offering a time nobody is there for — which is worse than no
 * calendar, because it burns somebody's evening. A derivation cannot drift.
 *
 * TIME, AND THE ONE SIMPLIFICATION THAT EARNS ITS KEEP.
 *
 * India has one timezone and has never observed daylight saving. IST is UTC
 * +5:30, always, so the conversion is arithmetic rather than a tz database, and
 * the whole module needs no dependency and no `Intl` round-trip on the hot
 * path. That is a real assumption and it is written down here rather than
 * buried: the day this platform sells outside India, this module is where the
 * work is, and `IST_OFFSET_MINUTES` is the thing to delete.
 *
 * Instants are stored and compared in UTC (`timestamptz` throughout). Only the
 * labels are IST, and the page says "IST" out loud so nobody has to guess.
 */

export const IST_OFFSET_MINUTES = 330;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * How far ahead the picker looks, and how soon it will let somebody book.
 *
 * The lead time is not politeness — it is the difference between a calendar and
 * an ambush. Two hours is enough to see the mail arrive and still say no.
 */
export const HORIZON_DAYS = 14;
export const LEAD_TIME_MS = 2 * 60 * MINUTE_MS;

export interface AvailabilityWindow {
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly slotMinutes: number;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
}

export interface Slot {
  /** ISO instant, UTC. The value that round-trips through the form. */
  readonly startIso: string;
  readonly endIso: string;
  /** "7:00 pm", IST. Presentation only. */
  readonly label: string;
}

export interface SlotDay {
  /** `YYYY-MM-DD` in IST. */
  readonly dayKey: string;
  /** "Tue 9 Sep". */
  readonly label: string;
  readonly slots: readonly Slot[];
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** The IST calendar day an instant falls in, as `YYYY-MM-DD`. */
export function istDayKey(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MINUTES * MINUTE_MS).toISOString().slice(0, 10);
}

/** The UTC instant of `minute` past midnight IST on `dayKey`. */
export function istInstant(dayKey: string, minute: number): Date {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + (minute - IST_OFFSET_MINUTES) * MINUTE_MS);
}

/** 0 = Sunday, for an IST day key — matching both `getDay()` and Postgres DOW. */
export function weekdayOf(dayKey: string): number {
  return new Date(`${dayKey}T00:00:00Z`).getUTCDay();
}

/** "Tue 9 Sep" — no year, because the horizon is a fortnight. */
export function dayLabel(dayKey: string): string {
  const at = new Date(`${dayKey}T00:00:00Z`);
  const month = MONTH_NAMES[at.getUTCMonth()] ?? "";
  return `${WEEKDAY_NAMES[at.getUTCDay()] ?? ""} ${String(at.getUTCDate())} ${month}`;
}

/** "7:00 pm" from minutes past midnight IST. Lowercase am/pm is house style. */
export function timeLabel(minute: number): string {
  const hour24 = Math.floor(minute / 60);
  const minutes = minute % 60;
  const suffix = hour24 < 12 ? "am" : "pm";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${String(hour12)}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function withinEffective(window: AvailabilityWindow, dayKey: string): boolean {
  if (window.effectiveFrom !== null && dayKey < window.effectiveFrom) {
    return false;
  }
  if (window.effectiveTo !== null && dayKey > window.effectiveTo) {
    return false;
  }
  return true;
}

/**
 * The derivation itself — pure, so the awkward cases (a blackout mid-horizon, a
 * window that retires on Thursday, a slot that starts inside the lead time) are
 * testable without a database or a clock.
 *
 * Two windows on the same weekday that overlap would produce duplicate starts;
 * they are de-duplicated here rather than forbidden at write time, because
 * "Tuesday 6–8" and "Tuesday 7–9" is a reasonable thing for a person to enter
 * and an unreasonable thing to make them think about.
 */
export function deriveSlots(
  windows: readonly AvailabilityWindow[],
  blackouts: ReadonlySet<string>,
  bookedStartMs: ReadonlySet<number>,
  now: Date,
  horizonDays: number = HORIZON_DAYS,
): readonly SlotDay[] {
  const earliestMs = now.getTime() + LEAD_TIME_MS;
  const days: SlotDay[] = [];

  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const dayKey = istDayKey(new Date(now.getTime() + offset * DAY_MS));
    if (blackouts.has(dayKey)) {
      continue;
    }
    const weekday = weekdayOf(dayKey);
    const starts = new Map<number, Slot>();

    for (const window of windows) {
      if (window.weekday !== weekday || !withinEffective(window, dayKey)) {
        continue;
      }
      for (
        let minute = window.startMinute;
        minute + window.slotMinutes <= window.endMinute;
        minute += window.slotMinutes
      ) {
        const start = istInstant(dayKey, minute);
        const startMs = start.getTime();
        if (startMs < earliestMs || bookedStartMs.has(startMs) || starts.has(startMs)) {
          continue;
        }
        starts.set(startMs, {
          startIso: start.toISOString(),
          endIso: istInstant(dayKey, minute + window.slotMinutes).toISOString(),
          label: timeLabel(minute),
        });
      }
    }

    if (starts.size > 0) {
      days.push({
        dayKey,
        label: dayLabel(dayKey),
        slots: [...starts.entries()].sort(([a], [b]) => a - b).map(([, slot]) => slot),
      });
    }
  }

  return days;
}

/** The three reads the derivation needs, and nothing else. */
export async function bookableDays(now: Date = new Date()): Promise<readonly SlotDay[]> {
  const horizonEnd = new Date(now.getTime() + (HORIZON_DAYS + 1) * DAY_MS);

  const [windows, blackoutRows, bookedRows] = await Promise.all([
    db
      .select({
        weekday: demoAvailability.weekday,
        startMinute: demoAvailability.startMinute,
        endMinute: demoAvailability.endMinute,
        slotMinutes: demoAvailability.slotMinutes,
        effectiveFrom: demoAvailability.effectiveFrom,
        effectiveTo: demoAvailability.effectiveTo,
      })
      .from(demoAvailability),
    db.select({ blackoutOn: demoBlackouts.blackoutOn }).from(demoBlackouts),
    db
      .select({ slotStart: demoBookings.slotStart })
      .from(demoBookings)
      .where(
        and(
          isNull(demoBookings.cancelledAt),
          gte(demoBookings.slotStart, now),
          lt(demoBookings.slotStart, horizonEnd),
        ),
      ),
  ]);

  return deriveSlots(
    windows,
    new Set(blackoutRows.map((row) => row.blackoutOn)),
    new Set(bookedRows.map((row) => row.slotStart.getTime())),
    now,
  );
}

/**
 * Is there anything at all to offer?
 *
 * `/schedule-demo` asks this to decide what to PROMISE. With no availability
 * published, the page must not advertise a calendar — it says a person will
 * come back to you, which is what will actually happen. The feature degrades to
 * the honest version of itself rather than to an empty grid.
 *
 * Fails to `false`: if this read is broken, the page that offers less is the
 * one that keeps its word.
 */
export async function hasBookableSlots(now: Date = new Date()): Promise<boolean> {
  try {
    const days = await bookableDays(now);
    return days.length > 0;
  } catch {
    return false;
  }
}
