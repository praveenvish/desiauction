import {
  auditLog,
  competitions,
  messageOutbox,
  newId,
  organizations,
  people,
  registrations,
  teams,
  type Db,
} from "@desiauction/db";
import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";

import { logSecurityEvent } from "../auth/security-events";
import { db as appDb } from "../db";
import { enqueueMail, kickDrain, type QueuedMail } from "../messaging/outbox";
import { appointmentMail, type AppointedRole } from "../messaging/player-mail";
import { shownName } from "./shown-name";

/**
 * TELLING PEOPLE THEY WERE NAMED — captain, vice-captain, icon, retained.
 *
 * The marks are toggles an organizer flips while building squads, so they are
 * NOT announced as they change: a captain chosen and un-chosen in a minute must
 * not receive "congratulations" and silence. The organizer presses Announce
 * (founder decision) and everyone named but not yet told hears once — by email
 * where they have a verified address, and always in their inbox.
 *
 * "Not yet told" is the outbox's dedupe key: one per registration, role and
 * team. A second press tells only the new names; moving a captain to another
 * team is a new appointment and is told again.
 */

export interface Appointment {
  readonly registrationId: string;
  readonly personId: string;
  /** How the club lists them (typed names, 0075) — for the organizer's view. */
  readonly listedName: string;
  /** How the email greets them — their own account name. */
  readonly greetingName: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly role: AppointedRole;
}

const ROLE_LABEL: Record<AppointedRole, string> = {
  captain: "Captain",
  vice_captain: "Vice-captain",
  icon: "Icon",
  retained: "Retained",
};

export function roleLabel(role: AppointedRole): string {
  return ROLE_LABEL[role];
}

function dedupeKey(item: Pick<Appointment, "registrationId" | "role" | "teamId">): string {
  return `team.appointed:${item.registrationId}:${item.role}:${item.teamId}`;
}

/** Everyone currently named to a role on a team in this season. */
export async function appointmentsOf(db: Db, competitionId: string): Promise<Appointment[]> {
  const rows = await db
    .select({
      registrationId: registrations.id,
      personId: registrations.personId,
      listedName: shownName,
      greetingName: people.name,
      teamId: registrations.teamId,
      teamName: teams.name,
      isCaptain: registrations.isCaptain,
      isViceCaptain: registrations.isViceCaptain,
      isIcon: registrations.isIcon,
      isRetained: registrations.isRetained,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .innerJoin(teams, eq(teams.id, registrations.teamId))
    .where(
      and(
        eq(registrations.competitionId, competitionId),
        eq(registrations.status, "approved"),
        isNotNull(registrations.teamId),
        or(
          eq(registrations.isCaptain, true),
          eq(registrations.isViceCaptain, true),
          eq(registrations.isIcon, true),
          eq(registrations.isRetained, true),
        ),
      ),
    )
    .orderBy(asc(teams.name), asc(shownName));
  return rows.flatMap((row) => {
    const roles: AppointedRole[] = [
      ...(row.isCaptain ? (["captain"] as const) : []),
      ...(row.isViceCaptain ? (["vice_captain"] as const) : []),
      ...(row.isIcon ? (["icon"] as const) : []),
      ...(row.isRetained ? (["retained"] as const) : []),
    ];
    return roles.map((role) => ({
      registrationId: row.registrationId,
      personId: row.personId,
      listedName: row.listedName ?? "Player",
      greetingName: row.greetingName?.trim() || "there",
      teamId: row.teamId ?? "",
      teamName: row.teamName,
      role,
    }));
  });
}

/** The appointments already announced, by dedupe key (the queue, no RLS). */
async function announcedKeys(keys: readonly string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await appDb
    .select({ key: messageOutbox.dedupeKey })
    .from(messageOutbox)
    .where(inArray(messageOutbox.dedupeKey, [...keys]));
  return new Set(rows.map((row) => row.key));
}

export interface AppointmentsView {
  readonly pending: readonly Appointment[];
  readonly told: number;
}

/** Who is named but not yet told, and how many already were. */
export async function appointmentsView(db: Db, competitionId: string): Promise<AppointmentsView> {
  const all = await appointmentsOf(db, competitionId);
  const told = await announcedKeys(all.map(dedupeKey));
  return {
    pending: all.filter((item) => !told.has(dedupeKey(item))),
    told: all.length - all.filter((item) => !told.has(dedupeKey(item))).length,
  };
}

/**
 * Announce everyone named but not yet told. Returns how many were told now.
 * The inbox row is written only for a NEW announcement, so a second press
 * adds nothing to anybody's inbox either.
 */
export async function announceAppointments(
  db: Db,
  input: { competitionId: string; actorId: string },
): Promise<number> {
  const [context] = await db
    .select({ season: competitions.name, orgId: competitions.orgId, orgName: organizations.name })
    .from(competitions)
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(eq(competitions.id, input.competitionId))
    .limit(1);
  if (context === undefined) {
    return 0;
  }
  const all = await appointmentsOf(db, input.competitionId);
  const mails: QueuedMail[] = all.map((item) => ({
    personId: item.personId,
    orgId: context.orgId,
    kind: "team.appointed",
    dedupeKey: dedupeKey(item),
    ...appointmentMail({
      name: item.greetingName,
      season: context.season,
      orgName: context.orgName,
      teamName: item.teamName,
      role: item.role,
    }),
  }));
  const fresh = new Set(await enqueueMail(mails));
  const told = all.filter((item) => fresh.has(dedupeKey(item)));
  for (const item of told) {
    try {
      await logSecurityEvent(item.personId, "team.appointed", {
        competitionId: input.competitionId,
        competition: context.season,
        team: item.teamName,
        role: ROLE_LABEL[item.role],
      });
    } catch {
      // The email is queued; one unwritable inbox row must not stop the rest.
    }
  }
  if (told.length > 0) {
    await db.insert(auditLog).values({
      id: newId(),
      actor: input.actorId,
      action: "team.appointments.announced",
      scopeType: "org",
      scopeId: context.orgId,
      subject: input.competitionId,
      meta: { count: String(told.length) },
    });
    kickDrain();
  }
  return told.length;
}
