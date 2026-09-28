import { addDays } from "@desiauction/core";

/**
 * THE MATCHES SCREEN'S DECISIONS, pure — which one step a row offers, how a
 * day is named, how a scoreline reads and what it suggests about who won.
 * The components draw; these decide, and are tested.
 */

export interface ModelFixture {
  readonly id: string;
  readonly number: string;
  readonly status: "draft" | "scheduled" | "published" | "in_progress" | "completed" | "cancelled";
  readonly kickoffAt: string | null;
  readonly homeTeamId: string | null;
  readonly homeTeamName: string | null;
  readonly awayTeamName: string | null;
  readonly squadCount: number;
  readonly placedCount: number;
}

export type ModelResult = {
  readonly outcome: string;
  readonly score: {
    home?: Record<string, number> | undefined;
    away?: Record<string, number> | undefined;
  } | null;
};

export const isLobby = (fixture: Pick<ModelFixture, "homeTeamId">): boolean =>
  fixture.homeTeamId === null;

/**
 * Whether a match has its result. A duel's is a result row; a lobby writes
 * none — it is scored once every squad in it has been placed.
 */
export function isScored(
  fixture: ModelFixture,
  results: Readonly<Record<string, ModelResult | undefined>>,
): boolean {
  if (isLobby(fixture)) {
    return fixture.squadCount > 0 && fixture.placedCount === fixture.squadCount;
  }
  return results[fixture.id] !== undefined;
}

export type RowStep =
  | { kind: "lifecycle"; action: "schedule" | "publish" | "start"; label: string }
  | { kind: "score"; label: string; urgent: boolean }
  | { kind: "lineups"; label: string };

/**
 * THE ONE THING A ROW ASKS FOR, if anything. A draft wants scheduling, a
 * scheduled match publishing; a published one on (or past) its day wants
 * starting, and one still days away wants its lineups first if they are not
 * in. A match being played, or played and unscored, wants its score. Done and
 * cancelled matches ask for nothing — their row shows the result instead.
 */
export function rowStep(
  fixture: ModelFixture,
  context: {
    readonly scored: boolean;
    /** Players saved per side; null when that side has none. Absent for a lobby. */
    readonly lineups?: { home: number | null; away: number | null } | undefined;
    readonly today: string;
  },
): RowStep | null {
  const lobby = isLobby(fixture);
  switch (fixture.status) {
    case "draft":
      return { kind: "lifecycle", action: "schedule", label: "Schedule" };
    case "scheduled":
      return { kind: "lifecycle", action: "publish", label: "Publish" };
    case "published": {
      const day = fixture.kickoffAt?.slice(0, 10) ?? null;
      const ahead = day !== null && day > context.today;
      const lineupsMissing =
        !lobby &&
        context.lineups !== undefined &&
        (context.lineups.home === null || context.lineups.away === null);
      if (ahead && lineupsMissing) {
        return { kind: "lineups", label: "Set lineups" };
      }
      // Its day has passed and nobody started it: what is owed is the score.
      // Starting is how a score is taken (it opens the match's result form).
      const past = day !== null && day < context.today;
      return { kind: "lifecycle", action: "start", label: past ? "Enter score" : "Start" };
    }
    case "in_progress":
      return { kind: "score", label: lobby ? "Enter placings" : "Enter score", urgent: true };
    case "completed":
      return context.scored
        ? null
        : { kind: "score", label: lobby ? "Enter placings" : "Enter score", urgent: false };
    default:
      return null;
  }
}

/** Kickoff order, one group per day; undated matches are left to the caller. */
export function groupByDay<T extends { kickoffAt: string | null }>(
  rows: readonly T[],
): { date: string; rows: T[] }[] {
  const days = new Map<string, T[]>();
  for (const row of rows) {
    if (row.kickoffAt === null) {
      continue;
    }
    const date = row.kickoffAt.slice(0, 10);
    const list = days.get(date) ?? [];
    list.push(row);
    days.set(date, list);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({
      date,
      rows: list.sort((a, b) => (a.kickoffAt ?? "").localeCompare(b.kickoffAt ?? "")),
    }));
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A wall-clock day's parts: "Sun", "27 Sep", and "Sun, 27 Sep" (with the year when asked). */
export function wallDay(
  date: string,
  withYear = false,
): { weekday: string; date: string; label: string } {
  const [y, m, d] = date.split("-").map((part) => Number.parseInt(part, 10));
  const year = y ?? 1970;
  const month = m ?? 1;
  const day = d ?? 1;
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
  const short = `${String(day)} ${MONTHS[month - 1] ?? ""}`;
  return {
    weekday,
    date: short,
    label: `${weekday}, ${short}${withYear ? ` ${String(year)}` : ""}`,
  };
}

/** "Today", "Tomorrow", "Yesterday" — else null, and the caller prints the date. */
export function relativeDay(date: string, today: string): string | null {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  if (date === addDays(today, -1)) return "Yesterday";
  return null;
}

/**
 * The scoreline in one line — the PRIMARY component only (runs, goals), the
 * way a result is said aloud. An em dash for a side never recorded, because
 * zero is a real score.
 */
export function primaryScore(side: Record<string, number> | undefined): string {
  const first = side === undefined ? undefined : Object.values(side)[0];
  return first === undefined ? "—" : String(first);
}

/** "Mumbai Mavericks won", "Tied", "No result" — the result as a sentence. */
export function resultSentence(
  outcome: string,
  homeName: string | null,
  awayName: string | null,
): string {
  switch (outcome) {
    case "home_win":
      return `${homeName ?? "Home"} won`;
    case "away_win":
      return `${awayName ?? "Away"} won`;
    case "tie":
      return "Tied";
    case "no_result":
      return "No result";
    case "abandoned":
      return "Abandoned";
    default:
      return outcome.replace(/_/g, " ");
  }
}

/**
 * WHO WON, READ OFF THE SCORE the scorer typed — only a suggestion; the
 * outcome stays theirs to change (a DLS result, a super over). Null until both
 * primary scores are whole numbers.
 */
export function suggestedOutcome(
  home: string,
  away: string,
): "home_win" | "away_win" | "tie" | null {
  const whole = /^\d+$/;
  if (!whole.test(home.trim()) || !whole.test(away.trim())) {
    return null;
  }
  const h = Number.parseInt(home, 10);
  const a = Number.parseInt(away, 10);
  return h > a ? "home_win" : a > h ? "away_win" : "tie";
}

/** "Both set", "MM set · TT not yet", "Not set" — lineups at a glance. */
export function lineupSummary(
  lineups: { home: number | null; away: number | null },
  homeShort: string,
  awayShort: string,
): string {
  if (lineups.home !== null && lineups.away !== null) return "Lineups set";
  if (lineups.home === null && lineups.away === null) return "Lineups not set";
  return lineups.home !== null
    ? `Lineup: ${homeShort} set · ${awayShort} not yet`
    : `Lineup: ${awayShort} set · ${homeShort} not yet`;
}
