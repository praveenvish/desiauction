import { FORMAT_PRESETS } from "@desiauction/core/scoring";
import {
  createDb,
  newId,
  people,
  organizations,
  competitions,
  fixtures,
  matches,
  matchEvents,
  matchLiveState,
  withTenantDb,
  type Db,
} from "@desiauction/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env, parseEnv } from "../../env";
import { purgeOrg } from "../test-support/purge-org";
import { logger } from "../logger";

const owner = createDb(env.DATABASE_URL);
const appUrl = env.APP_DATABASE_URL;
const app = appUrl ? createDb(appUrl) : null;
const personId = newId();
const orgId = newId();
const otherOrgId = newId();
const competitionId = newId();
const fixtureId = newId();
const eventId = newId();
const context = { personId, orgId };

async function writeProjection(db: Db, fixtureId: string, eventId: string): Promise<void> {
  await db.insert(matches).values({
    fixtureId,
    orgId,
    competitionId,
    format: FORMAT_PRESETS.t20,
    awardVersion: "cricket-v1/t20",
    shareToken: `ls1-${fixtureId}`,
  });
  await db.insert(matchEvents).values({
    fixtureId,
    orgId,
    competitionId,
    eventId,
    seq: 1,
    attempt: 1,
    type: "match_started",
    payload: { format: FORMAT_PRESETS.t20 },
    actorPersonId: personId,
    clientSeq: 1,
    clientRecordedAt: new Date("2026-10-09T00:00:00Z"),
  });
  await db
    .insert(matchLiveState)
    .values({ fixtureId, orgId, competitionId, seq: 1, state: { v: 1, phase: "not_started" } });
}

beforeAll(async () => {
  if (!app) logger().info("LS-1 role isolation/update checks skipped: APP_DATABASE_URL is not set");
  await owner.db
    .insert(people)
    .values({ id: personId, email: `ls1-${personId}@example.test`, name: "Scorer" });
  await owner.db.insert(organizations).values([
    { id: orgId, name: "LS-1 Club", slug: `ls1-${orgId}`, createdBy: personId },
    { id: otherOrgId, name: "Other club", slug: `ls1-${otherOrgId}`, createdBy: personId },
  ]);
  await owner.db.insert(competitions).values({
    id: competitionId,
    orgId,
    name: "LS-1 Cup",
    slug: `ls1-${competitionId}`,
    sport: "cricket",
    createdBy: personId,
  });
  await owner.db.insert(fixtures).values({
    id: fixtureId,
    orgId,
    competitionId,
    fixtureNumber: "LS1-F001",
    seq: 1,
    createdBy: personId,
  });
  await withTenantDb(owner, context, (db) => writeProjection(db, fixtureId, eventId));
});
afterAll(async () => {
  await purgeOrg(owner.db, orgId);
  await purgeOrg(owner.db, otherOrgId);
  await owner.db.delete(people).where(eq(people.id, personId));
  if (app) await app.sql.end();
  await owner.sql.end();
});

