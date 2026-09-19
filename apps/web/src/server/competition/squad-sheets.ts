import {
  auctions,
  auditLog,
  competitions,
  fixtureParticipants,
  messageOutbox,
  newId,
  organizations,
  people,
  registrations,
  teams,
  type Db,
} from "@desiauction/db";
import { and, asc, eq, inArray, isNotNull, like } from "drizzle-orm";

import { formatKickoff } from "../../lib/format-date";
import { logSecurityEvent } from "../auth/security-events";
import { db as appDb } from "../db";
import { enqueueMail, kickDrain, type QueuedMail } from "../messaging/outbox";
import { squadSheetMail, type SquadLine } from "../messaging/player-mail";
import { nowWallClock, upcomingFixtures, type FixtureSnapshot } from "./fixtures";
import { shownName } from "./shown-name";

/**
 * "MEET YOUR SQUAD" — the whole team, to everyone on it.
 *
 * The sale email tells a player who bought them; the captain and the icons
 * were never sold and heard about their team only through their appointment.
 * Once the squads are set, the organizer presses Send and every squad member
 * gets the same sheet: who they play with, who leads, who coaches, and when the
 * first match is.
 *
 * Organizer-sent, not automatic, because "set" is the organizer's call: squads
 * move after the hammer (a replacement, a late retention). Nothing is sent while
 * an auction is still to run or running. A second press sends only to people
 * who have not had their sheet for their CURRENT team — the outbox key is
 * `squad.sheet:{season}:{registration}:{team}`, so a player moved to another
 * team gets the new team's sheet and nobody gets one twice.
 */

const KEY_PREFIX = "squad.sheet:";

function sheetKey(competitionId: string, registrationId: string, teamId: string): string {
  return `${KEY_PREFIX}${competitionId}:${registrationId}:${teamId}`;
}

interface Member {
  registrationId: string;
  personId: string;
  listedName: string;
  greetingName: string;
  teamId: string;
  isCaptain: boolean;
  isViceCaptain: boolean;
  isIcon: boolean;
  isRetained: boolean;
}

