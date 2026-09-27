import { addDays } from "@desiauction/core";

/**
 * WHICH SEVEN DAYS THE MATCHES SCREEN SHOWS — pure, so it is tested rather
 * than trusted.
 *
 * The screen shows seven days of a season at a time: a season of 240 fixtures
 * is 17,000 pixels as one list, and nobody at a ground wants anything but
 * today. The seven days ROLL rather than run Monday to Sunday — a calendar week
 * on a Sunday shows six days gone and nothing of tomorrow — and open two days
 * back, so yesterday's results sit above today and the next four days follow:
 *
 *  1. the day asked for (`?date=` — the strip's arrows, an old calendar link)
 *     opens the window;
 *  2. else the window around today, when it has a match;
 *  3. else the window opening on the next match to come;
 *  4. else the window closing on the last match played — a finished season
 *     opens on its final days, not on an empty stretch;
 *  5. else the window around today.
 */

export const DAYS_SHOWN = 7;
/** How far back the default window reaches: yesterday and the day before. */
export const DAYS_BACK = 2;

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export function isWallDate(value: string | undefined): value is string {
  if (value === undefined || !DATE_SHAPE.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The first of the seven days to show. */
export function focusStart(input: {
  requested: string | undefined;
  today: string;
  /** Every match day of the season, ascending. */
  days: readonly { date: string }[];
}): string {
  if (isWallDate(input.requested)) {
    return input.requested;
  }
  const around = addDays(input.today, -DAYS_BACK);
  const end = addDays(around, DAYS_SHOWN - 1);
  if (input.days.some((day) => day.date >= around && day.date <= end)) {
    return around;
  }
  const ahead = input.days.find((day) => day.date >= input.today);
  if (ahead !== undefined) {
    return ahead.date;
  }
  const last = input.days[input.days.length - 1];
  return last !== undefined ? addDays(last.date, -(DAYS_SHOWN - 1)) : around;
}

export interface WeekStrip {
  /** The first of the seven days. */
  readonly start: string;
  readonly days: readonly { date: string; count: number; live: number }[];
  /**
   * Where the arrows go: the window CLOSING on the nearest match day before
   * this one, and the window OPENING on the nearest after. Null at an end.
   */
  readonly earlier: string | null;
  readonly later: string | null;
}

/** Seven days from `start`, every one present, with the steps either side. */
export function weekStrip(
  start: string,
  days: readonly { date: string; count: number; live: number }[],
): WeekStrip {
  const end = addDays(start, DAYS_SHOWN - 1);
  const byDate = new Map(days.map((day) => [day.date, day]));
  const before = days.filter((day) => day.date < start);
  const lastBefore = before[before.length - 1];
  return {
    start,
    days: Array.from({ length: DAYS_SHOWN }, (_, index) => {
      const date = addDays(start, index);
      const found = byDate.get(date);
      return { date, count: found?.count ?? 0, live: found?.live ?? 0 };
    }),
    earlier: lastBefore === undefined ? null : addDays(lastBefore.date, -(DAYS_SHOWN - 1)),
    later: days.find((day) => day.date > end)?.date ?? null,
  };
}
