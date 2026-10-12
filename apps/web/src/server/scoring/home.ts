import { placementSetup } from "./placement-setup";
import {
  battingStyleLabel,
  bowlingStyleLabel,
  parseBattingStyle,
  parseBowlingStyle,
  sportPack,
} from "@desiauction/core";
import {
  replayMatch,
  type Conditions,
  type EventPayloads,
  type FormatSpec,
  type MatchEvent,
  BATTING_HANDS,
  defaultConditions,
  formatByKey,
  parseSeasonScoringRules,
} from "@desiauction/core/scoring";
import {
  auditLog,
  organizations,
  people,
  competitions,
  fixtureLineups,
  fixtureOfficials,
  fixtures,
  grounds,
  matches,
  registrations,
  teams as teamTable,
  withTenantDb,
  type Db,
} from "@desiauction/db";
import { and, asc, eq, inArray, isNull, isNotNull, ne, or, sql } from "drizzle-orm";
import { publicCompetitionBySlug } from "../competition/resolve";
import { dbHandle } from "../db";
import { grantsOfPerson } from "../request-cache";
import { rolesOf } from "../roles/roles";
import { resumeScoring } from "./claim";
import { authorityKind, mayScore } from "./authority";
import { matchAgeDate, scoringNames } from "./live-state";
import { syncAuctionOwnersToManagers } from "./managers";
import type { SetupPlayer, SetupTeam } from "../../app/score/[fixtureId]/setup/setup-model";

