/**
 * THE REAL NEXT STEP FOR AN EMPTY SCHEDULE.
 *
 * Lineups, Calendar and Match day all said "Build the schedule" and landed on
 * the fixtures list's venue gate ("Add a ground first"). When the club has no
 * ground, the step is the venue; otherwise it is the schedule. Two teams come
 * before either — a schedule of one team is not one.
 */
export interface ScheduleStep {
  readonly label: string;
  readonly href: string;
  /** One sentence for the empty state's body. */
  readonly why: string;
}

export function scheduleStep(input: {
  slug: string;
  orgSlug: string;
  teams: number;
  grounds: number;
  canManage: boolean;
}): ScheduleStep {
  if (input.canManage && input.teams < 2) {
    return {
      label: "Add teams",
      href: `/seasons/${input.slug}/teams`,
      why: "A schedule needs at least two teams.",
    };
  }
  if (input.canManage && input.grounds === 0) {
    return {
      label: "Add a venue",
      href: `/org/${input.orgSlug}/venues`,
      why: "Matches are scheduled onto grounds, and the club has none yet.",
    };
  }
  return {
    label: "Build the schedule",
    href: `/seasons/${input.slug}/fixtures`,
    why: "Create the fixtures from the list.",
  };
}
