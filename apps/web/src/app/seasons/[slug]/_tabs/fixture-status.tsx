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

/** The status word itself — "in progress" — as the suites and readers see it. */
export function FixtureStatusPill({ status }: { status: FixtureStatus }) {
  return (
    <span className="fx-status">
      <Pill tone={FIXTURE_TONE[status]} dot={status === "in_progress"}>
        {status.replace(/_/g, " ")}
      </Pill>
    </span>
  );
}