function profileStyle(battingRaw: string | null, bowlingRaw: string | null): string {
  const batting = parseBattingStyle(battingRaw ?? "");
  const bowling = parseBowlingStyle(bowlingRaw ?? "");
  return [batting ? battingStyleLabel(batting) : null, bowling ? bowlingStyleLabel(bowling) : null]
    .filter(Boolean)
    .join(" · ");
}
export function scoringDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
/** Known person/season projections; no new bypass-pool fixture discovery. */
export async function scoringOrgIds(personId: string): Promise<string[]> {
  const [roles, held] = await Promise.all([rolesOf(personId), grantsOfPerson(personId)]);
  const owned = await Promise.all(
    [...new Set(roles.owns.map((t) => t.competitionSlug))].map(publicCompetitionBySlug),
  );
  return [
    ...new Set([
      ...roles.scores.map((s) => s.orgId),
      ...roles.organizes.map((c) => c.orgId),
      ...roles.memberOf.map((c) => c.orgId),
      ...owned.flatMap((s) => (s ? [s.orgId] : [])),
      ...held.filter((g) => g.revokedAt === null && g.scopeType === "org").map((g) => g.scopeId),
    ]),
  ];
}
/** Caller owns a tenant transaction. Lazy owner provisioning precedes AUTH-1. */
export async function scoringSetup(db: Db, fixtureId: string, personId: string, now = new Date()) {
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  if (!fixture) return null;
  await syncAuctionOwnersToManagers(db, fixture.competitionId, personId);
  return scoringSetupProjection(db, fixtureId, personId, now);
}
/** Read-only projection, safe after resumeScoring acquires its match SHARE lock. */
export async function scoringSetupProjection(
  db: Db,
  fixtureId: string,
  personId: string,
  now = new Date(),
) {
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  const [match] = await db
    .select({ phase: matches.phase, startedAt: matches.startedAt })
    .from(matches)
    .where(eq(matches.fixtureId, fixtureId));
  if (fixture && !fixture.homeTeamId && !fixture.awayTeamId)
    return placementSetup(db, fixtureId, personId);
  if (
    !fixture ||
    !fixture.homeTeamId ||
    !fixture.awayTeamId ||
    (!["published", "in_progress"].includes(fixture.status) &&
      !(fixture.status === "completed" && match && match.phase !== "void"))
  )
    return null;
  if (!(await mayScore(db, personId, fixture))) return null;
  const [season] = await db
    .select()
    .from(competitions)
    .where(eq(competitions.id, fixture.competitionId));
  if (!season) return null;
  const rules = parseSeasonScoringRules(season.scoringRules);
  const pack = sportPack(season.sport);
  if (!pack?.scoring || pack.scoring.family === "placement") return null;
  const [organization] = await db
    .select({ kind: organizations.kind })
    .from(organizations)
    .where(eq(organizations.id, fixture.orgId));
  const [quick] =
    organization?.kind === "personal"
      ? await db
          .select({ meta: auditLog.meta })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.scopeId, fixture.orgId),
              eq(auditLog.subject, fixture.id),
              eq(auditLog.action, "match.quick_created"),
            ),
          )
          .limit(1)
      : [];
  const quickMeta = quick?.meta as Record<string, unknown> | undefined;
  const quickKey = typeof quickMeta?.formatKey === "string" ? quickMeta.formatKey : undefined;
  const formatKey = quickKey ?? rules.formatKey ?? pack.scoring.defaultFormat;
  const format =
    pack.scoring.family !== "delivery"
      ? pack.scoring.formats.find((value) => value.key === formatKey)
      : formatByKey(formatKey);
  if (!format) return null;
  const [ground] = fixture.groundId
    ? await db.select().from(grounds).where(eq(grounds.id, fixture.groundId))
    : [];

  if (match?.phase === "void") return null;
  const names = await scoringNames(
    db,
    season.id,
    matchAgeDate(fixture.kickoffAt, match?.startedAt ?? now),
  );
  const [squad, selected, officials, teamRows] = await Promise.all([
    db
      .select({
        id: registrations.id,
        teamId: registrations.teamId,
        isCaptain: registrations.isCaptain,
        role: registrations.role,
        battingStyle: registrations.battingStyle,
        bowlingStyle: registrations.bowlingStyle,
      })
      .from(registrations)
      .where(
        and(
          eq(registrations.competitionId, season.id),
          eq(registrations.status, "approved"),
          inArray(registrations.teamId, [fixture.homeTeamId, fixture.awayTeamId]),
        ),
      )
      .orderBy(asc(registrations.createdAt), asc(registrations.id)),
    db
      .select({ registrationId: fixtureLineups.registrationId, teamId: fixtureLineups.teamId })
      .from(fixtureLineups)
      .where(eq(fixtureLineups.fixtureId, fixtureId))
      .orderBy(asc(fixtureLineups.createdAt), asc(fixtureLineups.registrationId)),
    db
      .select({ role: fixtureOfficials.role })
      .from(fixtureOfficials)
      .where(and(eq(fixtureOfficials.fixtureId, fixtureId), isNull(fixtureOfficials.removedAt))),
    db
      .select({ id: teamTable.id, color: teamTable.primaryColor })
      .from(teamTable)
      .where(inArray(teamTable.id, [fixture.homeTeamId, fixture.awayTeamId])),
  ]);
  const teams: [SetupTeam, SetupTeam] = [fixture.homeTeamId, fixture.awayTeamId].map((teamId) => {
    const players: SetupPlayer[] = squad
      .filter((p) => p.teamId === teamId)
      .map((p) => ({
        id: p.id,
        name: names.players[p.id]?.name ?? "Player",
        photoUrl: names.players[p.id]?.photoUrl ?? null,
        isCaptain: p.isCaptain,
        keeper: p.role === pack.roles.values.find((r) => /keeper/i.test(r.label))?.key,
        style: profileStyle(p.battingStyle, p.bowlingStyle),
        battingHand:
          BATTING_HANDS.find((hand) =>
            parseBattingStyle(p.battingStyle ?? "")?.startsWith(parseBattingStyle(hand) ?? "!"),
          ) ?? null,
        bowlingStyle: parseBowlingStyle(p.bowlingStyle ?? ""),
      }));
    return {
      id: teamId,
      color: teamRows.find((t) => t.id === teamId)?.color ?? null,
      name: names.teams[teamId]?.name ?? "Team",
      players,
      selectedIds: selected
        .filter(
          (p) => p.teamId === teamId && players.some((player) => player.id === p.registrationId),
        )
        .map((p) => p.registrationId),
    };
  }) as [SetupTeam, SetupTeam];
  const previousPlayers =
    organization?.kind === "personal"
      ? await db
          .select({
            id: registrations.id,
            name: sql<string>`coalesce(${registrations.enteredName}, ${people.name}, 'Player')`,
          })
          .from(registrations)
          .innerJoin(people, eq(people.id, registrations.personId))
          .where(and(eq(registrations.orgId, fixture.orgId), eq(registrations.status, "approved")))
          .orderBy(asc(registrations.createdAt))
          .limit(500)
      : [];
  const common = {
    sport: season.sport,
    ...(previousPlayers.length ? { previousPlayers } : {}),
    fixtureId,
    fixtureNumber: fixture.fixtureNumber,
    competitionSlug: season.slug,
    visibility: season.visibility,
    kickoffAt: fixture.kickoffAt,
    groundName: ground?.name ?? "Ground not set",
    conditions: defaultConditions(ground ?? null, fixture.kickoffAt?.slice(11, 16) ?? null, rules),
    shotMap: rules.shotMap,
    organiser: (await authorityKind(db, personId, fixture)) === "a",
    teams,
    phase: match?.phase ?? null,
    umpires: officials.filter((o) => o.role === "umpire").length,
  };
  if ("periods" in format)
    return {
      ...common,
      family: "timed" as const,
      format,
      formats: pack.scoring.family === "timed" ? pack.scoring.formats : [],
    };
  if ("halves" in format)
    return {
      ...common,
      family: "raid" as const,
      format,
      formats: pack.scoring.family === "raid" ? pack.scoring.formats : [],
    };
  return "rubbers" in format
    ? {
        ...common,
        family: "rally" as const,
        format,
        formats: pack.scoring.family === "rally" ? pack.scoring.formats : [],
      }
    : { ...common, family: "delivery" as const, format };
}
export type FamilyScoringSetup = NonNullable<Awaited<ReturnType<typeof scoringSetup>>>;
export type ScoringSetup = Omit<
  Extract<FamilyScoringSetup, { family: "delivery" }>,
  "family" | "sport"
