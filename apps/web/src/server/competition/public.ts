import { deriveAge } from "@desiauction/core";
import { auctions, competitions, organizations, people, registrations, teams } from "@desiauction/db";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";

import { storage } from "../media";
import { systemDb } from "../db";
import { teamsOf, type TeamSummary } from "./competitions";
import { queryFixtures, type FixtureSnapshot } from "./fixtures";

// PX-5 public reads (PX-1 02 §I thin-wiring class): anonymous, system-pool
// composites over EXISTING queries. Public exposure is governed by the
// platform's own `competitions.visibility` column (schema, dormant until now):
// the DIRECTORY lists only visibility='public'; a single page also renders for
// open-registration competitions (the shared link already made those public in
// practice). Nothing here reads phones, registrations, or any person data.

export interface PublicFixture {
  number: string;
  homeTeamName: string;
  awayTeamName: string;
  kickoffAt: string | null;
  groundName: string | null;
  venueName: string | null;
}

export interface PublicCompetitionView {
  name: string;
  slug: string;
  status: string;
  location: string | null;
  startsOn: string | null;
  endsOn: string | null;
  orgName: string;
  open: boolean;
  listed: boolean;
  /** Ready-to-render competition crest URL, or null for the monogram fallback. */
  logoUrl: string | null;
  /** PX-6: the live door on the public page (null until an auction exists). */
  auctionStatus: string | null;
  teams: TeamSummary[];
  fixtures: PublicFixture[];
}

function toPublicFixture(row: FixtureSnapshot): PublicFixture {
  return {
    number: row.number,
    homeTeamName: row.homeTeamName,
    awayTeamName: row.awayTeamName,
    kickoffAt: row.kickoffAt,
    groundName: row.groundName,
    venueName: row.venueName,
  };
}

export async function publicCompetitionView(slug: string): Promise<PublicCompetitionView | null> {
  const [row] = await systemDb
    .select({
      id: competitions.id,
      name: competitions.name,
      slug: competitions.slug,
      status: competitions.status,
      visibility: competitions.visibility,
      location: competitions.location,
      startsOn: competitions.startsOn,
      endsOn: competitions.endsOn,
      orgName: organizations.name,
      logoKey: competitions.logoUrl,
    })
    .from(competitions)
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(eq(competitions.slug, slug))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  const open = row.status === "registration_open";
  if (row.visibility !== "public" && !open) {
    // Not published and not accepting the public — structurally absent.
    return null;
  }
  const [auctionRows, teams, fixtures] = await Promise.all([
    systemDb
      .select({ status: auctions.status })
      .from(auctions)
      .where(eq(auctions.competitionId, row.id))
      .limit(1),
    teamsOf(systemDb, row.id),
    queryFixtures(systemDb, row.id, {
      status: "published",
      sort: "kickoff",
      page: 1,
      pageSize: 100,
    }),
  ]);
  return {
    name: row.name,
    slug: row.slug,
    status: row.status,
    location: row.location,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    orgName: row.orgName,
    open,
    listed: row.visibility === "public",
    logoUrl: row.logoKey === null ? null : storage.readUrl(row.logoKey),
    auctionStatus: auctionRows[0]?.status ?? null,
    teams,
    fixtures: fixtures.rows.map(toPublicFixture),
  };
}

export interface ShowcasePlayer {
  number: string;
  name: string;
  role: string;
  age: number | null;
  battingStyle: string | null;
  bowlingStyle: string | null;
  /** Consent-gated (null unless photo_consent_at is set — DPDP §5). */
  photoUrl: string | null;
  status: "available" | "sold";
  teamName: string | null;
}

/**
 * Public pre-auction showcase (parity §3.3): the APPROVED player pool for a
 * public/open competition. Anonymous, system-pool. Never exposes phones (C-23)
 * or non-approved registrations; photos are consent-gated. `status` reflects
 * persisted squad assignment (assigned = sold); live snapshot status is a P2
 * enhancement.
 */
