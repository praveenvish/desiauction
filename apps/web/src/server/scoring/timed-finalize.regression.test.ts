import { claimScoring, resumeScoring } from "./claim";
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
import { timedEngine, NEW_SEASON_SCORING_RULES, scoreTimed } from "@desiauction/core/scoring";
import { and, eq, inArray } from "drizzle-orm";
import { env } from "../../env";
import { purgeOrg } from "../test-support/purge-org";
import { startScoredMatch } from "./start";
import { appendScoringRequest, persistedMatchEvent, type ClientEvent } from "./append";
import { persistSeasonAwards } from "../insights/season";

import { overrideAward } from "./awards";
import { noticeParticipants } from "./notice-participants";
import { playWindow } from "./trust-facts";
import { prepareScoring } from "./prepare";
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
    sport: "football",
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
      role: index % 8 === 0 ? "goalkeeper" : "defender",
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
async function setup(sport = "football", formatKey = "football_90") {
  await owner.db.update(competitions).set({ sport }).where(eq(competitions.id, competitionId));
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
      formatKey,
      conditions: {},
      lineups: [
        { teamId: home, players: regs.slice(0, 8), startingActive: regs.slice(0, 7) },
        { teamId: away, players: regs.slice(8, 16), startingActive: regs.slice(8, 15) },
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
async function finish(id: string, periods = 2) {
  await append(id, [
    event("period_ended", { period: 1 }),
    ...Array.from({ length: periods - 1 }, (_, index) => [
      event("period_started", { period: index + 2 }),
      event("period_ended", { period: index + 2 }),
    ]).flat(),
    event("finish", {}),
  ]);
}
async function rowsFor(id: string) {
  return owner.db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.fixtureId, id))
    .orderBy(matchEvents.seq);
}
it("C53 app-role frozen football roles, appearance, clean-sheet/card points, recipients and refinalization/override provenance", async () => {
  const id = await setup();
  await owner.db
    .update(registrations)
    .set({ role: "forward" })
    .where(eq(registrations.id, reg(0)));
  // Events are timestamped as they are created, and the timed engine refuses
  // one stamped before its predecessor: the kick-off must be made first.
  const kickOff = event("period_started", { period: 1 });
  const goal = event("score", { teamId: home, points: 1, scorerId: reg(0), assistId: reg(1) });
  await append(id, [
    kickOff,
    goal,
    event("sub", { teamId: home, outId: reg(1), inId: reg(7) }),
    event("card", { playerId: reg(0), colour: "red" }),
  ]);
  expect(
    await withTenantDb(app, { personId: actor, orgId }, (db) => prepareScoring(db, id, actor)),
  ).toMatchObject({ ok: true, preparation: "started" });
  await finish(id);
  const state = timedEngine.replay((await rowsFor(id)).map(persistedMatchEvent));
  expect(state.participants[reg(0)]?.stats.role).toBe("goalkeeper");
  expect(state.participants[reg(7)]?.stats.activeIntervals.length).toBeGreaterThan(0);
  const scores = scoreTimed(timedEngine.playerLines(state), state);
  expect(scores.get(reg(0))?.points).toBe(15);
  expect(scores.get(reg(1))?.points).toBe(10);
  const lines = await owner.db
    .select()
    .from(matchPlayerLines)
    .where(eq(matchPlayerLines.fixtureId, id));
  expect(lines).toHaveLength(15);
  expect(await owner.db.select().from(ballFacts).where(eq(ballFacts.fixtureId, id))).toEqual([]);
  const [result] = await owner.db
    .select()
    .from(fixtureResults)
    .where(eq(fixtureResults.fixtureId, id));
  expect(result).toMatchObject({
    source: "scored",
    winnerTeamId: home,
    score: { home: { goals: 1 }, away: { goals: 0 } },
  });
  const recipients = await withTenantDb(app, { personId: actor, orgId }, (db) =>
    noticeParticipants(db, id, orgId, competitionId),
  );
  expect(recipients.map((row) => row.registrationId).sort()).toEqual(
    [...timedEngine.playerLines(state).keys()].sort(),
  );
  const before = await owner.db.select().from(matchAwards).where(eq(matchAwards.fixtureId, id));
  await append(id, [
    event(
      "amend",
      { payload: { teamId: home, points: 1, scorerId: reg(0), assistId: reg(1) } },
      goal.eventId,
    ),
  ]);
  expect(await owner.db.select().from(matchAwards).where(eq(matchAwards.fixtureId, id))).toEqual(
    before,
  );
  await withTenantDb(app, { personId: actor, orgId }, (db) =>
    overrideAward(db, {
      fixtureId: id,
      kind: "player_of_match",
      registrationId: reg(7),
      actorId: actor,
      reason: "Observed contribution",
    }),
  );
  await append(id, [
    event("amend", { payload: { teamId: home, points: 1, scorerId: reg(1) } }, goal.eventId),
  ]);
  const publicResult = await publicLiveResult(id, { s: slug }, new Date(), owner.db);
  expect(
    publicResult?.resultDetails?.awards.find((row) => row.kind === "player_of_match")?.source,
  ).toBe("organizer");
  expect(JSON.stringify(publicResult?.resultDetails)).not.toContain(reg(7));
  await owner.db
    .update(registrations)
    .set({ role: "goalkeeper" })
    .where(eq(registrations.id, reg(0)));
});
it("C53 corrected timed activity keeps original receipt identity, missing/backfill coverage refused, zero-goal running time qualifies", async () => {
  const id = await setup();
  const start = event("period_started", { period: 1 });
  await append(id, [start]);
  const stopped = {
    ...event("clock", { running: false }),
    clientRecordedAt: new Date(Date.parse(start.clientRecordedAt) + 1).toISOString(),
  };
  await appendScoringRequest(
    app,
    { personId: actor, orgId },
    id,
    { deviceId: "raid-test", attempt: 1, events: [stopped] },
    new Date(Date.parse(stopped.clientRecordedAt) + 1),
  );
  await finish(id);
  const rows = await rowsFor(id),
    state = timedEngine.replay(rows.map(persistedMatchEvent));
  expect(state.gameClockMs).toBeGreaterThan(0);
  expect(playWindow(state, rows, new Date())).not.toBeNull();
  expect(
    playWindow(
      state,
      rows.filter((row) => row.eventId !== start.eventId),
      new Date(),
    ),
  ).toBeNull();
  expect(
    playWindow(
      state,
      rows.map((row) =>
        row.eventId === start.eventId
          ? { ...row, receivedAt: new Date(row.clientRecordedAt.getTime() + 120001) }
          : row,
      ),
      new Date(),
    ),
  ).toBeNull();
  await append(id, [event("amend", { payload: { running: false } }, stopped.eventId)]);
  const revised = await rowsFor(id),
    after = timedEngine.replay(revised.map(persistedMatchEvent));
  expect(playWindow(after, revised, new Date())?.start).toBe(
    playWindow(state, rows, new Date())?.start,
  );
  const [match] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
  expect(match?.trustLevel).toBe("verified");
});
it("C53 basketball exact actual points/fouls and hockey unscored canonical recipients, refusal and no cricket facts", async () => {
  const basket = await setup("basketball", "basketball_40");
  await append(basket, [
    event("period_started", { period: 1 }),
    event("clock", { running: true }),
    event("score", { teamId: home, points: 3, scorerId: reg(0) }),
    event("foul", { teamId: home, playerId: reg(0) }),
  ]);
  await finish(basket, 4);
  const [line] = await owner.db
    .select()
    .from(matchPlayerLines)
    .where(
      and(eq(matchPlayerLines.fixtureId, basket), eq(matchPlayerLines.registrationId, reg(0))),
    );
  expect(Number(line?.points)).toBe(2);
  expect(
    await withTenantDb(app, { personId: actor, orgId }, (db) =>
      persistSeasonAwards(db, competitionId, actor),
    ),
  ).toEqual([]);
  const hockey = await setup("hockey", "hockey_60");
  await append(hockey, [
    event("period_started", { period: 1 }),
    event("score", { teamId: home, points: 1, scorerId: reg(0) }),
  ]);
  await finish(hockey, 4);
  expect(
    await owner.db.select().from(matchPlayerLines).where(eq(matchPlayerLines.fixtureId, hockey)),
  ).toEqual([]);
  expect(
    await owner.db.select().from(matchAwards).where(eq(matchAwards.fixtureId, hockey)),
  ).toEqual([]);
  expect(await owner.db.select().from(ballFacts).where(eq(ballFacts.fixtureId, hockey))).toEqual(
    [],
  );
  const recipients = await withTenantDb(app, { personId: actor, orgId }, (db) =>
    noticeParticipants(db, hockey, orgId, competitionId),
  );
  expect(recipients).toHaveLength(14);
  await expect(
    withTenantDb(app, { personId: actor, orgId }, (db) =>
      overrideAward(db, {
        fixtureId: hockey,
        kind: "player_of_match",
        registrationId: reg(0),
        actorId: actor,
        reason: "Test refusal",
      }),
    ),
  ).rejects.toThrow(/unavailable/);
});
it("C53 restart and hostile lineup amendment cannot import cricket roles or changed profile roles", async () => {
  const id = await setup();
  const initial = await rowsFor(id);
  const lineup = initial.find(
    (row) =>
      row.type === "lineup_confirmed" && (row.payload as { teamId?: string }).teamId === home,
  );
  if (!lineup) throw new Error("Lineup missing");
  await owner.db
    .update(registrations)
    .set({ role: "forward" })
    .where(eq(registrations.id, reg(0)));
  await append(id, [
    event(
      "amend",
      {
        payload: {
          teamId: home,
          players: regs.slice(0, 8),
          startingActive: regs.slice(0, 7),
          roles: { [reg(0)]: "forward" },
        },
      },
      lineup.eventId,
    ),
  ]);
  let state = timedEngine.replay((await rowsFor(id)).map(persistedMatchEvent));
  expect(state.roles[reg(0)]).toBe("goalkeeper");
  await append(id, [event("restart", { reason: "New attempt" })]);
  const reset = timedEngine.replay((await rowsFor(id)).map(persistedMatchEvent));
  expect(reset.attempt).toBe(2);
  expect(reset.participants).toEqual({});
  const entries = [
    event("match_started", {
      format: state.format,
      conditions: {},
      homeTeamId: home,
      awayTeamId: away,
    }),
    event("lineup_confirmed", {
      teamId: home,
      players: regs.slice(0, 8),
      startingActive: regs.slice(0, 7),
    }),
    event("lineup_confirmed", {
      teamId: away,
      players: regs.slice(8),
      startingActive: regs.slice(8, 15),
    }),
    event("period_started", { period: 1 }),
  ].map((entry) => ({ ...entry, attempt: 2 }));
  await append(id, entries);
  state = timedEngine.replay((await rowsFor(id)).map(persistedMatchEvent));
  expect(state.roles[reg(0)]).toBe("goalkeeper");
  await append(
    id,
    [
      event("period_ended", { period: 1 }),
      event("period_started", { period: 2 }),
      event("period_ended", { period: 2 }),
      event("finish", {}),
    ].map((entry) => ({ ...entry, attempt: 2 })),
  );
});
it("C53 delayed timed publication uses released anchor/current trust and rejects private tenant discovery", async () => {
  const id = await setup();
  await append(id, [
    event("period_started", { period: 1 }),
    event("score", { teamId: home, points: 1, scorerId: reg(0) }),
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
  expect(released?.live.family).toBe("timed");
  expect(released?.clock).toEqual({ serverAtMs: at.getTime() + 61000, delayMs: 60000 });
  expect(JSON.stringify(released?.live)).not.toContain(reg(0));
  await owner.db.update(matches).set({ trustLevel: "verified" }).where(eq(matches.fixtureId, id));
  expect((await publicLiveResult(id, { s: slug }, at, owner.db))?.clock?.delayMs).toBe(0);
  await owner.db
    .update(competitions)
    .set({ visibility: "private" })
    .where(eq(competitions.id, competitionId));
  expect(await publicLiveResult(id, { s: slug }, at, owner.db)).toBeNull();
  await owner.db
    .update(competitions)
    .set({ visibility: "public" })
    .where(eq(competitions.id, competitionId));
  await finish(id);
});

it("C53 timed device claim resumes canonical history and rejects stale-device writes", async () => {
  const id = await setup();
  await append(id, [event("period_started", { period: 1 })]);
  const before = await rowsFor(id);
  expect(
    await withTenantDb(app, { personId: actor, orgId }, (db) =>
      claimScoring(db, id, actor, { deviceId: "timed-second", mode: "clean" }),
    ),
  ).toMatchObject({ ok: true });
  expect(
    await withTenantDb(app, { personId: actor, orgId }, (db) => resumeScoring(db, id, actor, 0)),
  ).toMatchObject({ ok: true, lastSeq: before.length });
  const attempted = event("score", { teamId: home, points: 1, scorerId: reg(0) });
  expect(
    await appendScoringRequest(app, { personId: actor, orgId }, id, {
      deviceId: "raid-test",
      attempt: 1,
      events: [attempted],
    }),
  ).toMatchObject({ ok: false, error: "forbidden" });
  expect((await rowsFor(id)).length).toBe(before.length);
  expect(
    await appendScoringRequest(app, { personId: actor, orgId }, id, {
      deviceId: "timed-second",
      attempt: 1,
      events: [attempted],
    }),
  ).toMatchObject({ ok: true, acks: [{ status: "stored" }] });
  await withTenantDb(app, { personId: actor, orgId }, (db) =>
    claimScoring(db, id, actor, { deviceId: "raid-test", mode: "clean" }),
  );
  await finish(id);
});
