import type { HomeTask } from "../../lib/home-tasks";
import { resolveMemberCompetition } from "../competition/resolve";
import { inOrg } from "../tenant";
import { lineupFixtures } from "../competition/lineups";
import { mayPickLineup } from "../competition/lineup-access";
import { PUBLIC_FIXTURE_STATUSES } from "../competition/fixtures";

/** Existing owner/fixture.manage permission, rechecked per side; captain alone adds none. */
export async function homeLineupTasks(
  personId: string,
  seasonSlugs: readonly string[],
): Promise<HomeTask[]> {
  const tasks: HomeTask[] = [];
  for (const slug of [...new Set(seasonSlugs)].sort()) {
    const competition = await resolveMemberCompetition(personId, slug);
    if (!competition) continue;
    const rows = await inOrg(personId, competition.orgId, async (db) => {
      const permitted: HomeTask[] = [];
      const permission = new Map<string, boolean>();
      for (const fixture of await lineupFixtures(db, competition.id)) {
        if (
          !PUBLIC_FIXTURE_STATUSES.includes(
            fixture.status as (typeof PUBLIC_FIXTURE_STATUSES)[number],
          ) ||
          ["completed", "cancelled"].includes(fixture.status)
        )
          continue;
        for (const side of ["home", "away"] as const) {
          const team = fixture[side];
          if (!permission.has(team.id))
            permission.set(team.id, await mayPickLineup(db, personId, competition, team.id));
          if (!permission.get(team.id)) continue;
          const recorded = fixture.recorded[side] !== null;
          permitted.push({
            id: `lineup:${competition.id}:${fixture.id}:${team.id}`,
            kind: "lineup",
            scope: {
              orgId: competition.orgId,
              competitionId: competition.id,
              fixtureId: fixture.id,
              teamId: team.id,
            },
            priority: recorded ? "result" : "prepare",
            dueAt: fixture.kickoffAt,
            state: recorded ? "recorded" : "not_recorded",
            title: recorded ? `${team.name}'s lineup is recorded` : `Prepare ${team.name}'s lineup`,
            context: `${competition.name} · ${fixture.number} · ${fixture.home.name} vs ${fixture.away.name}`,
            explanation: recorded
              ? "Open the match to review your permitted side and its announcement status."
              : "Choose the players for your permitted side. Saving and announcing remain separate steps.",
            action: "Open match lineup",
            href: `/seasons/${slug}/fixtures?match=${fixture.id}`,
            completion:
              "The permitted team's lineup has accepted recorded rows; announcement is separate.",
            retention: "server",
          });
        }
      }
      return permitted;
    });
    tasks.push(...rows);
  }
  return tasks;
}
