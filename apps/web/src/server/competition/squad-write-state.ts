import { registrations, type Db } from "@desiauction/db";
import { boundedStringList } from "./write-state-input";
import { and, eq, inArray, or } from "drizzle-orm";

/** Minimal team-manage reconciliation. No contact, fee, photo or review payload. */
export async function squadWriteState(
  db: Db,
  competitionId: string,
  ids: readonly string[],
  requestedTeams: readonly string[],
) {
  if (!boundedStringList(ids, 1, 3) || !boundedStringList(requestedTeams, 0, 2)) return null;
  const selected = await db
    .select({ id: registrations.id, teamId: registrations.teamId })
    .from(registrations)
    .where(
      and(eq(registrations.competitionId, competitionId), inArray(registrations.id, [...ids])),
    );
  if (selected.length !== new Set(ids).size) return null;
  const teams = [
    ...new Set([
      ...requestedTeams,
      ...selected.map((row) => row.teamId).filter((id): id is string => id !== null),
    ]),
  ];
  const rows = await db
    .select({
      id: registrations.id,
      teamId: registrations.teamId,
      isCaptain: registrations.isCaptain,
      isIcon: registrations.isIcon,
      isRetained: registrations.isRetained,
    })
    .from(registrations)
    .where(
      and(
        eq(registrations.competitionId, competitionId),
        or(
          inArray(registrations.id, [...ids]),
          teams.length
            ? and(eq(registrations.isCaptain, true), inArray(registrations.teamId, teams))
            : undefined,
        ),
      ),
    );
  return { rows, teams };
}
