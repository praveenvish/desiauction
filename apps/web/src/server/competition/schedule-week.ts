import { addDays } from "@desiauction/core";

/**
 * WHICH WEEK THE MATCHES SCREEN OPENS ON — pure, so it is tested rather than
 * trusted.
 *
 * The screen shows one week (Monday to Sunday) of a season at a time: a season
 * of 240 fixtures is 17,000 pixels as one list, and nobody at a ground wants
 * anything but today. So the week is chosen the way an organizer would:
 *
 *  1. the week they asked for (`?date=` — the day strip, an old calendar link);
 *  2. else this week, when the season has a match in it;
 *  3. else the week of the next match to come;
 *  4. else the week of the last match played — a finished season opens on its
 *     final week, not on an empty one;
 *  5. else this week.
 */

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export function isWallDate(value: string | undefined): value is string {
  if (value === undefined || !DATE_SHAPE.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The Monday on or before `date` (YYYY-MM-DD, wall clock). */
export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

export function focusWeek(input: {
  requested: string | undefined;
  today: string;
  /** Every match day of the season, ascending. */
  days: readonly { date: string }[];
}): string {
  if (isWallDate(input.requested)) {
    return mondayOf(input.requested);
  }
  const thisWeek = mondayOf(input.today);
  const end = addDays(thisWeek, 6);
  if (input.days.some((day) => day.date >= thisWeek && day.date <= end)) {
    return thisWeek;
  }
  const ahead = input.days.find((day) => day.date >= input.today);
  if (ahead !== undefined) {
    return mondayOf(ahead.date);
  }
  const last = input.days[input.days.length - 1];
  return last !== undefined ? mondayOf(last.date) : thisWeek;
}

export interface WeekStrip {
  /** The Monday. */
  readonly start: string;
  readonly days: readonly { date: string; count: number; live: number }[];
  /** The nearest match day before and after this week, to step to; null at an end. */
  readonly earlier: string | null;
  readonly later: string | null;
}

/** Seven days from `start`, every one present, with the nearest match day either side. */
export function weekStrip(
  start: string,
  days: readonly { date: string; count: number; live: number }[],
): WeekStrip {
  const end = addDays(start, 6);
  const byDate = new Map(days.map((day) => [day.date, day]));
  const before = days.filter((day) => day.date < start);
  return {
    start,
    days: Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, index);
      const found = byDate.get(date);
      return { date, count: found?.count ?? 0, live: found?.live ?? 0 };
    }),
    earlier: before[before.length - 1]?.date ?? null,
    later: days.find((day) => day.date > end)?.date ?? null,
  };
}
