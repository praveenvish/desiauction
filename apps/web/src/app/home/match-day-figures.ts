/**
 * THE MATCH-DAY FIGURES under a player's next match (census 17) — pure, so
 * it is tested.
 *
 * The hero's figures were season totals — won–lost, matches to come, the
 * price, the squad size — the same every visit between matches, and two of
 * them repeated cards below it. What a player opens the app for in the week
 * is: how long until the match, am I in, how did the last one go.
 */

export interface MatchDayFigure {
  readonly key: "kickoff" | "lineup" | "last" | "record";
  readonly value: string;
  readonly label: string;
  /** "good" for a place in the lineup or a win; "bad" for a loss. */
  readonly tone?: "good" | "bad";
}

const DAY_MS = 86_400_000;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

const LAST_WORD = { won: "Won", lost: "Lost", tied: "Tied", no_result: "No result" } as const;

export function matchDayFigures(input: {
  next: { kickoffAt: string | null; announcedIn: boolean; time: string | null } | undefined;
  last: { result: "won" | "lost" | "tied" | "no_result"; opponentName: string } | undefined;
  record: { won: number; lost: number; played: number };
  today: string;
}): MatchDayFigure[] {
  const out: MatchDayFigure[] = [];
  const { next, last, record, today } = input;
  if (next !== undefined) {
    const day = next.kickoffAt?.slice(0, 10) ?? null;
    const dated = day !== null && /^\d{4}-\d{2}-\d{2}$/.test(day);
    const away = dated ? daysBetween(today, day) : null;
    const at = next.time === null ? "kickoff" : `${next.time} kickoff`;
    out.push(
      away === null || away < 0
        ? { key: "kickoff", value: "To be set", label: "kickoff" }
        : away === 0
          ? { key: "kickoff", value: "Today", label: at }
          : away === 1
            ? { key: "kickoff", value: "Tomorrow", label: at }
            : { key: "kickoff", value: `${String(away)} days`, label: "to kickoff" },
    );
    // Only an announcement is the player's to know — a saved, unannounced
    // lineup (or a place taken away after it) says nothing.
    out.push(
      next.announcedIn
        ? { key: "lineup", value: "You're in", label: "lineup announced", tone: "good" }
        : { key: "lineup", value: "Awaited", label: "lineup" },
    );
  }
  if (last !== undefined) {
    out.push({
      key: "last",
      value: LAST_WORD[last.result],
      label: `last result · vs ${last.opponentName}`,
      ...(last.result === "won"
        ? { tone: "good" as const }
        : last.result === "lost"
          ? { tone: "bad" as const }
          : {}),
    });
  }
  if (record.played > 0) {
    out.push({
      key: "record",
      value: `${String(record.won)} – ${String(record.lost)}`,
      label: "won – lost",
    });
  }
  return out;
}
