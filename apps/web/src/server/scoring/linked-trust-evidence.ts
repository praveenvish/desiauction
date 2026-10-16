import { matchConfirmations, teamManagers, type Db } from "@desiauction/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { isPlacementState, type ScoringState } from "./family-state";
import type { TrustEvidence } from "./trust-ledger";

/** Shared canonical linkage. Placement alone requires a still-current manager. */
export async function linkedTrustEvidence(
  db: Db,
  match: { fixtureId: string; orgId: string; competitionId: string },
  state: ScoringState,
  evidence: readonly TrustEvidence[],
) {
  const confirmations = await db
    .select()
    .from(matchConfirmations)
    .where(
      and(
        eq(matchConfirmations.fixtureId, match.fixtureId),
        eq(matchConfirmations.orgId, match.orgId),
        eq(matchConfirmations.competitionId, match.competitionId),
      ),
    );
  const currentManagers = isPlacementState(state)
    ? await db
        .select({ personId: teamManagers.personId, teamId: teamManagers.teamId })
        .from(teamManagers)
        .where(
          and(
            eq(teamManagers.orgId, match.orgId),
            eq(teamManagers.competitionId, match.competitionId),
            inArray(teamManagers.teamId, state.teamIds),
            isNull(teamManagers.revokedAt),
          ),
        )
    : [];
  return evidence.filter(
    (row) =>
      row.action !== "match.trust.confirmation" ||
      ((!isPlacementState(state) ||
        currentManagers.some(
          (manager) => manager.personId === row.actor && manager.teamId === row.meta.teamId,
        )) &&
        confirmations.some(
          (confirmation) =>
            row.meta.confirmationId === confirmation.id && row.meta.teamId === confirmation.teamId,
        )),
  );
}
