import {
  auctions,
  auctionOwnerInvites,
  competitions,
  createDb,
  fixtureLineups,
  fixtureOfficials,
  fixtures,
  grounds,
  matches,
  matchEvents,
  newId,
  organizations,
  people,
  registrations,
  teamManagers,
  teams,
  venues,
  withTenantDb,
} from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../../env";
import { purgeOrg } from "../test-support/purge-org";
import { scoringDay, scoringHome, scoringSetup, hasFinishedScoring } from "./home";
import { addScoringGuest } from "./guests";
import { startScoredMatch, type StartScoredMatchInput } from "./start";
const owner = createDb(env.DATABASE_URL),
  app = env.APP_DATABASE_URL ? createDb(env.APP_DATABASE_URL) : owner;
const actor = newId(),
  guestOwner = newId(),
  stranger = newId(),
  orgId = newId(),
  season = newId(),
  home = newId(),
  away = newId(),
  venue = newId(),
  ground = newId();
const playerIds = Array.from({ length: 4 }, () => newId()),
  ids = playerIds.map(() => newId());
const at = (index: number) => {
  const id = ids[index];
  if (!id) throw new Error("Missing registration");
  return id;
};
const now = new Date("2026-10-09T12:00:00Z");
let seq = 0;
const within = <T>(personId: string, fn: (db: typeof owner.db) => Promise<T>) =>
  withTenantDb(app, { personId, orgId }, fn);
