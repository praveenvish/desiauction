import {
  auditLog,
  competitions,
  fixtureLineups,
  fixtures,
  messageOutbox,
  newId,
  people,
  registrations,
  type Db,
} from "@desiauction/db";
import { and, eq, like } from "drizzle-orm";

import { messageLanguagesOf } from "@desiauction/messaging/language";

import { formatKickoff, formatWallDate, formatWallTime } from "../../lib/format-date";
import { logSecurityEvent } from "../auth/security-events";
import { db as appDb } from "../db";
import {
  enqueueMail,
  enqueueSms,
  kickDrain,
  type QueuedMail,
  type QueuedSms,
} from "../messaging/outbox";
import { lineupMail, type SquadLine } from "../messaging/player-mail";
import { smsFit } from "../messaging/templates";
import { fixtureSnapshot, nowWallClock } from "./fixtures";
import { shownName } from "./shown-name";

/**
 * "YOU'RE IN THE LINEUP" (Phase 3).
 *
 * A lineup here is the organizer's record of who played, and it is often saved
 * AFTER the match — so saving tells nobody anything. For a match still to
 * come, the organizer presses Announce (founder decision) and everyone in that
 * side's SAVED lineup who has not been told hears once: inbox, email, and a
 * text (WhatsApp for those who opted in). Taken out after being told: nothing
 * is said (founder decision) — the next press only tells the newcomers.
 *
 * "Lineup", never "XI": twelve sports, and a kabaddi side is seven.
 */

export function lineupKey(fixtureId: string, registrationId: string): string {
  return `lineup.announced:${fixtureId}:${registrationId}`;
}

/** "Sun, 4 Oct, 7:30 pm" — one DLT variable (≤ 21). */
export function smsWhen(wall: string): string {
  return `${formatWallDate(wall).replace(/ \d{4}$/, "")}, ${formatWallTime(wall)}`;
}

/** A match still to come: kickoff set and ahead, not started, not called off. */
export function isUpcoming(
  fixture: { readonly kickoffAt: string | null; readonly status: string },
  now: Date = new Date(),
): boolean {
  return (
    fixture.kickoffAt !== null &&
    fixture.kickoffAt > nowWallClock(now) &&
    (fixture.status === "scheduled" || fixture.status === "published")
  );
}

/** Which of these registrations were already told they are in this lineup. */
async function toldIn(fixtureId: string): Promise<Set<string>> {
  const rows = await appDb
    .select({ key: messageOutbox.dedupeKey })
    .from(messageOutbox)
    .where(like(messageOutbox.dedupeKey, `lineup.announced:${fixtureId}:%`));
  return new Set(rows.map((row) => row.key.slice(row.key.lastIndexOf(":") + 1)));
}

export interface LineupAnnounceState {
  /** False once the match has started, finished or was called off. */
  readonly upcoming: boolean;
  /** In the saved lineup, not yet told. */
  readonly pending: number;
  readonly told: number;
}

/** Per side, for the lineups page. */
export async function lineupAnnounceStates(
  fixture: { readonly id: string; readonly kickoffAt: string | null; readonly status: string },
  sides: readonly {
    teamId: string;
    players: readonly { registrationId: string; played: boolean }[];
  }[],
  now: Date = new Date(),
): Promise<Record<string, LineupAnnounceState>> {
  const upcoming = isUpcoming(fixture, now);
  const told = await toldIn(fixture.id);
  return Object.fromEntries(
    sides.map((side) => {
      const lineup = side.players.filter((player) => player.played);
      const already = lineup.filter((player) => told.has(player.registrationId)).length;
      return [side.teamId, { upcoming, pending: lineup.length - already, told: already }];
    }),
  );
}

export type AnnounceLineupResult =
  | { readonly ok: true; readonly told: number }
  | { readonly ok: false; readonly reason: "not_found" | "not_a_side" | "not_upcoming" };

