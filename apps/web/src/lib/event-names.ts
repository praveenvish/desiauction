/**
 * EVENT NAMES BOTH CONSOLES PRINT — one source.
 *
 * The organizer feed (app/home/home-activity.tsx) and the platform admin
 * (app/admin/admin-ui.tsx) each humanise audit action codes in their own
 * voice. An event whose mechanical fallback read differently on the two
 * ("Registration poster generated" vs "Made a player poster", round-5
 * review) is named here once and both maps read it.
 */
export const SHARED_EVENT_NAMES: Readonly<Record<string, string>> = {
  "registration.poster_generated": "Made a player poster",
  "team.poster_generated": "Made a team poster",
  "season.poster_generated": "Made a season poster",
  // A match's life, in the organizer's words — "Fixture start" and
  // "Fixture result recorded" were the mechanical fallback (census 16).
  "fixture.created": "Match added",
  "fixture.start": "Match started",
  "fixture.complete": "Match finished",
  "fixture.cancel": "Match cancelled",
  "fixture.rescheduled": "Match moved",
  "fixture.result.recorded": "Result entered",
  "fixture.result_recorded": "Result entered",
  "fixture.lineup.recorded": "Lineup saved",
};

const RESULT_ACTIONS = new Set(["fixture.result.recorded", "fixture.result_recorded"]);
const RESULT_BOOKENDS = new Set(["fixture.start", "fixture.complete"]);

/**
 * ONE SAVE, ONE ROW (census 16). Entering an overdue score starts the match,
 * records the result and finishes it — three audit rows for one thing the
 * organizer did, which filled the feed with "Match started · Result entered ·
 * Match finished" three times over. When a match's result is in the same
 * window, its start and finish are folded into it: the result is the news.
 */
export function foldMatchSaves<T extends { action: string; subject: string | null }>(
  rows: readonly T[],
): T[] {
  const scored = new Set(
    rows
      .filter((row) => RESULT_ACTIONS.has(row.action) && row.subject !== null)
      .map((row) => row.subject),
  );
  return rows.filter(
    (row) => !(RESULT_BOOKENDS.has(row.action) && row.subject !== null && scored.has(row.subject)),
  );
}

/** Whether an audit row is about a match (its subject is a fixture id). */
export function isMatchAction(action: string): boolean {
  return action.startsWith("fixture.");
}