async function fixture(
  status: typeof fixtures.$inferInsert.status = "published",
  day = "2026-10-09",
) {
  const id = newId();
  seq += 1;
  await owner.db.insert(fixtures).values({
    id,
    orgId,
    competitionId: season,
    fixtureNumber: `HOME-${String(seq)}`,
    seq,
    homeTeamId: home,
    awayTeamId: away,
    groundId: ground,
    kickoffAt: `${day}T19:00`,
    status,
    createdBy: actor,
  });
  return id;
}
async function appoint(id: string, personId = actor) {
  await owner.db.insert(fixtureOfficials).values({
    id: newId(),
    orgId,
    competitionId: season,
    fixtureId: id,
    personId,
    role: "scorer",
    displayName: "Setup scorer",
    createdBy: actor,
  });
}
const input: StartScoredMatchInput = {
  deviceId: "setup-test",
  formatKey: "t10",
  conditions: { timeOfDay: "night" },
  lineups: [
    {
      teamId: home,
      battingOrder: [at(0), at(1)],
      captainId: at(0),
      keeperId: at(1),
      substitutes: [],
    },
    {
      teamId: away,
      battingOrder: [at(2), at(3)],
      captainId: at(2),
      keeperId: at(3),
      substitutes: [],
    },
  ],
};
beforeAll(async () => {
  await owner.db.insert(people).values(
    [actor, guestOwner, stranger, ...playerIds].map((id) => ({
      id,
      name: `Setup ${id}`,
      email: `setup-${id}@example.test`,
    })),
  );
  await owner.db
    .insert(organizations)
    .values({ id: orgId, name: "Setup club", slug: `setup-${orgId}`, createdBy: actor });
  await owner.db.insert(competitions).values({
    id: season,
    orgId,
    name: "Setup cup",
    slug: `setup-${season}`,
    sport: "cricket",
    scoringRules: { formatKey: "t10", ball: { type: "leather", colour: "white" } },
    createdBy: actor,
  });
  await owner.db.insert(teams).values(
    [home, away].map((id, index) => ({
      id,
      orgId,
      competitionId: season,
      name: `Setup team ${String(index)}`,
      createdBy: actor,
    })),
  );
  await owner.db.insert(registrations).values(
    ids.map((id, index) => ({
      id,
      personId: playerIds[index] ?? actor,
      orgId,
      competitionId: season,
      status: "approved" as const,
      teamId: index < 2 ? home : away,
      isCaptain: index % 2 === 0,
      role: index % 2 === 1 ? "wicket_keeper" : "batter",
    })),
  );
  await owner.db.insert(venues).values({ id: venue, orgId, name: "Setup venue", createdBy: actor });
  await owner.db.insert(grounds).values({
    id: ground,
    orgId,
    venueId: venue,
    name: "Ground 2",
    surface: "concrete",
    floodlights: true,
    indoor: true,
    createdBy: actor,
  });
});
afterAll(async () => {
  await purgeOrg(owner.db, orgId);
  for (const id of [actor, guestOwner, stranger, ...playerIds])
    await owner.db.delete(people).where(eq(people.id, id));
  await app.sql.end();
  if (app !== owner) await owner.sql.end();
});
describe("scorer home and setup", () => {
  it("lists only today's authorized fixtures and ongoing matches, with default conditions and readiness", async () => {
    const id = await fixture();
    await appoint(id);
    const yesterday = await fixture("published", "2026-10-08");
    await appoint(yesterday);
    const ongoing = await fixture("in_progress", "2026-10-08");
    await appoint(ongoing);
    const other = await fixture();
    await owner.db.insert(fixtureLineups).values(
      [at(0), at(1)].map((registrationId) => ({
        fixtureId: id,
        registrationId,
        teamId: home,
        orgId,
        competitionId: season,
        recordedBy: actor,
      })),
    );
    await owner.db.insert(fixtureOfficials).values({
      id: newId(),
      orgId,
      competitionId: season,
      fixtureId: id,
      personId: stranger,
      role: "umpire",
      displayName: "Setup umpire",
      createdBy: actor,
    });
    const rows = await within(actor, (db) => scoringHome(db, actor, "2026-10-09", now));
    expect(rows.map((row) => row.fixtureId)).toEqual([ongoing, id]);
    expect(rows.find((row) => row.fixtureId === id)).toMatchObject({
      conditions: {
        timeOfDay: "night",
        ground: "indoor",
        pitch: "cement",
        ball: { type: "leather", colour: "white" },
      },
      format: { key: "t10" },
      umpires: 1,
    });
    const picked = rows.find((row) => row.fixtureId === id);
    expect(picked?.teams[0].selectedIds).toEqual(expect.arrayContaining([at(0), at(1)]));
    expect(picked?.teams[1].selectedIds).toEqual([]);
    expect(await within(stranger, (db) => scoringSetup(db, other, stranger, now))).toBeNull();
    expect(scoringDay(new Date("2026-10-08T18:30:00Z"))).toBe("2026-10-09");
  });
  it("first page load provisions an accepted auction owner once and honors historical revocation", async () => {
    const auction = newId(),
      invite = newId(),
      id = await fixture();
    await owner.db.insert(auctions).values({
      id: auction,
      orgId,
      competitionId: season,
      name: "Setup auction",
      status: "completed",
      kind: "real",
      config: {},
      createdBy: actor,
    });
    await owner.db.insert(auctionOwnerInvites).values({
      id: invite,
      orgId,
      auctionId: auction,
      teamId: home,
      tokenHash: newId(),
      expiresAt: new Date(now.getTime() + 3600000),
      createdBy: actor,
      acceptedBy: guestOwner,
      acceptedAt: now,
    });
    expect(await within(guestOwner, (db) => scoringSetup(db, id, guestOwner, now))).not.toBeNull();
    expect(await within(guestOwner, (db) => scoringSetup(db, id, guestOwner, now))).not.toBeNull();
    const held = await owner.db
      .select()
      .from(teamManagers)
      .where(and(eq(teamManagers.personId, guestOwner), eq(teamManagers.teamId, home)));
    expect(held).toHaveLength(1);
    await owner.db
      .update(teamManagers)
      .set({ revokedAt: now })
      .where(eq(teamManagers.personId, guestOwner));
    expect(await within(guestOwner, (db) => scoringSetup(db, id, guestOwner, now))).toBeNull();
  });
  it("adds a pre-start guest without match/claim/events and refuses unauthorized, wrong-team and closed fixtures", async () => {
    const id = await fixture();
    await appoint(id);
    const result = await within(actor, (db) =>
      addScoringGuest(db, id, actor, { teamId: home, name: "Before start guest" }),
    );
    expect(result).toMatchObject({ ok: true });
    expect(await owner.db.select().from(matches).where(eq(matches.fixtureId, id))).toHaveLength(0);
    expect(
      await owner.db.select().from(matchEvents).where(eq(matchEvents.fixtureId, id)),
    ).toHaveLength(0);
    const before = await owner.db
      .select({ id: registrations.id })
      .from(registrations)
      .where(eq(registrations.competitionId, season));
    expect(
      await within(stranger, (db) =>
        addScoringGuest(db, id, stranger, { teamId: home, name: "Unauthorized guest" }),
      ),
    ).toMatchObject({ ok: false, error: "forbidden" });
    expect(
      await within(actor, (db) =>
        addScoringGuest(db, id, actor, { teamId: newId(), name: "Wrong side guest" }),
      ),
    ).toMatchObject({ ok: false, error: "wrong_team" });
    for (const status of ["draft", "scheduled", "completed", "cancelled"] as const) {
      const closed = await fixture(status);
      await appoint(closed);
      expect(
        await within(actor, (db) =>
          addScoringGuest(db, closed, actor, { teamId: home, name: `Closed ${status}` }),
        ),
      ).toMatchObject({ ok: false, error: "not_ready" });
    }
    expect(
      await owner.db
        .select({ id: registrations.id })
        .from(registrations)
        .where(eq(registrations.competitionId, season)),
    ).toHaveLength(before.length);
  });
  it("serializes add-before-start and start-before-add without silently changing the persisted XI", async () => {
    const early = await fixture();
    await appoint(early);
    let ready!: () => void, release!: () => void;
    const prepared = new Promise<void>((resolve) => {
        ready = resolve;
      }),
      commit = new Promise<void>((resolve) => {
        release = resolve;
      });
    let guestId = "";
    const add = within(actor, async (db) => {
      const result = await addScoringGuest(db, early, actor, {
        teamId: home,
        name: "Guest before race",
      });
      if (!result.ok) throw new Error("Guest refused");
      guestId = result.registrationId;
      ready();
      await commit;
      return result;
    });
    await prepared;
    const start = within(actor, (db) =>
      startScoredMatch(db, early, actor, {
        ...input,
        lineups: [
          { ...input.lineups[0], battingOrder: [at(0), guestId], keeperId: guestId },
          input.lineups[1],
        ],
      }),
    );
    release();
    expect(await add).toMatchObject({ ok: true });
    expect(await start).toMatchObject({ ok: true });
    expect(
      await owner.db
        .select()
        .from(fixtureLineups)
        .where(
          and(eq(fixtureLineups.fixtureId, early), eq(fixtureLineups.registrationId, guestId)),
        ),
    ).toHaveLength(1);
    const late = await fixture();
    await appoint(late);
    let started!: () => void, finish!: () => void;
    const startedSignal = new Promise<void>((resolve) => {
        started = resolve;
      }),
      finishSignal = new Promise<void>((resolve) => {
        finish = resolve;
      });
    const first = within(actor, async (db) => {
      const result = await startScoredMatch(db, late, actor, input);
      started();
      await finishSignal;
      return result;
    });
    await startedSignal;
    const second = within(actor, (db) =>
      addScoringGuest(db, late, actor, { teamId: home, name: "Guest after race" }),
    );
    finish();
    expect(await first).toMatchObject({ ok: true });
    const added = await second;
    expect(added).toMatchObject({ ok: true });
    if (!added.ok) throw new Error("Guest refused");
    expect(
      await owner.db
        .select()
        .from(fixtureLineups)
        .where(
          and(
            eq(fixtureLineups.fixtureId, late),
            eq(fixtureLineups.registrationId, added.registrationId),
          ),
        ),
    ).toHaveLength(0);
    expect(
      await owner.db.select().from(matchEvents).where(eq(matchEvents.fixtureId, late)),
    ).toHaveLength(3);
  });
});

it("offers installation only after this tenant's scorer has a finished non-void match", async () => {
  expect(await within(actor, (db) => hasFinishedScoring(db, actor))).toBe(false);
  const id = await fixture("in_progress");
  await owner.db.insert(matches).values({
    fixtureId: id,
    orgId,
    competitionId: season,
    format: { key: "t10" },
    awardVersion: "cricket_v1",
    scorerPersonId: actor,
    shareToken: newId(),
    phase: "live",
  });
  expect(await within(actor, (db) => hasFinishedScoring(db, actor))).toBe(false);
  await owner.db
    .update(matches)
    .set({ phase: "finished", finishedAt: now })
    .where(eq(matches.fixtureId, id));
  expect(await within(actor, (db) => hasFinishedScoring(db, actor))).toBe(true);
  expect(await within(stranger, (db) => hasFinishedScoring(db, stranger))).toBe(false);
  expect(
    await withTenantDb(app, { personId: actor, orgId: newId() }, (db) =>
      hasFinishedScoring(db, actor),
    ),
  ).toBe(false);
  await owner.db.update(matches).set({ phase: "void" }).where(eq(matches.fixtureId, id));
  expect(await within(actor, (db) => hasFinishedScoring(db, actor))).toBe(false);
});
