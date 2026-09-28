/**
 * WHAT IS HAPPENING NOW, for the season overview (2026-09-27) — pure, so it is
 * tested.
 *
 * A season that was playing said nothing about its matches on its own front
 * page: no match on now, no next one, no last result. This picks, from the
 * week the schedule already reads, the few matches worth a line: every one
 * being played, then the next two to come, then the latest result.
 */

export interface NowFixture {
  readonly id: string;
  readonly kickoffAt: string | null;
  readonly status: string;
  readonly homeTeamName: string | null;
  readonly awayTeamName: string | null;
}

export interface NowRow<F extends NowFixture> {
  readonly fixture: F;
  readonly state: "live" | "next" | "result";
}

const UPCOMING = new Set(["scheduled", "published"]);

export function nowRows<F extends NowFixture>(
  rows: readonly F[],
  now: string,
  hasResult: (id: string) => boolean,
): NowRow<F>[] {
  const byKickoff = [...rows].sort((a, b) =>
    (a.kickoffAt ?? "9999").localeCompare(b.kickoffAt ?? "9999"),
  );
  const live = byKickoff.filter((row) => row.status === "in_progress");
  // From the start of TODAY: an unplayed match from this morning is still the
  // next one, not something to skip (census 2026-09-28).
  const today = `${now.slice(0, 10)}T00:00`;
  const next = byKickoff
    .filter((row) => UPCOMING.has(row.status) && (row.kickoffAt ?? "9999") >= today)
    .slice(0, 2);
  const last = byKickoff.filter((row) => row.status === "completed" && hasResult(row.id)).slice(-1);
  return [
    ...live.map((fixture) => ({ fixture, state: "live" as const })),
    ...next.map((fixture) => ({ fixture, state: "next" as const })),
    ...last.map((fixture) => ({ fixture, state: "result" as const })),
  ];
}

/** "Mavericks won", "Tied", "No result" — a result in the words of the table. */
export function resultWords(outcome: string, home: string | null, away: string | null): string {
  if (outcome === "home_win") return `${home ?? "Home"} won`;
  if (outcome === "away_win") return `${away ?? "Away"} won`;
  if (outcome === "tie") return "Tied";
  if (outcome === "abandoned") return "Abandoned";
  return "No result";
}
