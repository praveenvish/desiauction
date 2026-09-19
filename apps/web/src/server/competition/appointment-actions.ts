"use server";

import { withTenantDb } from "@desiauction/db";
import { revalidatePath } from "next/cache";

import { currentSession } from "../auth/actions";
import { dbHandle } from "../db";
import { canCompetition } from "./authz";
import { announceAppointments, appointmentsView, roleLabel } from "./appointments";
import { resolveMemberCompetition } from "./resolve";

/**
 * Who may announce appointments: whoever may set them — `team.manage`, the
 * same capability the captain / icon / retained toggles require.
 */
async function gate(slug: string) {
  const session = await currentSession();
  if (session === null) return null;
  const competition = await resolveMemberCompetition(session.personId, slug);
  if (competition === null) return null;
  const allowed = await withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: competition.orgId },
    (db) =>
      canCompetition(
        db,
        session.personId,
        { orgId: competition.orgId, competitionId: competition.id },
        "team.manage",
      ),
  );
  return allowed ? { personId: session.personId, competition } : null;
}

export interface AppointmentsPanelView {
  readonly pending: readonly { name: string; role: string; team: string }[];
  readonly told: number;
}

export async function appointmentsPanelView(slug: string): Promise<AppointmentsPanelView | null> {
  const gated = await gate(slug);
  if (gated === null) return null;
  const { personId, competition } = gated;
  const view = await withTenantDb(dbHandle, { personId, orgId: competition.orgId }, (db) =>
    appointmentsView(db, competition.id),
  );
  return {
    pending: view.pending.map((item) => ({
      name: item.listedName,
      role: roleLabel(item.role),
      team: item.teamName,
    })),
    told: view.told,
  };
}

export async function announceAppointmentsAction(
  slug: string,
): Promise<{ ok: true; told: number } | { ok: false; error: string }> {
  const gated = await gate(slug);
  if (gated === null) {
    return { ok: false, error: "You can't announce appointments for this season." };
  }
  const { personId, competition } = gated;
  const told = await withTenantDb(dbHandle, { personId, orgId: competition.orgId }, (db) =>
    announceAppointments(db, { competitionId: competition.id, actorId: personId }),
  );
  revalidatePath(`/seasons/${slug}/teams`);
  return { ok: true, told };
}
