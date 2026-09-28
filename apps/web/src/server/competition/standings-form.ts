/**
 * FORM AND NEXT MATCH, per team — the two columns a league table is read for
 * after the points: who is on a run, and who they play next. Pure, over the
 * season's fixtures and its recorded results.
 */

export type FormLetter = "W" | "L" | "T" | "N";

export interface FormFixture {
  readonly id: string;
  readonly homeTeamId: string | null;
  readonly awayTeamId: string | null;
  readonly homeTeamName: string | null;
  readonly awayTeamName: string | null;
  readonly kickoffAt: string | null;
  readonly status: string;
}

export interface TeamNext {
  readonly fixtureId: string;
  /** Null for a lobby, which has no single opponent. */
  readonly opponent: string | null;
  readonly kickoffAt: string | null;
  readonly live: boolean;
  /** Its day passed with no result — the team's next job is that score (census 9). */
  readonly due?: boolean;
}

const FORM_LENGTH = 5;

/** A team's last five results, oldest first — duels only; a lobby has no W or L. */
export function formOf(
  fixtures: readonly FormFixture[],
  outcomes: ReadonlyMap<string, string>,
): Map<string, FormLetter[]> {
  const form = new Map<string, FormLetter[]>();
  const push = (teamId: string, letter: FormLetter) => {
    const list = form.get(teamId) ?? [];
    list.push(letter);
    form.set(teamId, list);
  };
  const played = [...fixtures]
    .filter((fixture) => fixture.homeTeamId !== null && fixture.awayTeamId !== null)
    .filter((fixture) => fixture.status === "completed" || fixture.status === "in_progress")
    .sort((a, b) => (a.kickoffAt ?? "").localeCompare(b.kickoffAt ?? ""));
  for (const fixture of played) {
    const outcome = outcomes.get(fixture.id);
    const home = fixture.homeTeamId;
    const away = fixture.awayTeamId;
    if (outcome === undefined || home === null || away === null) {
      continue;
    }
    if (outcome === "home_win") {
      push(home, "W");
      push(away, "L");
    } else if (outcome === "away_win") {
      push(home, "L");
      push(away, "W");
    } else if (outcome === "tie") {
      push(home, "T");
      push(away, "T");
    } else if (outcome === "no_result") {
      push(home, "N");
      push(away, "N");
    }
    // Abandoned never started: it is no part of anybody's form.
  }
  for (const [teamId, list] of form) {
    form.set(teamId, list.slice(-FORM_LENGTH));
  }
  return form;
}

/**
 * Each team's match being played now, else its next dated one still to come.
 *
 * "Still to come" counts from the START of today, not this minute: a match
 * on today at 9:30 that has not been played is still the team's next, not
 * something to skip past to next week (census 2026-09-28 — the Table said
 * "Sun, 4 Oct" for a team playing that morning).
 */
export function nextOf(fixtures: readonly FormFixture[], now: string): Map<string, TeamNext> {
  const next = new Map<string, TeamNext>();
  const today = `${now.slice(0, 10)}T00:00`;
  const ordered = [...fixtures].sort((a, b) =>
    (a.kickoffAt ?? "9999").localeCompare(b.kickoffAt ?? "9999"),
  );
  const consider = (fixture: FormFixture, live: boolean, due = false) => {
    const sides: [string | null, string | null][] = [
      [fixture.homeTeamId, fixture.awayTeamName],
      [fixture.awayTeamId, fixture.homeTeamName],
    ];
    for (const [teamId, opponent] of sides) {
      if (teamId === null || next.has(teamId)) {
        continue;
      }
      next.set(teamId, {
        fixtureId: fixture.id,
        opponent: fixture.homeTeamId === null ? null : opponent,
        kickoffAt: fixture.kickoffAt,
        live,
        ...(due ? { due } : {}),
      });
    }
  };
  const pastDay = (fixture: FormFixture) => fixture.kickoffAt !== null && fixture.kickoffAt < today;
  // Being played today first; then a match whose day passed with no result —
  // left open, or never started — which is owed before anything to come.
  for (const fixture of ordered) {
    if (fixture.status === "in_progress" && !pastDay(fixture)) {
      consider(fixture, true);
    }
  }
  for (const fixture of ordered) {
    if ((fixture.status === "in_progress" || fixture.status === "published") && pastDay(fixture)) {
      consider(fixture, false, true);
    }
  }
  for (const fixture of ordered) {
    if (
      (fixture.status === "published" || fixture.status === "scheduled") &&
      fixture.kickoffAt !== null &&
      fixture.kickoffAt >= today
    ) {
      consider(fixture, false);
    }
  }
  return next;
}
