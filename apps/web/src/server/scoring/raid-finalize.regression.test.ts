import { beforeAll, afterAll, expect, it, vi } from "vitest";
import {
  createDb,
  newId,
  people,
  organizations,
  competitions,
  teams,
  registrations,
  grants,
  fixtures,
  matches,
  matchEvents,
  matchPlayerLines,
  matchAwards,
  ballFacts,
  fixtureResults,
  withTenantDb,
} from "@desiauction/db";
import { raidEngine, NEW_SEASON_SCORING_RULES, scoreKabaddi } from "@desiauction/core/scoring";
import { and, eq, inArray } from "drizzle-orm";
import { env } from "../../env";
import { purgeOrg } from "../test-support/purge-org";
import { startScoredMatch } from "./start";
import { appendScoringRequest, persistedMatchEvent, type ClientEvent } from "./append";
import { persistSeasonAwards } from "../insights/season";
import { raidSeasonAwardComputation } from "./raid-season-awards";
import { overrideAward } from "./awards";
import { publicLiveResult } from "./public";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
if (!env.APP_DATABASE_URL) throw new Error("Raid regressions require the app role");
const owner = createDb(env.DATABASE_URL),
  app = createDb(env.APP_DATABASE_URL);
const orgId = newId(),
  actor = newId(),
  competitionId = newId(),
  home = newId(),
  away = newId(),
  slug = `raid-${competitionId}`;
const persons = Array.from({ length: 16 }, () => newId()),
  regs = persons.map(() => newId());
function reg(index: number) {
  const id = regs[index];
  if (!id) throw new Error("Missing registration");
  return id;
}
let fixtureSeq = 0,
  clientSeq = 3;
