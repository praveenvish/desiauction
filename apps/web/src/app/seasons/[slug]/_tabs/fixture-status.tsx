import { Pill, type KitTone } from "@desiauction/ui";
import type { FixtureStatus } from "@desiauction/core";

// The console's one colour grammar: grey not started, blue set and open,
// red live, green done. "Published" was green and "completed" grey — the
// schedule read as finished before a ball was bowled, and finished as idle.
// A cancelled match is closed, not an alarm. One table for the fixtures
// panel, the calendar and match day, so the three cannot disagree.
export const FIXTURE_TONE: Record<FixtureStatus, KitTone> = {
  draft: "neutral",
  scheduled: "neutral",
  published: "blue",
  in_progress: "red",
  completed: "green",
  cancelled: "neutral",
};

/**
 * Whether a match's day has passed with no result: published and never
 * started, or started and left open. It is not "published" (waiting to be
 * played) nor "in progress" (being played) any more — someone owes a result.
 */
export function awaitsResult(
  fixture: { status: string; kickoffAt: string | null },
  today: string,
): boolean {
  return (
    (fixture.status === "published" || fixture.status === "in_progress") &&
    fixture.kickoffAt !== null &&
    fixture.kickoffAt.slice(0, 10) < today.slice(0, 10)
  );
}

/** The status word itself — "in progress" — as the suites and readers see it. */
export function FixtureStatusPill({
  status,
  overdue = false,
}: {
  status: FixtureStatus;
  /** Its day has passed with no result (see `awaitsResult`). */
  overdue?: boolean;
}) {
  if (overdue) {
    return (
      <span className="fx-status" data-due="true">
        <Pill tone="amber">Result due</Pill>
      </span>
    );
  }
  return (
    <span className="fx-status">
      <Pill tone={FIXTURE_TONE[status]} dot={status === "in_progress"}>
        {status.replace(/_/g, " ")}
      </Pill>
    </span>
  );
}
