import {
  auctionOwnerInvites,
  auctions,
  competitions,
  paddleGrants,
  playerProfiles,
  registrations,
  teams,
} from "@desiauction/db";
import { and, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { cache } from "react";

import { PLATFORM_SCOPE_ID, PLATFORM_SCOPE_TYPE } from "../admin/capabilities";
import { systemDb } from "../db";
import { grantsOfPerson, orgsOfPerson } from "../request-cache";

/**
 * WHO THIS PERSON IS HERE — the one answer the shell and /home both ask.
 *
 * The console used to be one organizer dashboard handed to everyone: a viewer
 * was offered "+ New tournament", a player the "create your club" ladder, a
 * team owner nothing about their team. The product has always KNOWN the
 * difference — it is written in grants, owner invites, paddle grants and
 * registrations — it just never asked in one place.
 *
 * A person can be several of these at once (organizer of one club, owner of a
 * team in another, player in a third), so this is a set of facts, not a single
 * role. Nothing here authorizes anything: every surface still checks its own
 * capability. This decides what to OFFER, never what to ALLOW.
 *
 * Cross-org by definition, so it reads on the system pool — every query is
 * self-scoped to `personId`, the same posture as `player/career.ts`.
 */

export interface OrganizedClub {
  orgId: string;
  slug: string;
  name: string;
  /** `owner` holds org:owner; `staff` holds org:staff. */
  level: "owner" | "staff";
}

export interface OwnedTeam {
  teamId: string;
  teamName: string;
  auctionId: string;
  auctionStatus: string;
  competitionSlug: string;
  competitionName: string;
  competitionStatus: string;
}

export interface PersonRoles {
  /** Clubs this person manages (org:owner or org:staff). */
  organizes: OrganizedClub[];
  /** Clubs this person belongs to without managing (team owners land here too). */
  memberOf: { orgId: string; slug: string; name: string }[];
  /** Teams this person owns: an accepted owner invite or a live paddle grant. */
  owns: OwnedTeam[];
  /** Whether this person plays: a registration anywhere, or a player profile. */
  plays: boolean;
  /** Any platform grant at all (admin, support, moderation, …). */
  operates: boolean;
  /** Seasons whose auction this person was appointed to run (auction:conductor). */
  conducts: ConductedSeason[];
}

export interface ConductedSeason {
  competitionSlug: string;
  competitionName: string;
  /** The season's auction, if one has been created (null before that). */
  auctionStatus: string | null;
}

const MANAGING_SETS = new Set(["org:owner", "org:staff"]);

async function conductedSeasons(competitionIds: string[]): Promise<ConductedSeason[]> {
  if (competitionIds.length === 0) return [];
  const rows = await systemDb
    .select({
      competitionSlug: competitions.slug,
      competitionName: competitions.name,
      auctionStatus: auctions.status,
    })
    .from(competitions)
    .leftJoin(
      auctions,
      and(eq(auctions.competitionId, competitions.id), ne(auctions.status, "abandoned")),
    )
    .where(inArray(competitions.id, competitionIds));
  return rows;
}

async function ownedTeams(personId: string): Promise<OwnedTeam[]> {
  const columns = {
    teamId: teams.id,
    teamName: teams.name,
    auctionId: auctions.id,
    auctionStatus: auctions.status,
    competitionSlug: competitions.slug,
    competitionName: competitions.name,
    competitionStatus: competitions.status,
    at: auctions.createdAt,
  };
  const [invited, granted] = await Promise.all([
    systemDb
      .select(columns)
      .from(auctionOwnerInvites)
      .innerJoin(teams, eq(teams.id, auctionOwnerInvites.teamId))
      .innerJoin(auctions, eq(auctions.id, auctionOwnerInvites.auctionId))
      .innerJoin(competitions, eq(competitions.id, auctions.competitionId))
      .where(
        and(
          eq(auctionOwnerInvites.acceptedBy, personId),
          isNotNull(auctionOwnerInvites.acceptedAt),
          isNull(auctionOwnerInvites.revokedAt),
          ne(auctions.status, "abandoned"),
        ),
      ),
    systemDb
      .select(columns)
      .from(paddleGrants)
      .innerJoin(teams, eq(teams.id, paddleGrants.teamId))
      .innerJoin(auctions, eq(auctions.id, paddleGrants.auctionId))
      .innerJoin(competitions, eq(competitions.id, auctions.competitionId))
      .where(
        and(
          eq(paddleGrants.personId, personId),
          isNull(paddleGrants.revokedAt),
          ne(auctions.status, "abandoned"),
        ),
      ),
  ]);
  // One team can arrive by both doors; newest auction first.
  const byTeam = new Map<string, (typeof invited)[number]>();
  for (const row of [...invited, ...granted]) {
    const held = byTeam.get(`${row.auctionId}:${row.teamId}`);
    if (held === undefined) byTeam.set(`${row.auctionId}:${row.teamId}`, row);
  }
  return [...byTeam.values()]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map((row) => ({
      teamId: row.teamId,
      teamName: row.teamName,
      auctionId: row.auctionId,
      auctionStatus: row.auctionStatus,
      competitionSlug: row.competitionSlug,
      competitionName: row.competitionName,
      competitionStatus: row.competitionStatus,
    }));
}

async function playsAnywhere(personId: string): Promise<boolean> {
  const [registered, profiled] = await Promise.all([
    systemDb
      .select({ one: sql<number>`1` })
      .from(registrations)
      .where(eq(registrations.personId, personId))
      .limit(1),
    systemDb
      .select({ one: sql<number>`1` })
      .from(playerProfiles)
      .where(eq(playerProfiles.personId, personId))
      .limit(1),
  ]);
  return registered.length > 0 || profiled.length > 0;
}

export const rolesOf = cache(async (personId: string): Promise<PersonRoles> => {
  const [orgs, grants, owns, plays] = await Promise.all([
    orgsOfPerson(personId),
    grantsOfPerson(personId),
    ownedTeams(personId),
    playsAnywhere(personId),
  ]);
  const managing = new Map<string, "owner" | "staff">();
  for (const grant of grants) {
    if (grant.revokedAt !== null || grant.scopeType !== "org") continue;
    if (!MANAGING_SETS.has(grant.capabilitySet)) continue;
    const level = grant.capabilitySet === "org:owner" ? "owner" : "staff";
    if (managing.get(grant.scopeId) !== "owner") managing.set(grant.scopeId, level);
  }
  const organizes: OrganizedClub[] = [];
  const memberOf: PersonRoles["memberOf"] = [];
  for (const org of orgs) {
    const level = managing.get(org.id);
    if (level === undefined) memberOf.push({ orgId: org.id, slug: org.slug, name: org.name });
    else organizes.push({ orgId: org.id, slug: org.slug, name: org.name, level });
  }
  // Appointed auctioneer (0076): a season-scoped conduct grant.
  const conducts = await conductedSeasons(
    grants
      .filter(
        (grant) =>
          grant.revokedAt === null &&
          grant.scopeType === "tournament" &&
          grant.capabilitySet === "auction:conductor",
      )
      .map((grant) => grant.scopeId),
  );
  const operates = grants.some(
    (grant) =>
      grant.revokedAt === null &&
      grant.scopeType === PLATFORM_SCOPE_TYPE &&
      grant.scopeId === PLATFORM_SCOPE_ID,
  );
  return { organizes, memberOf, owns, plays, operates, conducts };
});

const AUCTION_OVER = new Set(["completed", "reconciled"]);

/**
 * The team to lead with: the newest one whose auction has not happened yet (the
 * night an owner is preparing for), else simply the newest.
 */
export function currentTeam(roles: PersonRoles): OwnedTeam | null {
  return roles.owns.find((team) => !AUCTION_OVER.has(team.auctionStatus)) ?? roles.owns[0] ?? null;
}
