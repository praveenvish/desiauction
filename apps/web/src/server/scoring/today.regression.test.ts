import { FORMAT_PRESETS } from "@desiauction/core/scoring";
import {
  competitions,
  createDb,
  fixtureLineups,
  fixtures,
  grants,
  matches,
  matchEvents,
  newId,
  organizations,
  people,
  registrations,
  teams,
  withTenantDb,
} from "@desiauction/db";
import { eq } from "drizzle-orm";
import { env } from "../../env";
import { purgeOrg } from "../test-support/purge-org";
import { todayOn } from "./today";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nowWallClock } from "../competition/fixtures";
import { fixtureProblems, kickoffInstant, todayModel, type TodayFixtureFacts } from "./today-model";
const now = new Date("2026-10-09T12:00:00Z");
const today = "2026-10-09";
const fixture = (patch: Partial<TodayFixtureFacts> = {}): TodayFixtureFacts => ({
  id: "one",
  number: "1",
  kickoffAt: "2026-10-09T17:30",
  status: "published",
  home: "Home",
  away: "Away",
  ground: "Ground",
  groundId: "ground",
  phase: "not_started",
  finishedAt: null,
  trust: "self_scored",
  lastReceiptAt: null,
  startedAt: null,
  createdAt: now.toISOString(),
  playing: false,
  missingLineups: [],
  scorerAssigned: true,
  scorerName: "Scorer",
  viewerPeak: 12,
  score: null,
  conditions: "Conditions not set",
  situation: "",
  progress: null,
  quota: "unavailable",
  ...patch,
});
const problems = (patch: Partial<TodayFixtureFacts>) =>
  fixtureProblems(fixture(patch), now, today).map((reason) => reason.kind);
describe("match-day problem detection", () => {
  it("uses Kolkata midnight and interprets naive scheduled time in Kolkata", () => {
    expect(nowWallClock(new Date("2026-10-08T18:29:59Z")).slice(0, 10)).toBe("2026-10-08");
    expect(nowWallClock(new Date("2026-10-08T18:30:00Z")).slice(0, 10)).toBe(today);
    expect(kickoffInstant("2026-10-09T17:30")).toBe(now.getTime());
    expect(kickoffInstant("invalid")).toBeNull();
  });
  it("uses receipt time at the exact fifteen-minute boundary and persisted fallback", () => {
    expect(
      problems({ phase: "live", lastReceiptAt: new Date(now.getTime() - 899999).toISOString() }),
    ).toEqual([]);
    expect(
      problems({ phase: "live", lastReceiptAt: new Date(now.getTime() - 900000).toISOString() }),
    ).toEqual(["quiet"]);
    expect(
      problems({ phase: "live", startedAt: new Date(now.getTime() - 900000).toISOString() }),
    ).toEqual(["quiet"]);
    expect(
      problems({
        phase: "live",
        startedAt: new Date(now.getTime() - 1800000).toISOString(),
        lastReceiptAt: now.toISOString(),
      }),
    ).toEqual([]);
  });
  it("excludes breaks, interruption and all terminal states from quiet warnings", () => {
    for (const phase of [
      "interrupted",
      "innings_break",
      "result_reached",
      "finished",
      "final",
      "no_result",
      "abandoned",
      "walkover",
      "void",
    ] as const)
      expect(problems({ phase, playing: true, lastReceiptAt: "2026-10-08T00:00:00Z" })).toEqual([]);
    expect(
      problems({ phase: "live", status: "completed", lastReceiptAt: "2026-10-08T00:00:00Z" }),
    ).toEqual([]);
    expect(problems({ phase: "stalled" })).toEqual(["stalled"]);
  });
  it("warns on missing sides exactly sixty minutes before and after kickoff, until play", () => {
    expect(problems({ kickoffAt: "2026-10-09T18:30:01", missingLineups: ["Away"] })).toEqual([]);
    expect(problems({ kickoffAt: "2026-10-09T18:30", missingLineups: ["Away"] })).toEqual([
      "lineup",
    ]);
    expect(problems({ kickoffAt: "2026-10-09T16:30", missingLineups: ["Away"] })).toEqual([
      "lineup",
    ]);
    expect(problems({ playing: true, missingLineups: ["Away"] })).toEqual([]);
    expect(problems({ missingLineups: ["Home", "Away"], scorerAssigned: false })).toEqual([
      "lineup",
      "scorer",
    ]);
  });
  it("requires strictly over twenty-four hours and preserves flagged review", () => {
    expect(
      problems({ phase: "finished", finishedAt: new Date(now.getTime() - 86400000).toISOString() }),
    ).toEqual([]);
    const finishedAt = new Date(now.getTime() - 86400001).toISOString();
    expect(problems({ phase: "finished", finishedAt })).toEqual(["review"]);
    for (const trust of ["confirmed", "verified"] as const)
      expect(problems({ phase: "finished", finishedAt, trust })).toEqual([]);
    expect(
      fixtureProblems(fixture({ phase: "finished", finishedAt, trust: "flagged" }), now, today)[0]
        ?.text,
    ).toContain("flagged");
  });
  it("prioritizes one problem card per fixture, retains old unresolved issues, counts today's peaks once", () => {
    const quiet = fixture({
      id: "quiet",
      phase: "live",
      playing: true,
      lastReceiptAt: "2026-10-09T10:00:00Z",
      scorerAssigned: false,
    });
    const old = fixture({
      id: "old",
      kickoffAt: "2026-10-08T10:00",
      phase: "stalled",
      viewerPeak: 100,
    });
    const review = fixture({
      id: "review",
      kickoffAt: "2026-10-07T10:00",
      phase: "finished",
      finishedAt: "2026-10-07T12:00:00Z",
      viewerPeak: 100,
    });
    const missing = fixture({ id: "missing", missingLineups: ["Away"], viewerPeak: 3 });
    const model = todayModel(
      [
        quiet,
        quiet,
        old,
        review,
        missing,
        fixture({ id: "draft", status: "draft" }),
        fixture({ id: "void", phase: "void" }),
        fixture({ id: "future", kickoffAt: "2026-10-10T10:00" }),
      ],
      "cup",
      today,
      now,
    );
    expect(model.matches.map((row) => row.id)).toEqual(["quiet", "missing"]);
    expect(model.problems.map((row) => row.id)).toEqual(["old", "quiet", "missing", "review"]);
    expect(model.viewerPeaks).toBe(15);
    expect(model.groundCount).toBe(1);
    expect(model.problems.find((row) => row.id === "quiet")?.action.href).toBe("/score/quiet");
    expect(model.problems.find((row) => row.id === "missing")?.action.href).toBe(
      "/score/missing/setup",
    );
    expect(model.problems.find((row) => row.id === "review")?.action.label).toBe("Review result");
  });
});