describe("LS-1 match schema", () => {
  it("validates a supplied app URL and leaves absence explicit", () => {
    expect(
      parseEnv({ NODE_ENV: "test", DATABASE_URL: env.DATABASE_URL }).APP_DATABASE_URL,
    ).toBeUndefined();
    expect(
      parseEnv({
        NODE_ENV: "test",
        DATABASE_URL: env.DATABASE_URL,
        APP_DATABASE_URL: "postgres://test:test@localhost/test",
      }).APP_DATABASE_URL,
    ).toBe("postgres://test:test@localhost/test");
    expect(() =>
      parseEnv({
        NODE_ENV: "test",
        DATABASE_URL: env.DATABASE_URL,
        APP_DATABASE_URL: "https://invalid.example",
      }),
    ).toThrow();
  });

  it("round-trips all three projections under a tenant boundary with contract defaults", async () => {
    await withTenantDb(owner, context, async (db) => {
      const [match] = await db.select().from(matches).where(eq(matches.fixtureId, fixtureId));
      expect(match).toMatchObject({
        fixtureId,
        attempt: 1,
        phase: "not_started",
        trustLevel: "self_scored",
        lastSeq: 0,
        viewerPeak: 0,
        conditions: {},
        format: FORMAT_PRESETS.t20,
      });
      const [event] = await db
        .select()
        .from(matchEvents)
        .where(eq(matchEvents.fixtureId, fixtureId));
      expect(event).toMatchObject({ seq: 1, v: 1, eventId, actorPersonId: personId });
      const [live] = await db
        .select()
        .from(matchLiveState)
        .where(eq(matchLiveState.fixtureId, fixtureId));
      expect(live).toMatchObject({ seq: 1, state: { v: 1, phase: "not_started" } });
    });
  });
  it.skipIf(!app)("inserts and reads all projections under the app role", async () => {
    if (!app) throw new Error("APP_DATABASE_URL required");
    const appFixtureId = newId();
    await owner.db.insert(fixtures).values({
      id: appFixtureId,
      orgId,
      competitionId,
      fixtureNumber: "LS1-F002",
      seq: 2,
      createdBy: personId,
    });
    await withTenantDb(app, context, async (db) => {
      await writeProjection(db, appFixtureId, newId());
      expect(
        await db.select().from(matches).where(eq(matches.fixtureId, appFixtureId)),
      ).toHaveLength(1);
      expect(
        await db.select().from(matchEvents).where(eq(matchEvents.fixtureId, appFixtureId)),
      ).toHaveLength(1);
      expect(
        await db.select().from(matchLiveState).where(eq(matchLiveState.fixtureId, appFixtureId)),
      ).toHaveLength(1);
    });
  });
  it.skipIf(!app)("hides every match table from another club under the app role", async () => {
    if (!app) throw new Error("APP_DATABASE_URL required");
    await withTenantDb(app, { personId, orgId: otherOrgId }, async (db) => {
      expect(await db.select().from(matches).where(eq(matches.fixtureId, fixtureId))).toEqual([]);
      expect(
        await db.select().from(matchEvents).where(eq(matchEvents.fixtureId, fixtureId)),
      ).toEqual([]);
      expect(
        await db.select().from(matchLiveState).where(eq(matchLiveState.fixtureId, fixtureId)),
      ).toEqual([]);
    });
  });
  it.skipIf(!app)(
    "refuses event UPDATE and DELETE under the app role and preserves the event",
    async () => {
      if (!app) throw new Error("APP_DATABASE_URL required");
      await expect(
        withTenantDb(app, context, (db) =>
          db
            .update(matchEvents)
            .set({ payload: { changed: true } })
            .where(eq(matchEvents.eventId, eventId)),
        ),
      ).rejects.toThrow();
      await expect(
        withTenantDb(app, context, (db) =>
          db.delete(matchEvents).where(eq(matchEvents.eventId, eventId)),
        ),
      ).rejects.toThrow();
      await withTenantDb(app, context, async (db) => {
        const rows = await db.select().from(matchEvents).where(eq(matchEvents.eventId, eventId));
        expect(rows).toHaveLength(1);
        expect(rows[0]?.payload).toEqual({ format: FORMAT_PRESETS.t20 });
      });
    },
  );
  it("forces RLS and a tenant policy on every new table", async () => {
    const rows = await owner.db.execute<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policyname: string;
    }>(sql`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity, p.policyname
      from pg_class c join pg_policies p on p.tablename=c.relname and p.schemaname='public'
      where c.relnamespace='public'::regnamespace and c.relname in ('matches','match_events','match_live_state') order by c.relname`);
    expect(rows).toHaveLength(3);
    for (const row of rows)
      expect(row).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
        policyname: `${row.relname}_tenant`,
      });
  });
  it.skipIf(!app)(
    "has no event rewrite privilege in any runtime role, and no scoring access in engine/runner",
    async () => {
      for (const role of [
        "desiauction_app",
        "desiauction_system",
        "desiauction_engine",
        "desiauction_runner",
      ])
        for (const verb of ["UPDATE", "DELETE"]) {
          const [row] = await owner.db.execute<{ allowed: boolean }>(
            sql`select has_table_privilege(${role}, 'match_events', ${verb}) as allowed`,
          );
          expect(row?.allowed).toBe(false);
        }
      for (const role of ["desiauction_engine", "desiauction_runner"])
        for (const table of ["matches", "match_events", "match_live_state"])
          for (const verb of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
            const [row] = await owner.db.execute<{ allowed: boolean }>(
              sql`select has_table_privilege(${role}, ${table}, ${verb}) as allowed`,
            );
            expect(row?.allowed).toBe(false);
          }
    },
  );
});