export async function publicShowcase(slug: string): Promise<ShowcasePlayer[] | null> {
  const [comp] = await systemDb
    .select({ id: competitions.id, status: competitions.status, visibility: competitions.visibility })
    .from(competitions)
    .where(eq(competitions.slug, slug))
    .limit(1);
  if (comp === undefined) {
    return null;
  }
  const open = comp.status === "registration_open";
  if (comp.visibility !== "public" && !open) {
    return null;
  }
  const now = new Date();
  const rows = await systemDb
    .select({
      number: registrations.registrationNumber,
      name: people.name,
      role: registrations.role,
      dateOfBirth: registrations.dateOfBirth,
      battingStyle: registrations.battingStyle,
      bowlingStyle: registrations.bowlingStyle,
      photoKey: people.photoUrl,
      photoConsentAt: people.photoConsentAt,
      teamId: registrations.teamId,
      teamName: teams.name,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .leftJoin(teams, eq(teams.id, registrations.teamId))
    .where(and(eq(registrations.competitionId, comp.id), eq(registrations.status, "approved")))
    .orderBy(asc(registrations.registrationNumber), asc(registrations.id));
  return rows.map((r) => ({
    number: r.number,
    name: r.name ?? "Unnamed",
    role: r.role,
    age: deriveAge(r.dateOfBirth, now),
    battingStyle: r.battingStyle,
    bowlingStyle: r.bowlingStyle,
    photoUrl: r.photoConsentAt !== null && r.photoKey !== null ? storage.readUrl(r.photoKey) : null,
    status: r.teamId !== null ? "sold" : "available",
    teamName: r.teamName,
  }));
}

export interface DirectoryEntry {
  name: string;
  slug: string;
  orgName: string;
  location: string | null;
  startsOn: string | null;
  endsOn: string | null;
  open: boolean;
  logoUrl: string | null;
}

export interface DirectoryPage {
  entries: DirectoryEntry[];
  page: number;
  totalPages: number;
  total: number;
}

const DIRECTORY_PAGE_SIZE = 12;

/** Competitions whose organizers PUBLISHED them (visibility='public'). */
export async function publicCompetitionsDirectory(params: {
  q?: string;
  page?: number;
}): Promise<DirectoryPage> {
  const filters = [eq(competitions.visibility, "public")];
  const term = params.q?.trim();
  if (term !== undefined && term !== "") {
    const like = `%${term}%`;
    const clause = or(
      ilike(competitions.name, like),
      ilike(competitions.location, like),
      ilike(organizations.name, like),
    );
    if (clause !== undefined) {
      filters.push(clause);
    }
  }
  const where = and(...filters);
  const [countRow] = await systemDb
    .select({ count: sql<number>`count(*)::int` })
    .from(competitions)
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(where);
  const total = countRow?.count ?? 0;
  const page = Math.max(params.page ?? 1, 1);
  const rows = await systemDb
    .select({
      name: competitions.name,
      slug: competitions.slug,
      status: competitions.status,
      location: competitions.location,
      startsOn: competitions.startsOn,
      endsOn: competitions.endsOn,
      orgName: organizations.name,
      logoKey: competitions.logoUrl,
    })
    .from(competitions)
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .where(where)
    .orderBy(asc(competitions.startsOn), asc(competitions.id))
    .limit(DIRECTORY_PAGE_SIZE)
    .offset((page - 1) * DIRECTORY_PAGE_SIZE);
  return {
    entries: rows.map((row) => ({
      name: row.name,
      slug: row.slug,
      orgName: row.orgName,
      location: row.location,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      open: row.status === "registration_open",
      logoUrl: row.logoKey === null ? null : storage.readUrl(row.logoKey),
    })),
    page,
    totalPages: Math.max(1, Math.ceil(total / DIRECTORY_PAGE_SIZE)),
    total,
  };
}

export interface MyRegistration {
  competitionName: string;
  competitionSlug: string;
  orgName: string;
  status: string;
  role: string;
  number: string;
  open: boolean;
}

/** The person's registrations across every competition — the player lens.
 * Person-scoped cross-org listing on the system pool (PRP-1 documented class). */
export async function myRegistrations(personId: string): Promise<MyRegistration[]> {
  const rows = await systemDb
    .select({
      competitionName: competitions.name,
      competitionSlug: competitions.slug,
      orgName: organizations.name,
      status: registrations.status,
      role: registrations.role,
      number: registrations.registrationNumber,
      competitionStatus: competitions.status,
    })
    .from(registrations)
    .innerJoin(competitions, eq(competitions.id, registrations.competitionId))
    .innerJoin(organizations, eq(organizations.id, competitions.orgId))
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(eq(registrations.personId, personId))
    .orderBy(asc(competitions.startsOn), asc(registrations.id));
  return rows.map((row) => ({
    competitionName: row.competitionName,
    competitionSlug: row.competitionSlug,
    orgName: row.orgName,
    status: row.status,
    role: row.role,
    number: row.number,
    open: row.competitionStatus === "registration_open",
  }));
}

/** PX-6 fix: the sitemap carries EVERY published competition, not one page. */
export async function publicCompetitionSlugs(limit = 5000): Promise<string[]> {
  const rows = await systemDb
    .select({ slug: competitions.slug })
    .from(competitions)
    .where(eq(competitions.visibility, "public"))
    .orderBy(asc(competitions.id))
    .limit(limit);
  return rows.map((row) => row.slug);
}