const owner = createDb(env.DATABASE_URL);
const app = env.APP_DATABASE_URL ? createDb(env.APP_DATABASE_URL) : owner;
const actor = newId(),
  scorer = newId(),
  outsider = newId(),
  orgId = newId(),
  season = newId(),
  home = newId(),
  away = newId();
const players = Array.from({ length: 4 }, () => newId());
const regs = players.map(() => newId());
const reg = (index: number) => {
  const id = regs[index];
  if (!id) throw new Error("Missing test registration");
  return id;
};
const read = (personId = actor) =>
  withTenantDb(app, { personId, orgId }, (db) =>
    todayOn(db, { orgId, competitionId: season }, personId, now),
  );
let count = 0;
async function seed() {
  const id = newId();
  count += 1;
  await owner.db.insert(fixtures).values({
    id,
    orgId,
    competitionId: season,
    homeTeamId: home,
    awayTeamId: away,
    kickoffAt: "2026-10-09T17:30",
    status: "published",
    fixtureNumber: `TODAY-${String(count)}`,
    seq: count,
    createdBy: actor,
  });
  return id;
}
beforeAll(async () => {
  await owner.db.insert(people).values(
    [actor, scorer, outsider, ...players].map((id) => ({
      id,
      name: `Today ${id}`,
      email: `today-${id}@example.test`,
    })),
  );
  await owner.db
    .insert(organizations)
    .values({ id: orgId, name: "Today club", slug: `today-${orgId}`, createdBy: actor });
  await owner.db.insert(competitions).values({
    id: season,
    orgId,
    name: "Today cup",
    slug: `today-${season}`,
    sport: "cricket",
    createdBy: actor,
  });
  await owner.db.insert(teams).values(
    [
      { id: home, name: "Home" },
      { id: away, name: "Away" },
    ].map((team) => ({ ...team, orgId, competitionId: season, createdBy: actor })),
  );
  await owner.db.insert(registrations).values(
    regs.map((id, index) => ({
      id,
      personId: players[index] ?? actor,
      orgId,
      competitionId: season,
      status: "approved" as const,
      teamId: index < 2 ? home : away,
    })),
  );
  await owner.db.insert(grants).values([
    {
      id: newId(),
      personId: actor,
      scopeType: "org",
      scopeId: orgId,
      capabilitySet: "org:owner",
      grantedBy: actor,
    },
    {
      id: newId(),
      personId: scorer,
      scopeType: "tournament",
      scopeId: season,
      capabilitySet: "fixture:scorer",
      grantedBy: actor,
    },
  ]);
});
afterAll(async () => {
  await purgeOrg(owner.db, orgId);
  for (const id of [actor, scorer, outsider, ...players])
    await owner.db.delete(people).where(eq(people.id, id));
  if (app !== owner) await app.sql.end();
  await owner.sql.end();
});
describe("tenant match-day read model", () => {
  it("requires organiser capability and does not equate scoring permission with appointment", async () => {
    const id = await seed();
    expect(await read(scorer)).toBeNull();
    expect(await read(outsider)).toBeNull();
    const view = await read();
    expect(
      view?.matches.find((row) => row.id === id)?.reasons.map((reason) => reason.kind),
    ).toEqual(["lineup", "scorer"]);
  });
  it("uses partial saved lineups before setup, then effective canonical lineups instead of stale saved rows", async () => {
    const id = await seed();
    await owner.db.insert(fixtureLineups).values({
      fixtureId: id,
      registrationId: reg(0),
      teamId: home,
      orgId,
      competitionId: season,
      recordedBy: actor,
    });
    expect((await read())?.matches.find((row) => row.id === id)?.missingLineups).toEqual(["Away"]);
    await owner.db.insert(fixtureLineups).values({
      fixtureId: id,
      registrationId: reg(2),
      teamId: away,
      orgId,
      competitionId: season,
      recordedBy: actor,
    });
    expect((await read())?.matches.find((row) => row.id === id)?.missingLineups).toEqual([]);
    await owner.db.insert(matches).values({
      fixtureId: id,
      orgId,
      competitionId: season,
      format: FORMAT_PRESETS.t20,
      awardVersion: "cricket-v1/t20",
      shareToken: newId(),
      lastSeq: 2,
      scorerPersonId: actor,
    });
    await owner.db.insert(matchEvents).values(
      [
        {
          type: "match_started",
          payload: {
            format: FORMAT_PRESETS.t20,
            conditions: {},
            homeTeamId: home,
            awayTeamId: away,
          },
        },
        {
          type: "lineup_confirmed",
          payload: {
            teamId: home,
            battingOrder: [reg(0), reg(1)],
            captainId: reg(0),
            keeperId: reg(1),
            substitutes: [],
          },
        },
      ].map((event, index) => ({
        ...event,
        eventId: newId(),
        fixtureId: id,
        orgId,
        competitionId: season,
        seq: index + 1,
        attempt: 1,
        v: 1,
        actorPersonId: actor,
        clientSeq: index + 1,
        clientRecordedAt: now,
        receivedAt: now,
      })),
    );
    const row = (await read())?.matches.find((row) => row.id === id);
    expect(row?.missingLineups).toEqual(["Away"]);
    expect(row?.scorerAssigned).toBe(true);
    expect(row?.quota).toBe("unavailable");
    const allEvents = await owner.db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.fixtureId, id));
    const target = allEvents.find((event) => event.type === "lineup_confirmed");
    if (!target) throw new Error("Missing lineup event");
    await owner.db.insert(matchEvents).values({
      eventId: newId(),
      fixtureId: id,
      orgId,
      competitionId: season,
      seq: 3,
      attempt: 1,
      v: 1,
      type: "void",
      payload: {},
      targetEventId: target.eventId,
      actorPersonId: actor,
      clientSeq: 3,
      clientRecordedAt: now,
      receivedAt: now,
    });
    await owner.db.update(matches).set({ lastSeq: 3 }).where(eq(matches.fixtureId, id));
    expect((await read())?.matches.find((row) => row.id === id)?.missingLineups).toEqual([
      "Home",
      "Away",
    ]);
  });
  it("rejects a claimed scorer after authority is revoked", async () => {
    const id = await seed();
    await owner.db.insert(matches).values({
      fixtureId: id,
      orgId,
      competitionId: season,
      format: FORMAT_PRESETS.t20,
      awardVersion: "cricket-v1/t20",
      shareToken: newId(),
      scorerPersonId: scorer,
    });
    expect((await read())?.matches.find((row) => row.id === id)?.scorerAssigned).toBe(true);
    await owner.db.update(grants).set({ revokedAt: now }).where(eq(grants.personId, scorer));
    expect((await read())?.matches.find((row) => row.id === id)?.scorerAssigned).toBe(false);
  });
});
