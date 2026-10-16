import { NEW_SEASON_SCORING_RULES, parseSeasonScoringRules } from "@desiauction/core/scoring";
import {
  createDb,
  newId,
  people,
  organizations,
  competitions,
  teams,
  fixtures,
  fixtureResults,
  teamManagers,
  fixtureOfficials,
  grants,
  withTenantDb,
} from "@desiauction/db";
import { eq, sql } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { env } from "../../env";
import { logger } from "../logger";
import { createCompetition } from "../competition/competitions";
import { purgeOrg } from "../test-support/purge-org";
const owner = createDb(env.DATABASE_URL);
const app = env.APP_DATABASE_URL ? createDb(env.APP_DATABASE_URL) : null;
const creator = newId();
const manager = newId();
const stranger = newId();
const orgId = newId();
const otherOrgId = newId();
const competitionId = newId();
const teamId = newId();
const otherTeamId = newId();
const fixtureId = newId();
const ownManagerId = newId();
const otherManagerId = newId();
beforeAll(async () => {
  if (!app) logger().info("LS-1 manager/official role checks skipped: APP_DATABASE_URL is not set");
  await owner.db.insert(people).values(
    [creator, manager, stranger].map((id) => ({
      id,
      email: `ls1-${id}@example.test`,
      name: "Match person",
    })),
  );
  await owner.db.insert(organizations).values([
    { id: orgId, name: "Match club", slug: `ls1-${orgId}`, createdBy: creator },
    { id: otherOrgId, name: "Other club", slug: `ls1-${otherOrgId}`, createdBy: creator },
  ]);
  await owner.db.insert(competitions).values({
    id: competitionId,
    orgId,
    sport: "cricket",
    name: "Match cup",
    slug: `ls1-${competitionId}`,
    createdBy: creator,
  });
  await owner.db
    .insert(teams)
    .values({ id: teamId, orgId, competitionId, name: "Team", createdBy: creator });
  await owner.db
    .insert(teams)
    .values({ id: otherTeamId, orgId, competitionId, name: "Other team", createdBy: creator });
  await owner.db.insert(fixtures).values({
    id: fixtureId,
    orgId,
    competitionId,
    fixtureNumber: "LS1-F001",
    seq: 1,
    createdBy: creator,
  });
  await owner.db.insert(teamManagers).values([
    {
      id: ownManagerId,
      teamId,
      orgId,
      competitionId,
      personId: manager,
      role: "captain",
      source: "organizer",
      createdBy: creator,
    },
    {
      id: otherManagerId,
      teamId,
      orgId,
      competitionId,
      personId: creator,
      role: "manager",
      source: "auction_owner",
      createdBy: creator,
    },
  ]);
  await owner.db.insert(fixtureOfficials).values({
    id: newId(),
    fixtureId,
    orgId,
    competitionId,
    role: "scorer",
    personId: manager,
    displayName: "Scorer",
    createdBy: creator,
  });
});
afterAll(async () => {
  await purgeOrg(owner.db, orgId);
  await purgeOrg(owner.db, otherOrgId);
  for (const id of [creator, manager, stranger])
    await owner.db.delete(people).where(eq(people.id, id));
  if (app) await app.sql.end();
  await owner.sql.end();
});
describe("LS-1 managers, officials and season rules", () => {
  it.skipIf(!app)(
    "allows a manager to read only their own rows outside the club, without cross-club writes",
    async () => {
      if (!app) throw new Error("APP_DATABASE_URL required");
      await withTenantDb(app, { personId: manager, orgId: otherOrgId }, async (db) => {
        const rows = await db
          .select()
          .from(teamManagers)
          .where(eq(teamManagers.competitionId, competitionId));
        expect(rows.map((row) => row.id)).toEqual([ownManagerId]);
      });
      await withTenantDb(app, { personId: stranger, orgId: otherOrgId }, async (db) => {
        expect(
          await db.select().from(teamManagers).where(eq(teamManagers.competitionId, competitionId)),
        ).toEqual([]);
      });
      await expect(
        withTenantDb(app, { personId: manager, orgId: otherOrgId }, (db) =>
          db.insert(teamManagers).values({
            id: newId(),
            teamId: otherTeamId,
            orgId,
            competitionId,
            personId: manager,
            role: "manager",
            source: "team_entry",
            createdBy: manager,
          }),
        ),
      ).rejects.toMatchObject({ cause: { code: "42501" } });
    },
  );
  it.skipIf(!app)("keeps officials tenant-only, even for the appointed scorer", async () => {
    if (!app) throw new Error("APP_DATABASE_URL required");
    await withTenantDb(app, { personId: manager, orgId: otherOrgId }, async (db) => {
      expect(
        await db.select().from(fixtureOfficials).where(eq(fixtureOfficials.fixtureId, fixtureId)),
      ).toEqual([]);
    });
    await withTenantDb(app, { personId: creator, orgId }, async (db) => {
      expect(
        await db.select().from(fixtureOfficials).where(eq(fixtureOfficials.fixtureId, fixtureId)),
      ).toHaveLength(1);
    });
  });
  it("accepts a season scorer grant, keeps auctioneers valid, and rejects club staff there", async () => {
    await withTenantDb(owner, { personId: creator, orgId }, async (db) => {
      for (const capabilitySet of ["fixture:scorer", "auction:conductor"])
        await db.insert(grants).values({
          id: newId(),
          personId: manager,
          scopeType: "tournament",
          scopeId: competitionId,
          capabilitySet,
          grantedBy: creator,
        });
    });
    await expect(
      withTenantDb(owner, { personId: creator, orgId }, (db) =>
        db.insert(grants).values({
          id: newId(),
          personId: manager,
          scopeType: "tournament",
          scopeId: competitionId,
          capabilitySet: "org:staff",
          grantedBy: creator,
        }),
      ),
    ).rejects.toThrow();
  });
  it("defaults typed results and stores an explicit scored result", async () => {
    await withTenantDb(owner, { personId: creator, orgId }, async (db) => {
      await db
        .insert(fixtureResults)
        .values({ fixtureId, orgId, competitionId, outcome: "no_result", recordedBy: creator });
      const [result] = await db
        .select()
        .from(fixtureResults)
        .where(eq(fixtureResults.fixtureId, fixtureId));
      expect(result?.source).toBe("typed");
      await db
        .update(fixtureResults)
        .set({ source: "scored" })
        .where(eq(fixtureResults.fixtureId, fixtureId));
      const [scored] = await db
        .select()
        .from(fixtureResults)
        .where(eq(fixtureResults.fixtureId, fixtureId));
      expect(scored?.source).toBe("scored");
    });
  });
  it("pins new season defaults explicitly while absent legacy flags keep old NRR behavior", async () => {
    const created = await withTenantDb(owner, { personId: creator, orgId }, (db) =>
      createCompetition(db, orgId, creator, { sport: "cricket", name: "New scoring cup" }),
    );
    const [row] = await owner.db.select().from(competitions).where(eq(competitions.id, created.id));
    expect(row?.scoringRules).toEqual(NEW_SEASON_SCORING_RULES);
    const [legacy] = await owner.db
      .select()
      .from(competitions)
      .where(eq(competitions.id, competitionId));
    expect(parseSeasonScoringRules(legacy?.scoringRules)).toMatchObject({
      allOutUsesQuota: false,
      excludeNoResultFromNrr: false,
    });
  });
  it("forces tenant policies on both new tables", async () => {
    const rows = await owner.db.execute<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policyname: string;
    }>(sql`
      select c.relname,c.relrowsecurity,c.relforcerowsecurity,p.policyname
      from pg_class c join pg_policies p on p.tablename=c.relname and p.schemaname='public'
      where c.relnamespace='public'::regnamespace and c.relname in ('team_managers','fixture_officials')`);
    expect(rows.map((row) => row.policyname).sort()).toEqual([
      "fixture_officials_tenant",
      "team_managers_person_read",
      "team_managers_tenant",
    ]);
    for (const row of rows)
      expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });
  it("lets a manager read their rows from any tenant but write only inside the club (0125)", async () => {
    const policies = await owner.db.execute<{ policyname: string; cmd: string; qual: string }>(sql`
      select policyname, cmd, qual from pg_policies
      where schemaname = 'public' and tablename = 'team_managers'`);
    const byName = new Map(policies.map((row) => [row.policyname, row]));
    expect(byName.get("team_managers_person_read")?.cmd).toBe("SELECT");
    expect(byName.get("team_managers_tenant")?.qual).not.toContain("person_id");
  });
});
