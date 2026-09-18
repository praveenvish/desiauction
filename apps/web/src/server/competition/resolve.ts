import { orgMembers, tournaments } from "@desiauction/db";
import { and, eq } from "drizzle-orm";

import { systemDb } from "../db";
import {
  competitionForRegistration,
  competitionsForPerson,
  competitionsOfTournament,
  resolveCompetition,
  type CompetitionSummary,
} from "./competitions";
import { publicRegistrationFacts } from "./registrations";

/**
 * THE ONLY PLACE A CONSOLE REQUEST MAY READ SEASONS BEFORE IT KNOWS THE ORG.
 *
 * Row-level security on `competitions` and `tournaments` admits a row only when
 * `app.org_id` names its org, and at the top of a request nothing has named one
 * yet: the URL carries a slug, or the screen spans every club a person is in.
 * Those reads have to run on the RLS-exempt system pool — and until this module
 * existed, eight modules did it themselves, then kept going: auctions, teams,
 * registrations, settlement and money aggregates were all read on the same
 * bypass pool after the season was known, where one missing `where` would have
 * been a cross-tenant read with nothing underneath it (posture-allowlist
 * "debt", PA-1R Phase 3.4).
 *
 * The rule now is simple enough to check by eye:
 *
 *   · every function here answers ONE pre-tenant question and returns only the
 *     identity needed to open a boundary (plus the season's own summary, which
 *     the membership join has already licensed);
 *   · each membership-gated read carries the membership join IN THE SAME SQL
 *     statement, so there is no window in which a non-member's row is fetched;
 *   · each public read is limited to what the public season page already shows;
 *   · everything after resolution happens inside `withTenantDb`, in the caller.
 *
 * `scripts/check-tenant-posture.mjs` holds the line: this file is the one
 * by-design system-pool reader for seasons, and a new bypass anywhere else
 * fails CI.
 */

/** Slug → season, for a MEMBER of the season's org. Null for anyone else. */
export function resolveMemberCompetition(
  personId: string,
  slug: string,
): Promise<CompetitionSummary | null> {
  return resolveCompetition(systemDb, personId, slug);
}

/**
 * Every season across every club this person belongs to. The membership join
 * is inside the query, so a person sees their clubs' seasons and nothing else.
 */
export function memberCompetitions(
  personId: string,
): Promise<(CompetitionSummary & { orgName: string })[]> {
  return competitionsForPerson(systemDb, personId);
}

/**
 * Slug → season for the PUBLIC registration link. There is no membership to
 * scope by: the registrant is, by definition, not in the club yet. Returns the
 * facts the registration screens need and nothing about anyone registered.
 */
export function publicCompetitionBySlug(
  slug: string,
): ReturnType<typeof competitionForRegistration> {
  return competitionForRegistration(systemDb, slug);
}

/** The signed-out preview of a PUBLISHED season — only what its public page shows. */
export function publicRegistrationFactsBySlug(
  slug: string,
): ReturnType<typeof publicRegistrationFacts> {
  return publicRegistrationFacts(systemDb, slug);
}

/** Slug → tournament, for a MEMBER of its org. Null for anyone else. */
export async function resolveMemberTournament(
  personId: string,
  slug: string,
): Promise<{ id: string; name: string; slug: string; orgId: string } | null> {
  const [row] = await systemDb
    .select({
      id: tournaments.id,
      name: tournaments.name,
      slug: tournaments.slug,
      orgId: tournaments.orgId,
    })
    .from(tournaments)
    .innerJoin(
      orgMembers,
      and(eq(orgMembers.orgId, tournaments.orgId), eq(orgMembers.personId, personId)),
    )
    .where(eq(tournaments.slug, slug))
    .limit(1);
  return row ?? null;
}

/**
 * One tournament's editions, for a MEMBER of its org — empty for anyone else.
 *
 * `tournamentSeasons` is an invokable server action taking an arbitrary id, so
 * the membership check cannot live in the page that usually calls it first. It
 * lives here, in SQL, before a single edition is read.
 */
export async function memberTournamentSeasons(
  personId: string,
  tournamentId: string,
): Promise<(CompetitionSummary & { orgName: string })[]> {
  const [member] = await systemDb
    .select({ orgId: tournaments.orgId })
    .from(tournaments)
    .innerJoin(
      orgMembers,
      and(eq(orgMembers.orgId, tournaments.orgId), eq(orgMembers.personId, personId)),
    )
    .where(eq(tournaments.id, tournamentId))
    .limit(1);
  if (member === undefined) {
    return [];
  }
  return competitionsOfTournament(systemDb, tournamentId);
}
