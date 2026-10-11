import type {
  PublicScoringState as PublicLiveState,
  RaidClockContext,
} from "@desiauction/core/scoring";
import { can } from "../entitlements";
import { sponsorDetails } from "./sponsor";
import { sportPack } from "@desiauction/core";
import {
  competitions,
  fixtures,
  fixtureParticipants,
  matches,
  teams,
  grounds,
  venues,
  registrations,
  people,
  type Db,
} from "@desiauction/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { systemDb } from "../db";
import { shownName } from "../competition/shown-name";
import { publicLiveResult, publicMatchAvailable, type PublicAccessProof } from "./public";
import type { PublicResultDetails } from "./result-details";
import { publicName } from "./public-name";

export type PublicPageAddress = { slug: string; fixtureNumber: string } | { token: string };
export interface PublicPageFacts {
  family?: "delivery" | "rally" | "raid" | "timed" | "placement";
  clock?: RaidClockContext;
  sponsor?: { name: string; logoUrl: string | null };
  readAt: number;
  fixtureId: string;
  fixtureNumber: string;
  slug: string;
  season: string;
  kickoffAt: string | null;
  venue: string | null;
  hasMatch: boolean;
  proof: PublicAccessProof;
  teams: {
    id: string;
    name: string;
    initials: string;
    players: { id: string; name: string; initials: string; announced: boolean }[];
  }[];
  initial: PublicLiveState | null;
  initialResultDetails?: PublicResultDetails | null;
}
function pageGate(address: PublicPageAddress) {
  return and(
    eq(competitions.orgId, fixtures.orgId),
    or(
      sql`${matches.fixtureId} is null`,
      and(
        eq(matches.orgId, fixtures.orgId),
        eq(matches.competitionId, fixtures.competitionId),
        publicMatchAvailable(),
      ),
    ),
    "token" in address
      ? eq(matches.shareToken, address.token)
      : and(
          eq(competitions.slug, address.slug),
          eq(fixtures.fixtureNumber, address.fixtureNumber),
          eq(competitions.visibility, "public"),
          inArray(fixtures.status, ["published", "in_progress", "completed"]),
        ),
  );
}
/** Static facts are gated independently; all score facts use C29's delayed selector. */
export async function publicPage(
  address: PublicPageAddress,
  reader: Db = systemDb,
  now = new Date(),
): Promise<PublicPageFacts | null> {
  const read = () =>
    reader
      .select({
        id: fixtures.id,
        orgId: fixtures.orgId,
        competitionId: fixtures.competitionId,
        number: fixtures.fixtureNumber,
        kickoffAt: fixtures.kickoffAt,
        home: fixtures.homeTeamId,
        away: fixtures.awayTeamId,
        slug: competitions.slug,
        season: competitions.name,
        sport: competitions.sport,
        tier: competitions.tier,
        rules: competitions.scoringRules,
        matchId: matches.fixtureId,
        ground: grounds.name,
        venue: venues.name,
      })
      .from(fixtures)
      .innerJoin(competitions, eq(competitions.id, fixtures.competitionId))
      .leftJoin(matches, eq(matches.fixtureId, fixtures.id))
      .leftJoin(grounds, and(eq(grounds.id, fixtures.groundId), eq(grounds.orgId, fixtures.orgId)))
      .leftJoin(venues, and(eq(venues.id, grounds.venueId), eq(venues.orgId, fixtures.orgId)))
      .where(pageGate(address))
      .limit(1);
  const [fixture] = await read();
  if (!fixture) return null;
  const family = sportPack(fixture.sport)?.scoring?.family;
  if (
    family !== "delivery" &&
    family !== "rally" &&
    family !== "raid" &&
    family !== "timed" &&
    family !== "placement"
  )
    return null;
  if (family !== "placement" && (!fixture.home || !fixture.away)) return null;
  const scheduled =
    family === "placement"
      ? await reader
          .select({ teamId: fixtureParticipants.teamId })
          .from(fixtureParticipants)
          .where(
            and(
              eq(fixtureParticipants.fixtureId, fixture.id),
              eq(fixtureParticipants.orgId, fixture.orgId),
              eq(fixtureParticipants.competitionId, fixture.competitionId),
            ),
          )
      : [];
  const teamIds =
    family === "placement"
      ? scheduled.map((row) => row.teamId)
      : [fixture.home, fixture.away].filter((id): id is string => id !== null);
  if (teamIds.length < 2 || teamIds.length > 25) return null;
  const proof: PublicAccessProof = "token" in address ? { t: address.token } : { s: address.slug };
  const teamRows = await reader
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(
      and(
        eq(teams.orgId, fixture.orgId),
        eq(teams.competitionId, fixture.competitionId),
        inArray(teams.id, teamIds),
      ),
    );
  const players = await reader
    .select({
      id: registrations.id,
      teamId: registrations.teamId,
      name: shownName,
      dob: registrations.dateOfBirth,
      announced: sql<boolean>`exists (select 1 from fixture_lineups fl join message_outbox mo on mo.dedupe_key = 'lineup.announced:' || fl.fixture_id || ':' || fl.registration_id where fl.fixture_id = ${fixture.id} and fl.org_id = ${fixture.orgId} and fl.competition_id = ${fixture.competitionId} and fl.registration_id = ${registrations.id} and fl.team_id = ${registrations.teamId})`,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(
      and(
        eq(registrations.orgId, fixture.orgId),
        eq(registrations.competitionId, fixture.competitionId),
        eq(registrations.status, "approved"),
        inArray(registrations.teamId, teamIds),
      ),
    );
  const matchDate =
    fixture.kickoffAt && /^\d{4}-\d{2}-\d{2}T/.test(fixture.kickoffAt)
      ? new Date(`${fixture.kickoffAt.slice(0, 10)}T00:00:00Z`)
      : null;
  const ageDate = matchDate && Number.isFinite(matchDate.getTime()) ? matchDate : null;
  const initialRead = fixture.matchId
    ? await publicLiveResult(fixture.id, proof, now, reader)
    : null;
  const initial = initialRead?.live ?? null;
  // Revocation during the composite read cannot publish even static facts.
  const [current] = await read();
  if (!current || current.id !== fixture.id) return null;
  const ordered = teamIds.map((id) => teamRows.find((team) => team.id === id));
  if (ordered.some((team) => !team)) return null;
  const sponsor = can(current, "overlay_sponsor")
    ? sponsorDetails(current.rules, current.orgId, current.competitionId)
    : null;
  return {
    ...(sponsor ? { sponsor } : {}),
    family,
    ...(initialRead?.clock ? { clock: initialRead.clock } : {}),
    readAt: now.getTime(),
    fixtureId: fixture.id,
    fixtureNumber: fixture.number,
    slug: fixture.slug,
    season: fixture.season,
    kickoffAt: fixture.kickoffAt,
    venue: fixture.ground ?? fixture.venue,
    hasMatch: fixture.matchId !== null,
    proof,
    initial,
    initialResultDetails: initialRead?.resultDetails ?? null,
    teams: ordered.flatMap((team) =>
      team
        ? [
            {
              id: team.id,
              name: team.name,
              initials: publicName(team, { dateOfBirth: null }, now).initials,
              players: players
                .filter((player) => player.teamId === team.id)
                .map((player) => {
                  const identity = publicName(player, { dateOfBirth: player.dob }, ageDate);
                  return {
                    id: player.id,
                    name: identity.name,
                    initials: identity.initials,
                    announced: player.announced,
                  };
                }),
            },
          ]
        : [],
    ),
  };
}

/** Identity-only lookup for a signed-in one-shot public reminder, including pre-start fixtures. */
export async function publicReminderIdentity(
  fixtureId: string,
  proof: PublicAccessProof,
  reader: Db = systemDb,
) {
  const [row] = await reader
    .select({ fixtureId: fixtures.id, orgId: fixtures.orgId })
    .from(fixtures)
    .innerJoin(competitions, eq(competitions.id, fixtures.competitionId))
    .leftJoin(matches, eq(matches.fixtureId, fixtures.id))
    .where(
      and(
        eq(fixtures.id, fixtureId),
        eq(competitions.orgId, fixtures.orgId),
        or(
          sql`${matches.fixtureId} is null`,
          and(eq(matches.orgId, fixtures.orgId), eq(matches.competitionId, fixtures.competitionId)),
        ),
        proof.s ? eq(competitions.slug, proof.s) : undefined,
        or(
          and(
            eq(competitions.visibility, "public"),
            inArray(fixtures.status, ["published", "in_progress", "completed"]),
          ),
          proof.t ? eq(matches.shareToken, proof.t) : sql`false`,
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}
