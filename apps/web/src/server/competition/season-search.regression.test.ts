import { registrationNumber } from "@desiauction/core";
import {
  competitions,
  createDb,
  newId,
  organizations,
  people,
  registrations,
  teams,
  type DbHandle,
} from "@desiauction/db";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { purgeOrg } from "../test-support/purge-org";
import { setCompetitionSquadListing, type CompetitionSummary } from "./competitions";
import { publicSeasonSitemap, publicSquadListing, teamSlugOf } from "./public";

/**
 * SEASON PAGES IN SEARCH (SEO-1 Phase 5, migration 0099), against the database:
 * the trigger that keeps `updated_at`, the squad-listing rule over real
 * registrations, and what the sitemap offers for a published season.
 */
const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const MARK = "SEASON-SEARCH-REGRESSION";

let orgId = "";
let creator = "";
let seasonId = "";
let slug = "";
let adult = "";
let unknownAge = "";
const personIds: string[] = [];

async function person(name: string): Promise<string> {
  const id = newId();
  await db.insert(people).values({
    id,
    name: `${MARK} ${name}`,
    email: `season-search-${id.toLowerCase()}@example.test`,
  });
  personIds.push(id);
  return id;
}

async function register(personId: string, teamId: string, dateOfBirth: string | null) {
  const id = newId();
  await db.insert(registrations).values({
    id,
    orgId,
    competitionId: seasonId,
    personId,
    teamId,
    role: "batter",
    status: "approved",
    dateOfBirth,
    registrationNumber: registrationNumber(id),
  });
  return id;
}

async function updatedAt(): Promise<Date> {
  const [row] = await db
    .select({ at: competitions.updatedAt })
    .from(competitions)
    .where(eq(competitions.id, seasonId));
  if (row === undefined) throw new Error("season missing");
  return row.at;
}

beforeAll(async () => {
  creator = await person("Organizer");
  orgId = newId();
  await db.insert(organizations).values({
    id: orgId,
    name: `${MARK} Club`,
    slug: `season-search-${orgId.toLowerCase()}`,
    createdBy: creator,
  });
  seasonId = newId();
  slug = `season-search-${seasonId.toLowerCase()}`;
  await db.insert(competitions).values({
    id: seasonId,
    orgId,
    sport: "cricket",
    name: `${MARK} League`,
    slug,
    visibility: "public",
    startsOn: "2026-10-01",
    endsOn: "2026-10-30",
    location: "Mumbai",
    createdBy: creator,
  });
  const team = newId();
  await db.insert(teams).values({
    id: team,
    orgId,
    competitionId: seasonId,
    name: `${MARK} Strikers`,
    createdBy: creator,
  });
  adult = await register(await person("Adult"), team, "1990-04-12");
  unknownAge = await register(await person("Unknown"), team, null);
});

afterAll(async () => {
  if (orgId !== "") await purgeOrg(db, orgId);
  if (personIds.length > 0) {
    await db.delete(registrations).where(inArray(registrations.personId, personIds));
    await db.delete(people).where(inArray(people.id, personIds));
  }
  await handle.sql.end();
});

describe("SEASON SEARCH (0099)", () => {
  it("the trigger moves updated_at on a real change, and not on a rewrite of the same values", async () => {
    const before = await updatedAt();
    await db.execute(sql`select pg_sleep(0.01)`);
    await db.update(competitions).set({ location: "Mumbai" }).where(eq(competitions.id, seasonId));
    expect((await updatedAt()).getTime(), "same values: not news").toBe(before.getTime());
    await db.update(competitions).set({ location: "Thane" }).where(eq(competitions.id, seasonId));
    expect((await updatedAt()).getTime()).toBeGreaterThan(before.getTime());
  });

  it("squads stay out of search until opted in, then while any approved age is unproven", async () => {
    expect(await publicSquadListing(seasonId, false)).toEqual({
      indexable: false,
      reason: "off",
      blocking: 0,
    });
    const summary = { id: seasonId, orgId, slug } as CompetitionSummary;
    await setCompetitionSquadListing(db, summary, creator, true);
    // The adult passes; the player with no date of birth blocks the WHOLE season.
    expect(await publicSquadListing(seasonId, true)).toEqual({
      indexable: false,
      reason: "unproven_age",
      blocking: 1,
    });
    let entry = (await publicSeasonSitemap()).find((season) => season.slug === slug);
    expect(entry?.squadSlugs).toEqual([]);

    // Proof of age for the last player lists the squad.
    await db
      .update(registrations)
      .set({ dateOfBirth: "1995-06-01" })
      .where(eq(registrations.id, unknownAge));
    expect(await publicSquadListing(seasonId, true)).toEqual({ indexable: true });
    entry = (await publicSeasonSitemap()).find((season) => season.slug === slug);
    expect(entry?.squadSlugs).toEqual([teamSlugOf(`${MARK} Strikers`)]);

    // Approving a minor anywhere takes every squad of the season back out.
    await db
      .update(registrations)
      .set({ dateOfBirth: "2012-01-01" })
      .where(eq(registrations.id, adult));
    entry = (await publicSeasonSitemap()).find((season) => season.slug === slug);
    expect(entry?.squadSlugs).toEqual([]);
  });

  it("the switch is audited", async () => {
    const rows = await db.execute<{ action: string }>(
      sql`select action from audit_log where subject = ${seasonId} and action = 'competition.squad_listing_changed'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("the sitemap dates the season by its latest change", async () => {
    const entry = (await publicSeasonSitemap()).find((season) => season.slug === slug);
    expect(entry).toBeDefined();
    expect(entry?.lastModified.getTime()).toBe((await updatedAt()).getTime());
  });
});