beforeAll(async () => {
  await owner.db.insert(people).values(
    [actor, ...persons].map((id) => ({
      id,
      name: "Raid person",
      email: `raid-${id}@example.test`,
    })),
  );
  await owner.db
    .insert(organizations)
    .values({ id: orgId, name: "Raid club", slug: `raid-${orgId}`, createdBy: actor });
  await owner.db.insert(competitions).values({
    id: competitionId,
    orgId,
    sport: "kabaddi",
    name: "Raid cup",
    slug,
    visibility: "public",
    createdBy: actor,
    scoringRules: { ...NEW_SEASON_SCORING_RULES, publicDelaySeconds: 60 },
  });
  await owner.db.insert(teams).values([
    { id: home, orgId, competitionId, name: "Raid home", createdBy: actor },
    { id: away, orgId, competitionId, name: "Raid away", createdBy: actor },
  ]);
  await owner.db.insert(grants).values({
    id: newId(),
    personId: actor,
    scopeType: "org",
    scopeId: orgId,
    capabilitySet: "org:owner",
    grantedBy: actor,
  });
  await owner.db.insert(registrations).values(
    persons.map((personId, index) => ({
      id: reg(index),
      personId,
      orgId,
      competitionId,
      teamId: index < 8 ? home : away,
      status: "approved" as const,
      registrationNumber: `KR-${String(index)}`,
    })),
  );
});
afterAll(async () => {
  await purgeOrg(owner.db, orgId);
  await owner.db.delete(people).where(inArray(people.id, [actor, ...persons]));
  await app.sql.end();
  await owner.sql.end();
});
async function setup() {
  const id = newId();
  fixtureSeq++;
  await owner.db.insert(fixtures).values({
    id,
    orgId,
    competitionId,
    homeTeamId: home,
    awayTeamId: away,
    fixtureNumber: `KR-${String(fixtureSeq)}`,
    seq: fixtureSeq,
    status: "published",
    createdBy: actor,
  });
  const result = await withTenantDb(app, { personId: actor, orgId }, (db) =>
    startScoredMatch(db, id, actor, {
      deviceId: "raid-test",
      formatKey: "pkl_40",
      conditions: {},
      lineups: [
        { teamId: home, players: regs.slice(0, 8), startingMat: regs.slice(0, 7) },
        { teamId: away, players: regs.slice(8, 16), startingMat: regs.slice(8, 15) },
      ],
    }),
  );
  expect(result).toMatchObject({ ok: true });
  return id;
}
function event(
  type: ClientEvent["type"],
  payload: unknown,
  targetEventId: string | null = null,
): ClientEvent {
  return {
    eventId: newId(),
    attempt: 1,
    type,
    v: 1,
    payload,
    targetEventId,
    clientSeq: ++clientSeq,
    clientRecordedAt: new Date().toISOString(),
  } as ClientEvent;
}
async function append(id: string, events: ClientEvent[]) {
  const result = await appendScoringRequest(
    app,
    { personId: actor, orgId },
    id,
    { deviceId: "raid-test", attempt: events[0]?.attempt ?? 1, events },
    new Date(),
  );
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.message);
  expect(result.acks.every((ack) => ack.status === "stored" || ack.status === "duplicate")).toBe(
    true,
  );
  return result;
}
async function finish(id: string) {
  await append(id, [
    event("half_ended", {}),
    event("half_started", { half: 2 }),
    event("half_ended", {}),
    event("finish", {}),
  ]);
}
it("C51 real app-role raid finalization writes exact frozen lines/points/result and no cricket facts; repeat finish idempotent", async () => {
  const id = await setup();
  await append(id, [
    event("half_started", { half: 1 }),
    event("clock", { running: true }),
    event("raid", {
      raiderId: reg(0),
      touchedIds: regs.slice(8, 15),
      bonus: false,
      tackled: false,
      tacklerIds: [],
    }),
  ]);
  const finishing = [
    event("half_ended", {}),
    event("half_started", { half: 2 }),
    event("half_ended", {}),
    event("finish", {}),
  ];
  await append(id, finishing);
  const [match] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
  expect(match).toMatchObject({
    awardVersion: "kabaddi-v1/pkl_40",
    phase: "finished",
    trustLevel: "verified",
  });
  const rows = await owner.db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.fixtureId, id))
    .orderBy(matchEvents.seq);
  const state = raidEngine.replay(rows.map(persistedMatchEvent));
  const scores = scoreKabaddi(raidEngine.playerLines(state));
  const lines = await owner.db
    .select()
    .from(matchPlayerLines)
    .where(eq(matchPlayerLines.fixtureId, id));
  expect(lines).toHaveLength(14);
  for (const line of lines)
    expect(Number(line.points)).toBe(scores.get(line.registrationId)?.points);
  expect(lines.find((line) => line.registrationId === reg(0))).toMatchObject({
    sport: "kabaddi",
    formatKey: "pkl_40",
    stats: { raid: { raidPoints: 7, superRaids: 1 } },
  });
  expect(lines.some((line) => line.registrationId === reg(7))).toBe(false);
  expect(await owner.db.select().from(ballFacts).where(eq(ballFacts.fixtureId, id))).toEqual([]);
  const [result] = await owner.db
    .select()
    .from(fixtureResults)
    .where(eq(fixtureResults.fixtureId, id));
  expect(result).toMatchObject({
    source: "scored",
    score: { home: { points: 9 }, away: { points: 0 } },
    winnerTeamId: home,
  });
  const publicResult = await publicLiveResult(id, { s: slug }, new Date(), owner.db);
  expect(
    publicResult?.resultDetails?.awards.find((award) => award.kind === "player_of_match"),
  ).toMatchObject({
    figures: "7 raid points · 0 tackle points",
    points: 10,
  });
  expect(JSON.stringify(publicResult?.resultDetails)).not.toContain(reg(0));
  const before = await owner.db.select().from(matchAwards).where(eq(matchAwards.fixtureId, id));
  await append(id, finishing);
  expect(await owner.db.select().from(matchAwards).where(eq(matchAwards.fixtureId, id))).toEqual(
    before,
  );
});
it("C51 real super-tackle primary/assist finalization preserves exact awards without team-only attribution", async () => {
  const id = await setup();
  await append(id, [
    event("half_started", { half: 1 }),
    event("clock", { running: true }),
    event("raid", {
      raiderId: reg(0),
      touchedIds: regs.slice(8, 12),
      bonus: false,
      tackled: false,
      tacklerIds: [],
    }),
    event("raid", {
      raiderId: reg(12),
      touchedIds: [],
      bonus: false,
      tackled: false,
      tacklerIds: [],
    }),
  ]);
  const tackled = event("raid", {
    raiderId: reg(0),
    touchedIds: [],
    bonus: false,
    tackled: true,
    tacklerIds: [reg(13), reg(12)],
  });
  await append(id, [tackled]);
  await finish(id);
  const lines = await owner.db
    .select()
    .from(matchPlayerLines)
    .where(eq(matchPlayerLines.fixtureId, id));
  expect(lines.find((line) => line.registrationId === reg(13))).toMatchObject({
    stats: { raid: { tacklePoints: 2, superTackles: 1 } },
    points: "3.00",
  });
  expect(lines.find((line) => line.registrationId === reg(12))).toMatchObject({
    stats: { raid: { tacklePoints: 0, assists: 1 } },
    points: "0.00",
  });
});
it("C51 current trust drives season picks; overrides retained and unsupported kinds refuse", async () => {
  const computation = await withTenantDb(app, { personId: actor, orgId }, (db) =>
    raidSeasonAwardComputation(db, competitionId),
  );
  expect(computation?.picks.best_raider?.registrationId).toBe(reg(0));
  expect(computation?.picks.best_defender?.registrationId).toBe(reg(13));
  await withTenantDb(app, { personId: actor, orgId }, (db) =>
    persistSeasonAwards(db, competitionId, actor),
  );
  const before = await owner.db
    .select()
    .from(matchAwards)
    .where(and(eq(matchAwards.competitionId, competitionId), eq(matchAwards.scope, "season")));
  expect(before).toHaveLength(3);
  await withTenantDb(app, { personId: actor, orgId }, (db) =>
    persistSeasonAwards(db, competitionId, actor),
  );
  expect(
    await owner.db
      .select()
      .from(matchAwards)
      .where(and(eq(matchAwards.competitionId, competitionId), eq(matchAwards.scope, "season"))),
  ).toEqual(before);
  await withTenantDb(app, { personId: actor, orgId }, (db) =>
    overrideAward(db, {
      competitionId,
      kind: "best_raider",
      registrationId: reg(1),
      reason: "Organiser review",
      actorId: actor,
    }),
  );
  await withTenantDb(app, { personId: actor, orgId }, (db) =>
    persistSeasonAwards(db, competitionId, actor),
  );
  const selected = await owner.db
    .select()
    .from(matchAwards)
    .where(and(eq(matchAwards.competitionId, competitionId), eq(matchAwards.kind, "best_raider")))
    .orderBy(matchAwards.createdAt);
  expect(selected.at(-1)).toMatchObject({
    source: "organizer",
    winnerRegistrationId: reg(1),
    computedRegistrationId: reg(0),
  });
  await expect(
    withTenantDb(app, { personId: actor, orgId }, (db) =>
      overrideAward(db, {
        competitionId,
        kind: "best_batter",
        registrationId: reg(0),
        reason: "Wrong sport",
        actorId: actor,
      }),
    ),
  ).rejects.toThrow("Unsupported award kind");
  await owner.db
    .update(matches)
    .set({ trustLevel: "flagged" })
    .where(eq(matches.competitionId, competitionId));
  const excluded = await withTenantDb(app, { personId: actor, orgId }, (db) =>
    raidSeasonAwardComputation(db, competitionId),
  );
  expect(excluded?.players).toEqual([]);
  expect(excluded?.picks).toEqual({ season_mvp: null, best_raider: null, best_defender: null });
});
it("C51 delayed raid publication selects released anchor and current delay context, not private future clock", async () => {
  const id = await setup();
  await append(id, [
    event("half_started", { half: 1 }),
    event("clock", { running: true }),
    event("raid", {
      raiderId: reg(0),
      touchedIds: [],
      bonus: false,
      tackled: false,
      tacklerIds: [],
    }),
  ]);
  await owner.db
    .update(matches)
    .set({ trustLevel: "self_scored" })
    .where(eq(matches.fixtureId, id));
  const at = new Date();
  expect(await publicLiveResult(id, { s: slug }, at, owner.db)).toBeNull();
  const released = await publicLiveResult(
    id,
    { s: slug },
    new Date(at.getTime() + 61000),
    owner.db,
  );
  expect(released?.live.family).toBe("raid");
  expect(released?.clock).toEqual({ serverAtMs: at.getTime() + 61000, delayMs: 60000 });
  const verified = await owner.db
    .update(matches)
    .set({ trustLevel: "verified" })
    .where(eq(matches.fixtureId, id))
    .returning();
  expect(verified).toHaveLength(1);
  expect((await publicLiveResult(id, { s: slug }, at, owner.db))?.clock?.delayMs).toBe(0);
  await finish(id);
});

