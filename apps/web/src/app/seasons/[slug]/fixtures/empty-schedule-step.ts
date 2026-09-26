import { fixtureDashboard } from "../../../../server/competition/fixture-actions";
import { scheduleStep, type ScheduleStep } from "./schedule-step";

/**
 * The empty schedule's next step, read from the fixtures list's own loader
 * (its gate, its ground inventory) — called only when a page has nothing to
 * show, so a full schedule pays nothing for it.
 */
export async function emptyScheduleStep(slug: string): Promise<ScheduleStep> {
  const dashboard = await fixtureDashboard(slug, {});
  return scheduleStep({
    slug,
    orgSlug: dashboard?.orgSlug ?? "",
    teams: dashboard?.teams.length ?? 2,
    grounds: dashboard?.grounds?.length ?? 1,
    canManage: dashboard?.viewer.canManage ?? false,
  });
}
