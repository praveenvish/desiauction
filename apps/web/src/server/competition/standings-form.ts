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

/** Each team's match being played now, else its next dated one still to come. */
export function nextOf(fixtures: readonly FormFixture[], now: string): Map<string, TeamNext> {
  const next = new Map<string, TeamNext>();
  const ordered = [...fixtures].sort((a, b) =>
    (a.kickoffAt ?? "9999").localeCompare(b.kickoffAt ?? "9999"),
  );
  const consider = (fixture: FormFixture, live: boolean) => {
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
      });
    }
  };
  for (const fixture of ordered) {
    if (fixture.status === "in_progress") {
      consider(fixture, true);
    }
  }
  for (const fixture of ordered) {
    if (
      (fixture.status === "published" || fixture.status === "scheduled") &&
      fixture.kickoffAt !== null &&
      fixture.kickoffAt >= now
    ) {
      consider(fixture, false);
    }
  }
  return next;
}