it("C51 accepted amendments retain original raid identity and clock, then finalize corrected player credit", async () => {
  const id = await setup();
  await append(id, [event("half_started", { half: 1 }), event("clock", { running: true })]);
  const original = event("raid", {
    raiderId: reg(0),
    touchedIds: [reg(8)],
    bonus: false,
    tackled: false,
    tacklerIds: [],
  });
  await append(id, [original]);
  const correction = event(
    "amend",
    {
      payload: {
        raiderId: reg(0),
        touchedIds: [reg(8), reg(9)],
        bonus: false,
        tackled: false,
        tacklerIds: [],
      },
    },
    original.eventId,
  );
  await append(id, [correction]);
  const rows = await owner.db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.fixtureId, id))
    .orderBy(matchEvents.seq);
  const state = raidEngine.replay(rows.map(persistedMatchEvent));
  expect(state.raids).toEqual([
    {
      eventId: original.eventId,
      seq: rows.find((row) => row.eventId === original.eventId)?.seq,
      clientRecordedAt: original.clientRecordedAt,
    },
  ]);
  expect(state.points.home).toBe(2);
  await finish(id);
  const [line] = await owner.db
    .select()
    .from(matchPlayerLines)
    .where(and(eq(matchPlayerLines.fixtureId, id), eq(matchPlayerLines.registrationId, reg(0))));
  expect(line).toMatchObject({ points: "2.00", stats: { raid: { raidPoints: 2 } } });
  const [match] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
  expect(match?.trustLevel).toBe("verified");
  expect(await owner.db.select().from(ballFacts).where(eq(ballFacts.fixtureId, id))).toEqual([]);
});

