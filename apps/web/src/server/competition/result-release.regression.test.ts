import {
  competitions,
  createDb,
  fixtureResults,
  fixtures,
  matches,
  newId,
  organizations,
  people,
  teams,
} from "@desiauction/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../../env";
import { purgeOrg } from "../test-support/purge-org";
import { resultsOf, standingsOf } from "./results";
import { publicSeasonSitemap } from "./public";
import { seasonPlayIn } from "./season-play";

/**
 * P-3 applied to results: the public season page and its table must not show a
 * scored result before the match's betting delay has passed, unless the match is
 * verified. The club's console sees every result at once.
 */
const handle = createDb(env.DATABASE_URL);
const db = handle.db;
const organiser = newId();
const orgId = newId();
const competitionId = newId();
const home = newId();
const away = newId();
let seq = 0;

async function scoredFixture(trust: "verified" | "self_scored", finishedSecondsAgo: number) {
  const id = newId();
  seq += 1;
  await db.insert(fixtures).values({
    id,
    orgId,
    competitionId,
    fixtureNumber: `REL-${String(seq)}`,
    seq,
    homeTeamId: home,
    awayTeamId: away,
    status: "completed",
    kickoffAt: "2026-10-09T12:00",
    createdBy: organiser,
  });
  await db.insert(matches).values({
    fixtureId: id,
    orgId,
    competitionId,
    format: {},
    awardVersion: "cricket-v1/t20",
    phase: "finished",
    trustLevel: trust,
    shareToken: newId() + newId().slice(0, 6),
    finishedAt: new Date(Date.now() - finishedSecondsAgo * 1000),
  });
  await db.insert(fixtureResults).values({
    fixtureId: id,
    orgId,
    competitionId,
    outcome: "home_win",
    winnerTeamId: home,
    score: {
      home: { runs: 150, wickets: 5, balls: 120 },
      away: { runs: 120, wickets: 9, balls: 120 },
    },
    source: "scored",
    recordedBy: organiser,
  });
  return id;
}

async function typedFixture() {
  const id = newId();
  seq += 1;
  await db.insert(fixtures).values({
    id,
    orgId,
    competitionId,
    fixtureNumber: `REL-${String(seq)}`,
    seq,
    homeTeamId: home,
    awayTeamId: away,
    status: "completed",
    kickoffAt: "2026-10-09T12:00",
    createdBy: organiser,
  });
  await db.insert(fixtureResults).values({
    fixtureId: id,
    orgId,
    competitionId,
    outcome: "away_win",
    winnerTeamId: away,
    score: {
      home: { runs: 90, wickets: 10, balls: 100 },
      away: { runs: 91, wickets: 2, balls: 80 },
    },
    recordedBy: organiser,
  });
  return id;
}

beforeAll(async () => {
  await db.insert(people).values({
    id: organiser,
    name: "Release Organiser",
    email: `release-${organiser}@example.test`,
  });
  await db
    .insert(organizations)
    .values({ id: orgId, name: "Release club", slug: `release-${orgId}`, createdBy: organiser });
  await db.insert(competitions).values({
    id: competitionId,
    orgId,
    name: "Release cup",
    slug: `release-${competitionId}`,
    sport: "cricket",
    visibility: "public",
    scoringRules: { publicDelaySeconds: 60 },
    createdBy: organiser,
  });
  await db.insert(teams).values([
    { id: home, orgId, competitionId, name: "Home", createdBy: organiser },
    { id: away, orgId, competitionId, name: "Away", createdBy: organiser },
  ]);
});
afterAll(async () => {
  await purgeOrg(db, orgId);
  await db.delete(people).where(eq(people.id, organiser));
  await handle.sql.end();
});

describe("P-3 scored results wait for the betting delay on public pages", () => {
  it("hides a fresh self-scored result publicly, shows it to the console, and releases it after the delay", async () => {
    const fresh = await scoredFixture("self_scored", 5);
    const verified = await scoredFixture("verified", 5);
    const released = await scoredFixture("self_scored", 61);
    const typed = await typedFixture();

    const publicResults = await resultsOf(db, competitionId, "public");
    expect(publicResults.has(fresh)).toBe(false);
    expect(publicResults.has(verified)).toBe(true);
    expect(publicResults.has(released)).toBe(true);
    expect(publicResults.has(typed)).toBe(true);

    const consoleResults = await resultsOf(db, competitionId);
    expect([fresh, verified, released, typed].every((id) => consoleResults.has(id))).toBe(true);

    const publicTable = await standingsOf(db, competitionId, undefined, "public");
    const consoleTable = await standingsOf(db, competitionId);
    const played = (view: typeof publicTable, teamId: string) =>
      view.rows.find((row) => row.teamId === teamId)?.played ?? 0;
    expect(played(consoleTable, home)).toBe(4);
    expect(played(publicTable, home)).toBe(3);

    const play = await seasonPlayIn(
      db,
      { id: competitionId, sport: "cricket" },
      undefined,
      "public",
    );
    expect(JSON.stringify(play)).not.toContain(fresh);
  });

  it("does not move the sitemap lastmod until a scored result is released", async () => {
    const old = new Date("2026-01-01T00:00:00.000Z");
    await db
      .update(fixtures)
      .set({ publishedAt: null, completedAt: null })
      .where(eq(fixtures.competitionId, competitionId));
    await db
      .update(fixtureResults)
      .set({ updatedAt: old })
      .where(eq(fixtureResults.competitionId, competitionId));
    const fresh = await scoredFixture("self_scored", 5);
    const lastmod = async () =>
      (await publicSeasonSitemap()).find((entry) => entry.slug === `release-${competitionId}`)
        ?.lastModified;
    // The season row itself is touched by trigger (0099); the fresh result,
    // written after it, must not move lastmod past it while it is held back.
    const [season] = await db
      .select({ updatedAt: competitions.updatedAt })
      .from(competitions)
      .where(eq(competitions.id, competitionId));
    const [result] = await db
      .select({ updatedAt: fixtureResults.updatedAt })
      .from(fixtureResults)
      .where(eq(fixtureResults.fixtureId, fresh));
    expect(result && season && result.updatedAt > season.updatedAt).toBe(true);
    expect(await lastmod()).toEqual(season?.updatedAt);
    await db.update(matches).set({ trustLevel: "verified" }).where(eq(matches.fixtureId, fresh));
    expect(await lastmod()).toEqual(result?.updatedAt);
  });
});
