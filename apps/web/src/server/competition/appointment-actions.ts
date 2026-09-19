"use server";

import { withTenantDb } from "@desiauction/db";
import { revalidatePath } from "next/cache";

import { currentSession } from "../auth/actions";
import { dbHandle } from "../db";
import { storage } from "../media";
import { canCompetition } from "./authz";
import { announceAppointments, appointmentsView, roleLabel, rolesLabel } from "./appointments";
import { resolveMemberCompetition } from "./resolve";
import { consentedPhotoUrl } from "./shown-name";
import { sendSquadSheets, squadSheetsView, type SquadSheetsView } from "./squad-sheets";

/**
 * Who may announce appointments and send squad sheets: whoever may set the
 * squads — `team.manage`, the capability the captain / icon / retained toggles
 * and team assignment require.
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
  /** Everyone named, told or not — the table. */
  readonly rows: readonly {
    registrationId: string;
    name: string;
    /** Each current role, labelled ("Captain", "Icon"). */
    roles: readonly { key: string; label: string }[];
    team: string;
    teamColor: string | null;
    /** Consent-gated (DPDP §5); null draws the initials mark. */
    photoUrl: string | null;
    told: boolean;
  }[];
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
      role: rolesLabel(item.roles),
      team: item.teamName,
    })),
    told: view.told,
    rows: view.named.map((item) => ({
      registrationId: item.registrationId,
      name: item.listedName,
      roles: item.roles.map((role) => ({ key: role, label: roleLabel(role) })),
      team: item.teamName,
      teamColor: item.teamColor,
      photoUrl: consentedPhotoUrl(item, (key) => storage.readUrl(key)),
      told: item.told,
    })),
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

// --- Squad sheets ("Meet your squad") -----------------------------------------

export type SquadSheetsPanelView = SquadSheetsView;

export async function squadSheetsPanelView(slug: string): Promise<SquadSheetsPanelView | null> {
  const gated = await gate(slug);
  if (gated === null) return null;
  const { personId, competition } = gated;
  return withTenantDb(dbHandle, { personId, orgId: competition.orgId }, (db) =>
    squadSheetsView(db, competition.id),
  );
}

export async function sendSquadSheetsAction(
  slug: string,
): Promise<{ ok: true; sent: number } | { ok: false; error: string }> {
  const gated = await gate(slug);
  if (gated === null) {
    return { ok: false, error: "You can't send squad sheets for this season." };
  }
  const { personId, competition } = gated;
  const result = await withTenantDb(dbHandle, { personId, orgId: competition.orgId }, (db) =>
    sendSquadSheets(db, { competitionId: competition.id, actorId: personId }),
  );
  if (!result.ok) {
    return { ok: false, error: result.reason };
  }
  revalidatePath(`/seasons/${slug}/teams`);
  return { ok: true, sent: result.sent };
}
