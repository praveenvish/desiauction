import { competitions, teams } from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import { withConfirmationNoticeContext } from "./confirmation-notice-link";
import { isPlacementState } from "./family-state";
import { linkedTrustEvidence } from "./linked-trust-evidence";
import { trustEvidence } from "./trust-ledger";
import { confirmationTaskState } from "./confirmation-task-state";
import { reminderBoundaries, type ReminderBoundaries } from "./reminder-boundaries";

export async function confirmationHomeTask(
  personId: string,
  noticeId: string,
  boundaries: ReminderBoundaries = reminderBoundaries,
  now = new Date(),
) {
  return withConfirmationNoticeContext(
    async (db, context) => {
      const { fixture, match, state, address } = context;
      const ids = isPlacementState(state)
        ? state.teamIds
        : [fixture.homeTeamId, fixture.awayTeamId].filter((id): id is string => id !== null);
      const sides = await db
        .select({ id: teams.id, name: teams.name })
        .from(teams)
        .where(
          and(
            eq(teams.orgId, match.orgId),
            eq(teams.competitionId, match.competitionId),
            inArray(teams.id, ids),
          ),
        );
      const [season] = await db
        .select({ name: competitions.name })
        .from(competitions)
        .where(and(eq(competitions.orgId, match.orgId), eq(competitions.id, match.competitionId)));
      const represented = sides.find((team) => team.id === address.teamId);
      if (!season || !represented) return null;
      const linked = await linkedTrustEvidence(db, match, state, await trustEvidence(db, fixture));
      return {
        key: `${match.orgId}:${match.competitionId}:${fixture.id}:${address.teamId}:${String(address.attempt)}:${String(address.lastSeq)}`,
        scope: {
          orgId: match.orgId,
          competitionId: match.competitionId,
          fixtureId: fixture.id,
          teamId: address.teamId,
        },
        state: confirmationTaskState(linked, address, address.teamId),
        team: represented.name,
        context: `${season.name} · ${fixture.fixtureNumber} · ${sides.map((team) => team.name).join(isPlacementState(state) ? ", " : " vs ")}`,
        href: `/inbox?confirmation=${noticeId}`,
      };
    },
    personId,
    noticeId,
    boundaries,
    now,
  );
}
