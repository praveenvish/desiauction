import type { TeamSummary } from "../../../../server/competition/competitions";
import { fixtureDashboard } from "../../../../server/competition/fixture-actions";
import { pairingTeams, scheduleStep, type ScheduleStep } from "./schedule-step";

/**
 * The empty schedule's next step, read from the fixtures list's own loader
 * (its gate, its ground inventory) — called only when a page has nothing to
 * show, so a full schedule pays nothing for it.
 */
export async function emptyScheduleStep(slug: string): Promise<ScheduleStep> {
  return (await emptySchedule(slug)).step;
}

/**
 * The same read, with the season's teams: an empty schedule page also draws
 * the round-robin those teams will make (round 5A) — the next object, from
 * the list the generator itself reads.
 */
export async function emptySchedule(
  slug: string,
): Promise<{ step: ScheduleStep; teams: readonly TeamSummary[] }> {
  const dashboard = await fixtureDashboard(slug, {});
  return {
    step: scheduleStep({
      slug,
      orgSlug: dashboard?.orgSlug ?? "",
      teams: dashboard?.teams.length ?? 2,
      grounds: dashboard?.grounds?.length ?? 1,
      canManage: dashboard?.viewer.canManage ?? false,
    }),
    teams: pairingTeams(dashboard?.fixtureShape, dashboard?.teams ?? []),
  };
}
