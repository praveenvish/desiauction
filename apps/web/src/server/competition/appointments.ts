import {
  auctions,
  auditLog,
  competitions,
  lots,
  messageOutbox,
  newId,
  organizations,
  people,
  registrations,
  teams,
  type Db,
} from "@desiauction/db";
import { and, asc, eq, isNotNull, like, or, sql } from "drizzle-orm";

import { logSecurityEvent } from "../auth/security-events";
import { db as appDb } from "../db";
import { enqueueMail, enqueueSms, kickDrain, type QueuedMail } from "../messaging/outbox";
import { appointmentMail, smsRolePhrase, type AppointedRole } from "../messaging/player-mail";
import { smsFit, smsSeasonName } from "../messaging/templates";
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
 * ONE message per person per team, however many roles: a captain who is also
 * the icon hears "You're the captain and icon player", not two emails. What
 * was told is kept per role, in the outbox's dedupe key
 * (`team.appointed:{registration}:{team}:{roles}`), so a role added later is
 * announced on its own and nothing is said twice. Moving to another team is a
 * new appointment and is told again.
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
  /** The roles held now (in the view: the roles not yet announced). */
  readonly roles: readonly AppointedRole[];
  /** A sale in this season's auction put them on the team (see appointmentMail). */
  readonly bought: boolean;
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

/** "Captain & Icon" — the organizer's list and the inbox line. */
export function rolesLabel(roles: readonly AppointedRole[]): string {
  return roles.map(roleLabel).join(" & ");
}

function keyPrefix(item: Pick<Appointment, "registrationId" | "teamId">): string {
  return `team.appointed:${item.registrationId}:${item.teamId}:`;
}

function dedupeKey(item: Pick<Appointment, "registrationId" | "teamId" | "roles">): string {
  return `${keyPrefix(item)}${[...item.roles].sort().join("+")}`;
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
      bought: sql<boolean>`exists (
        select 1 from ${lots} join ${auctions} on ${auctions.id} = ${lots.auctionId}
        where ${lots.registrationId} = ${registrations.id}
          and ${lots.status} = 'sold' and ${auctions.status} <> 'abandoned')`,
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
  return rows.map((row) => ({
    registrationId: row.registrationId,
    personId: row.personId,
    listedName: row.listedName ?? "Player",
    greetingName: row.greetingName?.trim() || "there",
    teamId: row.teamId ?? "",
    teamName: row.teamName,
    roles: [
      ...(row.isCaptain ? (["captain"] as const) : []),
      ...(row.isViceCaptain ? (["vice_captain"] as const) : []),
      ...(row.isIcon ? (["icon"] as const) : []),
      ...(row.isRetained ? (["retained"] as const) : []),
    ],
    bought: row.bought,
  }));
}

/**
 * The roles already announced to each person on each team, keyed by
 * `keyPrefix` — read from the queue (no RLS), where every announcement left its
 * dedupe key.
 */
async function toldRoles(all: readonly Appointment[]): Promise<Map<string, Set<string>>> {
  const told = new Map<string, Set<string>>();
  if (all.length === 0) return told;
  const rows = await appDb
    .select({ key: messageOutbox.dedupeKey })
    .from(messageOutbox)
    .where(or(...all.map((item) => like(messageOutbox.dedupeKey, `${keyPrefix(item)}%`))));
  for (const { key } of rows) {
    const cut = key.lastIndexOf(":") + 1;
    const prefix = key.slice(0, cut);
    const roles = told.get(prefix) ?? new Set<string>();
    for (const role of key.slice(cut).split("+")) roles.add(role);
    told.set(prefix, roles);
  }
  return told;
}

export interface AppointmentsView {
  /** One entry per person and team, carrying only the roles not yet told. */
  readonly pending: readonly Appointment[];
  /** People whose every current role has been announced. */
  readonly told: number;
}

/** Who is named but not yet told, and how many already were. */
export async function appointmentsView(db: Db, competitionId: string): Promise<AppointmentsView> {
  const all = await appointmentsOf(db, competitionId);
  const told = await toldRoles(all);
  const pending = all
    .map((item) => {
      const already = told.get(keyPrefix(item));
      return { ...item, roles: item.roles.filter((role) => already?.has(role) !== true) };
    })
    .filter((item) => item.roles.length > 0);
  return { pending, told: all.length - pending.length };
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
  const { pending } = await appointmentsView(db, input.competitionId);
  const mails: QueuedMail[] = pending.map((item) => ({
    personId: item.personId,
    orgId: context.orgId,
    kind: "team.appointed",
    dedupeKey: dedupeKey(item),
    ...appointmentMail({
      name: item.greetingName,
      season: context.season,
      orgName: context.orgName,
      teamName: item.teamName,
      roles: item.roles,
      bought: item.bought,
    }),
  }));
  const fresh = new Set(await enqueueMail(mails));
  const told = pending.filter((item) => fresh.has(dedupeKey(item)));
  // And one line of SMS each — most players have no verified email. Keyed apart
  // (`sms:`) so it never reads as a told role in `toldRoles`.
  await enqueueSms(
    told.map((item) => ({
      personId: item.personId,
      orgId: context.orgId,
      kind: "team.appointed",
      dedupeKey: `sms:${dedupeKey(item)}`,
      templateKey: "team.appointed" as const,
      slots: {
        role: smsRolePhrase(item.roles),
        team: smsFit(item.teamName),
        competition: smsSeasonName(context.season),
      },
    })),
  );
  for (const item of told) {
    try {
      await logSecurityEvent(item.personId, "team.appointed", {
        competitionId: input.competitionId,
        competition: context.season,
        team: item.teamName,
        role: rolesLabel(item.roles),
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