it("C51 restart clears effective raids and scoring credit, while retaining accepted history and resuming own format", async () => {
  const id = await setup();
  const setupRows = await owner.db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.fixtureId, id))
    .orderBy(matchEvents.seq);
  await append(id, [
    event("half_started", { half: 1 }),
    event("clock", { running: true }),
    event("raid", {
      raiderId: reg(0),
      touchedIds: [reg(8)],
      bonus: false,
      tackled: false,
      tacklerIds: [],
    }),
  ]);
  await append(id, [event("restart", { reason: "Restart requested before play resumed" })]);
  const next = [
    ...setupRows.map((row) => event(row.type as ClientEvent["type"], row.payload)),
    event("half_started", { half: 1 }),
    event("clock", { running: true }),
    event("raid", {
      raiderId: reg(1),
      touchedIds: [reg(9)],
      bonus: false,
      tackled: false,
      tacklerIds: [],
    }),
  ].map((entry) => ({ ...entry, attempt: 2 }));
  await append(id, next);
  const finishing = [
    event("half_ended", {}),
    event("half_started", { half: 2 }),
    event("half_ended", {}),
    event("finish", {}),
  ].map((entry) => ({ ...entry, attempt: 2 }));
  await append(id, finishing);
  const rows = await owner.db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.fixtureId, id))
    .orderBy(matchEvents.seq);
  const state = raidEngine.replay(rows.map(persistedMatchEvent));
  expect(state.attempt).toBe(2);
  expect(state.raids).toHaveLength(1);
  expect(rows.filter((row) => row.type === "raid")).toHaveLength(2);
  const lines = await owner.db
    .select()
    .from(matchPlayerLines)
    .where(eq(matchPlayerLines.fixtureId, id));
  expect(lines.find((line) => line.registrationId === reg(0))).toMatchObject({ points: "0.00" });
  expect(lines.find((line) => line.registrationId === reg(1))).toMatchObject({ points: "1.00" });
});