> & { family?: "delivery"; sport?: string };
export type RallyScoringSetup = Extract<FamilyScoringSetup, { family: "rally" }>;

export async function scoringHome(
  db: Db,
  personId: string,
  day: string,
  now = new Date(),
): Promise<FamilyScoringSetup[]> {
  const rows = await db
    .select({ id: fixtures.id })
    .from(fixtures)
    .where(
      or(
        eq(fixtures.status, "in_progress"),
        and(eq(fixtures.status, "published"), sql`left(${fixtures.kickoffAt}, 10) = ${day}`),
      ),
    )
    .orderBy(asc(fixtures.kickoffAt), asc(fixtures.seq));
  const result: FamilyScoringSetup[] = [];
  for (const row of rows) {
    const setup = await scoringSetup(db, row.id, personId, now);
    if (setup) result.push(setup);
  }
  return result;
}
export async function scoringHomeForPerson(personId: string, now = new Date()) {
  const result: FamilyScoringSetup[] = [];
  for (const orgId of await scoringOrgIds(personId)) {
    result.push(
      ...(await withTenantDb(dbHandle, { personId, orgId }, (db) =>
        scoringHome(db, personId, scoringDay(now), now),
      )),
    );
  }
  return result.sort(
    (a, b) =>
      (a.kickoffAt ?? "").localeCompare(b.kickoffAt ?? "") ||
      a.fixtureNumber.localeCompare(b.fixtureNumber),
  );
}
/** Home may recommend a held match; eligibility alone never asserts ownership. */
export async function scoringResponsibilitiesForPerson(personId: string, now = new Date()) {
  const result: {
    setup: FamilyScoringSetup;
    orgId: string;
    competitionId: string;
    heldByCaller: boolean;
  }[] = [];
  for (const orgId of await scoringOrgIds(personId)) {
    const rows = await withTenantDb(dbHandle, { personId, orgId }, async (db) => {
      const eligible = await scoringHome(db, personId, scoringDay(now), now);
      if (eligible.length === 0) return [];
      const claims = await db
        .select({
          fixtureId: fixtures.id,
          personId: matches.scorerPersonId,
          competitionId: fixtures.competitionId,
        })
        .from(fixtures)
        .leftJoin(matches, eq(matches.fixtureId, fixtures.id))
        .where(
          inArray(
            fixtures.id,
            eligible.map((setup) => setup.fixtureId),
          ),
        );
      const held = new Set(
        claims.filter((claim) => claim.personId === personId).map((claim) => claim.fixtureId),
      );
      return eligible.flatMap((setup) => {
        const competitionId = claims.find(
          (claim) => claim.fixtureId === setup.fixtureId,
        )?.competitionId;
        return competitionId
          ? [{ setup, orgId, competitionId, heldByCaller: held.has(setup.fixtureId) }]
          : [];
      });
    });
    result.push(...rows);
  }
  return result;
}
export async function scoringSetupForPerson(fixtureId: string, personId: string) {
  for (const orgId of await scoringOrgIds(personId)) {
    const setup = await withTenantDb(dbHandle, { personId, orgId }, (db) =>
      scoringSetup(db, fixtureId, personId),
    );
    if (setup) return setup;
  }
  return null;
}