export async function announceLineup(
  db: Db,
  input: { competitionId: string; fixtureId: string; teamId: string; actorId: string },
  now: Date = new Date(),
): Promise<AnnounceLineupResult> {
  // The fixture must be THIS season's (audit P3): the id comes from the
  // browser, the capability was checked for the season, and a snapshot read by
  // id alone would text another season's players about another season's match.
  // `saveLineup` has always bound it the same way.
  const [bound] = await db
    .select({ id: fixtures.id })
    .from(fixtures)
    .where(and(eq(fixtures.id, input.fixtureId), eq(fixtures.competitionId, input.competitionId)))
    .limit(1);
  const fixture = bound === undefined ? null : await fixtureSnapshot(db, input.fixtureId);
  if (fixture === null) {
    return { ok: false, reason: "not_found" };
  }
  const [season] = await db
    .select({ name: competitions.name, orgId: competitions.orgId })
    .from(competitions)
    .where(eq(competitions.id, input.competitionId))
    .limit(1);
  if (season === undefined) {
    return { ok: false, reason: "not_found" };
  }
  const side =
    fixture.homeTeamId === input.teamId
      ? { team: fixture.homeTeamName, opponent: fixture.awayTeamName }
      : fixture.awayTeamId === input.teamId
        ? { team: fixture.awayTeamName, opponent: fixture.homeTeamName }
        : null;
  if (side === null || side.team === null || side.opponent === null) {
    return { ok: false, reason: "not_a_side" };
  }
  if (!isUpcoming(fixture, now) || fixture.kickoffAt === null) {
    return { ok: false, reason: "not_upcoming" };
  }
  const lineup = await db
    .select({
      registrationId: fixtureLineups.registrationId,
      personId: registrations.personId,
      listedName: shownName,
      greetingName: people.name,
      isCaptain: registrations.isCaptain,
      isViceCaptain: registrations.isViceCaptain,
    })
    .from(fixtureLineups)
    .innerJoin(registrations, eq(registrations.id, fixtureLineups.registrationId))
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(
      and(
        eq(fixtureLineups.fixtureId, input.fixtureId),
        eq(fixtureLineups.teamId, input.teamId),
        eq(registrations.competitionId, input.competitionId),
      ),
    );
  const told = await toldIn(input.fixtureId);
  const fresh = lineup.filter((player) => !told.has(player.registrationId));
  if (fresh.length === 0) {
    return { ok: true, told: 0 };
  }
  const where = fixture.groundName ?? fixture.venueName;
  const listed = [...lineup].sort(
    (a, b) =>
      Number(b.isCaptain) - Number(a.isCaptain) ||
      Number(b.isViceCaptain) - Number(a.isViceCaptain) ||
      (a.listedName ?? "").localeCompare(b.listedName ?? ""),
  );
  const lineupFor = (reader: string): SquadLine[] =>
    listed.map((player) => ({
      name: `${player.listedName ?? "Player"}${player.registrationId === reader ? " (you)" : ""}`,
      note: player.isCaptain ? "Captain" : player.isViceCaptain ? "Vice-captain" : "Player",
    }));

  const languages = await messageLanguagesOf(
    db,
    fresh.map((player) => player.personId),
  );
  const mails: QueuedMail[] = await Promise.all(
    fresh.map(async (player) => ({
      personId: player.personId,
      orgId: season.orgId,
      kind: "lineup.announced" as const,
      dedupeKey: lineupKey(input.fixtureId, player.registrationId),
      ...(await lineupMail(
        {
          name: player.greetingName?.trim() || "there",
          season: season.name,
          teamName: side.team ?? "",
          opponent: side.opponent ?? "",
          when: formatKickoff(fixture.kickoffAt ?? ""),
          where,
          lineup: lineupFor(player.registrationId),
        },
        languages.get(player.personId) ?? "en",
      )),
    })),
  );
  const queued = new Set(await enqueueMail(mails));
  const newlyTold = fresh.filter((player) =>
    queued.has(lineupKey(input.fixtureId, player.registrationId)),
  );
  const texts: QueuedSms[] = newlyTold.map((player) => ({
    personId: player.personId,
    orgId: season.orgId,
    kind: "lineup.announced",
    dedupeKey: `sms:${lineupKey(input.fixtureId, player.registrationId)}`,
    templateKey: "lineup.announced",
    slots: {
      team: smsFit(side.team ?? ""),
      opponent: smsFit(side.opponent ?? ""),
      when: smsWhen(fixture.kickoffAt ?? ""),
    },
  }));
  await enqueueSms(texts);
  for (const player of newlyTold) {
    try {
      await logSecurityEvent(player.personId, "fixture.lineup_announced", {
        competitionId: input.competitionId,
        competition: season.name,
        team: side.team,
        opponent: side.opponent,
        kickoffAt: fixture.kickoffAt,
      });
    } catch {
      // The email and text are queued; one unwritable inbox row must not stop the rest.
    }
  }
  if (newlyTold.length > 0) {
    await db.insert(auditLog).values({
      id: newId(),
      actor: input.actorId,
      action: "fixture.lineup.announced",
      scopeType: "org",
      scopeId: season.orgId,
      subject: input.fixtureId,
      meta: { teamId: input.teamId, count: String(newlyTold.length) },
    });
    kickDrain();
  }
  return { ok: true, told: newlyTold.length };
}