async function membersOf(db: Db, competitionId: string): Promise<Member[]> {
  const rows = await db
    .select({
      registrationId: registrations.id,
      personId: registrations.personId,
      listedName: shownName,
      greetingName: people.name,
      teamId: registrations.teamId,
      isCaptain: registrations.isCaptain,
      isViceCaptain: registrations.isViceCaptain,
      isIcon: registrations.isIcon,
      isRetained: registrations.isRetained,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(
      and(
        eq(registrations.competitionId, competitionId),
        eq(registrations.status, "approved"),
        isNotNull(registrations.teamId),
      ),
    )
    .orderBy(asc(shownName));
  return rows.map((row) => ({
    ...row,
    listedName: row.listedName ?? "Player",
    greetingName: row.greetingName?.trim() || "there",
    teamId: row.teamId ?? "",
  }));
}

/** Leaders first — captain, vice-captain, icons, retained — then by name. */
function rank(member: Member): number {
  if (member.isCaptain) return 0;
  if (member.isViceCaptain) return 1;
  if (member.isIcon) return 2;
  if (member.isRetained) return 3;
  return 4;
}

function noteOf(member: Member): string {
  const tags = [
    member.isCaptain ? "Captain" : null,
    member.isViceCaptain ? "Vice-captain" : null,
    member.isIcon ? "Icon" : null,
    member.isRetained ? "Retained" : null,
  ].filter((tag): tag is string => tag !== null);
  return tags.join(" · ");
}

/** Sheets already queued for this season, by key (the queue, no RLS). */
async function sentKeys(competitionId: string): Promise<Set<string>> {
  const rows = await appDb
    .select({ key: messageOutbox.dedupeKey })
    .from(messageOutbox)
    .where(like(messageOutbox.dedupeKey, `${KEY_PREFIX}${competitionId}:%`));
  return new Set(rows.map((row) => row.key));
}

/** Why sheets cannot go yet, or null when they can. */
async function blockedBy(db: Db, competitionId: string): Promise<string | null> {
  const [open] = await db
    .select({ status: auctions.status })
    .from(auctions)
    .where(
      and(
        eq(auctions.competitionId, competitionId),
        inArray(auctions.status, ["scheduled", "live", "paused"]),
      ),
    )
    .limit(1);
  if (open !== undefined) {
    return open.status === "scheduled"
      ? "Squads are set at the auction — send these once it is over."
      : "The auction is still running — send these once it is over.";
  }
  return null;
}

export interface SquadSheetsView {
  /** Why they cannot be sent yet; null when they can. */
  readonly blocked: string | null;
  /** Squad members who have not had the sheet for their current team. */
  readonly pending: number;
  readonly sent: number;
  readonly teams: number;
}

export async function squadSheetsView(db: Db, competitionId: string): Promise<SquadSheetsView> {
  const [members, sent, blocked] = await Promise.all([
    membersOf(db, competitionId),
    sentKeys(competitionId),
    blockedBy(db, competitionId),
  ]);
  const pending = members.filter(
    (member) => !sent.has(sheetKey(competitionId, member.registrationId, member.teamId)),
  ).length;
  return {
    blocked,
    pending,
    sent: members.length - pending,
    teams: new Set(members.map((member) => member.teamId)).size,
  };
}

/** Each team's next published match, as one line for the sheet. */
async function firstMatches(
  db: Db,
  competitionId: string,
  teamIds: readonly string[],
  now: Date,
): Promise<Map<string, string>> {
  const upcoming = await upcomingFixtures(db, competitionId, nowWallClock(now), ["published"], 500);
  const lobbies = upcoming.filter((fixture) => fixture.homeTeamId === null);
  const inLobby =
    lobbies.length === 0
      ? []
      : await db
          .select({ fixtureId: fixtureParticipants.fixtureId, teamId: fixtureParticipants.teamId })
          .from(fixtureParticipants)
          .where(
            inArray(
              fixtureParticipants.fixtureId,
              lobbies.map((fixture) => fixture.id),
            ),
          );
  const line = (fixture: FixtureSnapshot, teamId: string): string => {
    const opponent =
      fixture.homeTeamId === null
        ? "a lobby match"
        : `vs ${(fixture.homeTeamId === teamId ? fixture.awayTeamName : fixture.homeTeamName) ?? "TBA"}`;
    const where = fixture.groundName ?? fixture.venueName;
    return [opponent, fixture.kickoffAt === null ? null : formatKickoff(fixture.kickoffAt), where]
      .filter((part): part is string => part !== null && part !== "")
      .join(" · ");
  };
  const out = new Map<string, string>();
  // `upcoming` is in kickoff order, so the first hit per team is its first match.
  for (const fixture of upcoming) {
    const sides =
      fixture.homeTeamId === null
        ? inLobby.filter((row) => row.fixtureId === fixture.id).map((row) => row.teamId)
        : [fixture.homeTeamId, fixture.awayTeamId ?? ""];
    for (const teamId of sides) {
      if (teamIds.includes(teamId) && !out.has(teamId)) {
        out.set(teamId, line(fixture, teamId));
      }
    }
  }
  return out;
}

export type SendSquadSheetsResult =
  { readonly ok: true; readonly sent: number } | { readonly ok: false; readonly reason: string };

/**
 * Send the sheet to every squad member who has not had it for their current
 * team. Each gets an email (where they have a verified address) and an inbox
 * line; returns how many were told now.
 */
export async function sendSquadSheets(
  db: Db,
  input: { competitionId: string; actorId: string },
  now: Date = new Date(),
): Promise<SendSquadSheetsResult> {
  const blocked = await blockedBy(db, input.competitionId);
  if (blocked !== null) {
    return { ok: false, reason: blocked };
  }
  const [context] = await db
    .select({ season: competitions.name, orgId: competitions.orgId, orgName: organizations.name })
    .from(competitions)
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(eq(competitions.id, input.competitionId))
    .limit(1);
  if (context === undefined) {
    return { ok: false, reason: "Season not found." };
  }
  const [members, sent] = await Promise.all([
    membersOf(db, input.competitionId),
    sentKeys(input.competitionId),
  ]);
  const pending = members.filter(
    (member) => !sent.has(sheetKey(input.competitionId, member.registrationId, member.teamId)),
  );
  if (pending.length === 0) {
    return { ok: true, sent: 0 };
  }
  const teamIds = [...new Set(members.map((member) => member.teamId))];
  const [teamRows, matches] = await Promise.all([
    db
      .select({ id: teams.id, name: teams.name, coach: teams.coachName })
      .from(teams)
      .where(inArray(teams.id, teamIds)),
    firstMatches(db, input.competitionId, teamIds, now),
  ]);
  const teamById = new Map(teamRows.map((team) => [team.id, team]));
  const squadOf = (teamId: string, reader: Member): SquadLine[] =>
    members
      .filter((member) => member.teamId === teamId)
      .sort((a, b) => rank(a) - rank(b) || a.listedName.localeCompare(b.listedName))
      .map((member) => ({
        name:
          member.registrationId === reader.registrationId
            ? `${member.listedName} (you)`
            : member.listedName,
        note: noteOf(member) || "Player",
      }));

  const mails: QueuedMail[] = [];
  for (const member of pending) {
    const team = teamById.get(member.teamId);
    if (team === undefined) continue;
    mails.push({
      personId: member.personId,
      orgId: context.orgId,
      kind: "team.squad_sheet",
      dedupeKey: sheetKey(input.competitionId, member.registrationId, member.teamId),
      ...squadSheetMail({
        name: member.greetingName,
        season: context.season,
        orgName: context.orgName,
        teamName: team.name,
        squad: squadOf(member.teamId, member),
        coach: team.coach?.trim() || null,
        firstMatch: matches.get(member.teamId) ?? null,
      }),
    });
  }
  const fresh = new Set(await enqueueMail(mails));
  const told = pending.filter((member) =>
    fresh.has(sheetKey(input.competitionId, member.registrationId, member.teamId)),
  );
  for (const member of told) {
    try {
      await logSecurityEvent(member.personId, "team.squad_sheet", {
        competitionId: input.competitionId,
        competition: context.season,
        team: teamById.get(member.teamId)?.name ?? "",
      });
    } catch {
      // The email is queued; one unwritable inbox row must not stop the rest.
    }
  }
  if (told.length > 0) {
    await db.insert(auditLog).values({
      id: newId(),
      actor: input.actorId,
      action: "team.squad_sheets.sent",
      scopeType: "org",
      scopeId: context.orgId,
      subject: input.competitionId,
      meta: { count: String(told.length) },
    });
    kickDrain();
  }
  return { ok: true, sent: told.length };
}