export type AcceptedScoringSetup = {
  format: FormatSpec;
  conditions: Conditions;
  lineups: [EventPayloads["lineup_confirmed"], EventPayloads["lineup_confirmed"]];
  attempt: number;
  lastSeq: number;
};
/** Restart setup comes from accepted history, within the same authenticated tenant read. */
export async function scoringAcceptedSetupForPerson(fixtureId: string, personId: string) {
  for (const orgId of await scoringOrgIds(personId)) {
    const loaded = await withTenantDb(dbHandle, { personId, orgId }, async (db) => {
      const setup = await scoringSetup(db, fixtureId, personId);
      if (!setup) return null;
      if (setup.family !== "delivery") return { setup, accepted: null };
      if (setup.phase !== "not_started") return { setup, accepted: null };
      const events: MatchEvent[] = [];
      let since = 0;
      for (;;) {
        const page = await resumeScoring(db, fixtureId, personId, since);
        if (!page.ok) return { setup, accepted: null };
        events.push(...page.events);
        const last = page.events.at(-1);
        if (page.lastSeq <= (last?.seq ?? since)) break;
        if (!last || last.seq <= since) throw new Error("Scoring history did not advance");
        since = last.seq;
      }
      const state = replayMatch(events);
      const home = state.lineups[setup.teams[0].id],
        away = state.lineups[setup.teams[1].id];
      if (!state.format || !home || !away) return { setup, accepted: null };
      const lineups = setup.teams.map((team) => {
        const lineup = state.lineups[team.id];
        if (!lineup) throw new Error("Accepted lineup missing");
        return {
          teamId: team.id,
          battingOrder: lineup.battingOrder,
          captainId: lineup.captainId,
          keeperId: lineup.keeperId,
          substitutes: lineup.substitutes,
        };
      }) as AcceptedScoringSetup["lineups"];
      const accepted: AcceptedScoringSetup = {
        format: state.format,
        conditions: state.conditions,
        lineups,
        attempt: state.attempt,
        lastSeq: state.lastSeq,
      };
      return { setup: { ...setup, format: state.format, conditions: state.conditions }, accepted };
    });
    if (loaded) return loaded;
  }
  return null;
}

/** A private, tenant-bound install offer after this scorer finishes a match. */
export async function hasFinishedScoring(db: Db, personId: string): Promise<boolean> {
  const [match] = await db
    .select({ id: matches.fixtureId })
    .from(matches)
    .where(
      and(
        eq(matches.scorerPersonId, personId),
        isNotNull(matches.finishedAt),
        ne(matches.phase, "void"),
      ),
    )
    .limit(1);
  return match !== undefined;
}
export async function hasFinishedScoringForPerson(personId: string): Promise<boolean> {
  for (const orgId of await scoringOrgIds(personId)) {
    if (await withTenantDb(dbHandle, { personId, orgId }, (db) => hasFinishedScoring(db, personId)))
      return true;
  }
  return false;
}

export type RaidScoringSetup = Extract<FamilyScoringSetup, { family: "raid" }>;

export type TimedScoringSetup = Extract<FamilyScoringSetup, { family: "timed" }>;

export type PlacementScoringSetup = Extract<FamilyScoringSetup, { family: "placement" }>;
