import { seasonAwardComputation, persistSeasonAwards } from "../insights/season";
import { batterInsights } from "../insights/batter";
import { eligibleSeasonScorers } from "../insights/scorers";
import { claimScoringGuest } from "./guest-claim";
import { cricketCareerFor } from "../player/career-stats";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  NEW_SEASON_SCORING_RULES,
  replayMatch,
  scoreMatch,
  playerLines,
  type MatchEvent,
} from "@desiauction/core/scoring";
import {
  auditLog,
  competitions,
  createDb,
  fixtureResults,
  fixtures,
  grants,
  matchEvents,
  matchAwards,
  matchPlayerLines,
  ballFacts,
  matches,
  matchLiveState,
  messageOutbox,
  consentRecords,
  notificationChannels,
  newId,
  organizations,
  orgMembers,
  people,
  registrations,
  teams,
  withTenantDb,
} from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../env";
import { resultPosterFor } from "../competition/posters";
import { publicLiveResult } from "./public";
import { invalidatePlatformSwitches } from "../messaging/platform-switches";
import { recordFixtureResult, standingsOf } from "../competition/results";
import { purgeOrg } from "../test-support/purge-org";
import { appendScoringRequest, persistedMatchEvent, type ClientEvent } from "./append";
import * as finalization from "./finalize";
import * as awards from "./awards";
import type { PlayerLine } from "@desiauction/core/scoring";
import { startScoredMatch } from "./start";
import {
  recoverableGuestClaimDispatch,
  recoverGuestClaimInvites,
  dispatchResultNotices,
  recoverResultNotices,
} from "./result-notice-delivery";
import { reminderBoundariesFor } from "./reminder-boundaries";
import { resolveMatchNoticeLink } from "./result-notice-link";
import { drainOutbox } from "../messaging/outbox";
import { setWhatsappOptIn, WhatsAppSendError } from "../messaging/whatsapp";
import type { PersonalWhatsAppSender } from "../messaging/whatsapp";
import type { PlayerSmsSender } from "../messaging/sms";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const owner = createDb(env.DATABASE_URL);
const app = env.APP_DATABASE_URL ? createDb(env.APP_DATABASE_URL) : owner;
const organizer = newId();
const actor = newId(),
  orgId = newId(),
  competitionId = newId(),
  home = newId(),
  away = newId();
const claimPeople: string[] = [];
const players = Array.from({ length: 23 }, () => newId()),
  regs = players.map(() => newId());
const reg = (index: number) => {
  const id = regs[index];
  if (!id) throw new Error("registration");
  return id;
};
const slug = `finalize-${competitionId}`;
const deviceId = "finalize-device",
  now = new Date();
let seq = 0,
  clientSeq = 0;
function event(
  type: MatchEvent["type"],
  payload: unknown,
  targetEventId: string | null = null,
): ClientEvent {
  clientSeq += 1;
  return {
    eventId: newId(),
    attempt: 1,
    type,
    v: 1,
    payload,
    targetEventId,
    clientSeq,
    clientRecordedAt: now.toISOString(),
  } as ClientEvent;
}
const append = (id: string, events: ClientEvent[]) =>
  appendScoringRequest(app, { personId: actor, orgId }, id, { deviceId, attempt: 1, events }, now);
async function setup() {
  const id = newId();
  seq += 1;
  await owner.db.insert(fixtures).values({
    id,
    orgId,
    competitionId,
    homeTeamId: home,
    awayTeamId: away,
    fixtureNumber: `FINAL-${String(seq)}`,
    seq,
    status: "published",
    kickoffAt: "2026-10-09T12:00",
    createdBy: actor,
  });
  const result = await withTenantDb(app, { personId: actor, orgId }, (db) =>
    startScoredMatch(db, id, actor, {
      deviceId,
      formatKey: "t10",
      conditions: {},
      lineups: [
        {
          teamId: home,
          battingOrder: regs.slice(0, 11),
          captainId: reg(0),
          keeperId: reg(1),
          substitutes: [],
        },
        {
          teamId: away,
          battingOrder: regs.slice(11, 22),
          captainId: reg(11),
          keeperId: reg(12),
          substitutes: [reg(22)],
        },
      ],
    }),
  );
  if (!result.ok) throw new Error(result.message);
  return id;
}
async function ready(id: string, replacement = false) {
  const stored = await owner.db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.fixtureId, id))
    .orderBy(matchEvents.seq);
  let state = replayMatch(stored.map(persistedMatchEvent));
  const stream: ClientEvent[] = [];
  const push = (entry: ClientEvent) => {
    stream.push(entry);
    state = replayMatch([
      ...stored.map(persistedMatchEvent),
      ...stream.map((e, index) => ({ ...e, seq: index + 4, actorPersonId: actor })),
    ]);
  };
  if (replacement)
    push(event("substitute", { teamId: away, inId: reg(22), outId: reg(11), kind: "injury" }));
  push(event("toss", { winnerTeamId: home, decision: "bat" }));
  push(
    event("innings_started", {
      inningsNo: 1,
      battingTeamId: home,
      strikerId: reg(0),
      nonStrikerId: reg(1),
      bowlerId: replacement ? reg(22) : reg(11),
    }),
  );
  push(
    event("ball", {
      strikerId: reg(0),
      nonStrikerId: reg(1),
      bowlerId: replacement ? reg(22) : reg(11),
      runsBat: 4,
      boundary: 4,
      extras: {},
    }),
  );
  for (let out = 0; out < 10; out += 1) {
    const innings = state.innings.at(-1);
    if (!innings?.strikerId) throw new Error("striker");
    push(event("retire", { registrationId: innings.strikerId, kind: "out" }));
    if (out < 9) push(event("new_batter", { registrationId: reg(out + 2), end: "striker" }));
  }
  push(
    event("innings_started", {
      inningsNo: 2,
      battingTeamId: away,
      strikerId: replacement ? reg(22) : reg(11),
      nonStrikerId: reg(12),
      bowlerId: reg(1),
    }),
  );
  const chase = event("ball", {
    strikerId: replacement ? reg(22) : reg(11),
    nonStrikerId: reg(12),
    bowlerId: reg(1),
    runsBat: 6,
    boundary: 6,
    extras: {},
  });
  push(chase);
  expect(state.phase).toBe("result_reached");
  const result = await append(id, stream);
  expect(result).toMatchObject({ ok: true });
  if (result.ok) expect(result.acks.every((a) => a.status === "stored")).toBe(true);
  return chase;
}
beforeAll(async () => {
  await owner.db.insert(people).values(
    [actor, organizer, ...players].map((id) => ({
      id,
      name: "Final match person",
      email: `final-${id}@example.test`,
    })),
  );
  await owner.db
    .insert(organizations)
    .values({ id: orgId, name: "Finalize club", slug: `final-${orgId}`, createdBy: actor });
  await owner.db.insert(competitions).values({
    id: competitionId,
    orgId,
    sport: "cricket",
    name: "Finalize cup",
    slug,
    createdBy: actor,
    scoringRules: NEW_SEASON_SCORING_RULES,
  });
  await owner.db.insert(teams).values([
    { id: home, orgId, competitionId, name: "Home", createdBy: actor },
    { id: away, orgId, competitionId, name: "Away", createdBy: actor },
  ]);
  await owner.db.insert(grants).values({
    id: newId(),
    personId: organizer,
    scopeType: "org",
    scopeId: orgId,
    capabilitySet: "org:owner",
    grantedBy: actor,
  });
  await owner.db.insert(grants).values({
    id: newId(),
    personId: actor,
    scopeType: "tournament",
    scopeId: competitionId,
    capabilitySet: "fixture:scorer",
    grantedBy: actor,
  });
  await owner.db.insert(registrations).values(
    players.map((personId, index) => ({
      id: reg(index),
      personId,
      orgId,
      competitionId,
      teamId: index < 11 ? home : away,
      status: "approved" as const,
      registrationNumber: `FINAL-R${String(index)}`,
    })),
  );
});
beforeEach(() => vi.clearAllMocks());
afterAll(async () => {
  await purgeOrg(owner.db, orgId);
  await owner.db.delete(consentRecords).where(inArray(consentRecords.personId, players));
  for (const id of [actor, organizer, ...players, ...claimPeople])
    await owner.db.delete(people).where(eq(people.id, id));
  if (app !== owner) await app.sql.end();
  await owner.sql.end();
});
const paths = () => {
  expect(vi.mocked(revalidatePath).mock.calls.map((c) => c[0])).toEqual([
    `/seasons/${slug}/fixtures`,
    `/seasons/${slug}/standings`,
    `/c/${slug}`,
  ]);
};
describe("FIN-1 through the append application boundary", () => {
  it("finishes T10 atomically, writes quota NRR and standings, and does not repeat effects for a duplicate", async () => {
    const id = await setup();
    await ready(id);
    const finish = event("finish", {});
    expect(await append(id, [finish])).toMatchObject({ ok: true, acks: [{ status: "stored" }] });
    paths();
    const [result] = await owner.db
      .select()
      .from(fixtureResults)
      .where(eq(fixtureResults.fixtureId, id));
    expect(result).toMatchObject({
      source: "scored",
      outcome: "away_win",
      winnerTeamId: away,
      score: {
        home: { runs: 4, wickets: 10, balls: 1, nrr_balls: 60 },
        away: { runs: 6, wickets: 0, balls: 1, nrr_balls: 1 },
      },
    });
    expect((await owner.db.select().from(fixtures).where(eq(fixtures.id, id)))[0]).toMatchObject({
      status: "completed",
      completedAt: now,
    });
    const table = await withTenantDb(app, { personId: actor, orgId }, (db) =>
      standingsOf(db, competitionId),
    );
    expect(table.rows[0]?.teamId).toBe(away);
    expect(table.rows[0]?.tiebreakers["net_run_rate"]).toBeCloseTo(35.6);
    // Equal points: quota-denominator NRR places Away first; actual-ball NRR
    // would incorrectly put Home first for these two results.
    const typedId = newId();
    seq += 1;
    await owner.db.insert(fixtures).values({
      id: typedId,
      orgId,
      competitionId,
      homeTeamId: home,
      awayTeamId: away,
      fixtureNumber: `FINAL-${String(seq)}`,
      seq,
      status: "completed",
      createdBy: actor,
    });
    await owner.db.insert(fixtureResults).values({
      fixtureId: typedId,
      orgId,
      competitionId,
      source: "typed",
      outcome: "home_win",
      winnerTeamId: home,
      score: { home: { runs: 5, wickets: 0, balls: 1 }, away: { runs: 0, wickets: 0, balls: 1 } },
      recordedBy: actor,
    });
    const tied = await withTenantDb(app, { personId: actor, orgId }, (db) =>
      standingsOf(db, competitionId),
    );
    expect(tied.rows.map((r) => r.points)).toEqual([2, 2]);
    expect(tied.rows[0]?.teamId).toBe(away);
    expect(tied.rows[0]?.tiebreakers["net_run_rate"]).toBeCloseTo(18 - 54 / 61);

    vi.clearAllMocks();
    expect(await append(id, [finish])).toMatchObject({ ok: true, acks: [{ status: "duplicate" }] });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(
      await owner.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.finalized"))),
    ).toHaveLength(1);
    expect(
      await withTenantDb(app, { personId: actor, orgId }, (db) =>
        recordFixtureResult(db, {
          orgId,
          fixtureId: id,
          actorId: actor,
          result: { outcome: "home_win", homeScore: { runs: 100 }, awayScore: { runs: 0 } },
        }),
      ),
    ).toEqual({ ok: false, reason: "scored_match" });
  });
  it("re-finalizes a finished correction and refreshes the same pages after commit", async () => {
    const id = await setup();
    const chase = await ready(id);
    await append(id, [event("finish", {})]);
    vi.clearAllMocks();
    const amendment = event(
      "amend",
      {
        payload: {
          strikerId: reg(11),
          nonStrikerId: reg(12),
          bowlerId: reg(1),
          runsBat: 5,
          extras: {},
        },
      },
      chase.eventId,
    );
    expect(await append(id, [amendment])).toMatchObject({ ok: true, acks: [{ status: "stored" }] });
    paths();
    expect(
      (await owner.db.select().from(fixtureResults).where(eq(fixtureResults.fixtureId, id)))[0]
        ?.score?.away?.["runs"],
    ).toBe(5);
    expect(
      await owner.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.finalized"))),
    ).toHaveLength(2);
    vi.clearAllMocks();
    await append(id, [amendment]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("rolls back the finish event, snapshot, metadata, result and audit on finalization failure, with no revalidation", async () => {
    const id = await setup();
    await ready(id);
    const finish = event("finish", {});
    const [before] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
    const [liveBefore] = await owner.db
      .select()
      .from(matchLiveState)
      .where(eq(matchLiveState.fixtureId, id));
    const fault = vi
      .spyOn(finalization, "finalizeScoredMatch")
      .mockRejectedValueOnce(new Error("Injected finalization failure"));
    try {
      await expect(append(id, [finish])).rejects.toThrow("Injected finalization failure");
    } finally {
      fault.mockRestore();
    }
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(
      await owner.db
        .select()
        .from(matchEvents)
        .where(and(eq(matchEvents.fixtureId, id), eq(matchEvents.eventId, finish.eventId))),
    ).toHaveLength(0);
    expect((await owner.db.select().from(matches).where(eq(matches.fixtureId, id)))[0]).toEqual(
      before,
    );
    expect(
      (await owner.db.select().from(matchLiveState).where(eq(matchLiveState.fixtureId, id)))[0],
    ).toEqual(liveBefore);
    expect(
      await owner.db.select().from(fixtureResults).where(eq(fixtureResults.fixtureId, id)),
    ).toHaveLength(0);
    expect(
      await owner.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.finalized"))),
    ).toHaveLength(0);
    expect((await owner.db.select().from(fixtures).where(eq(fixtures.id, id)))[0]?.status).toBe(
      "in_progress",
    );
    expect(await append(id, [finish])).toMatchObject({ ok: true, acks: [{ status: "stored" }] });
    paths();
  });

  it("persists canonical lines whose batting and bowling sum to the scorecard, with frozen metadata and automatic picks", async () => {
    const id = await setup();
    await ready(id);
    const finish = event("finish", {});
    await append(id, [finish]);
    const lines = await owner.db
      .select()
      .from(matchPlayerLines)
      .where(eq(matchPlayerLines.fixtureId, id));
    expect(lines).toHaveLength(22);
    const stats = lines.map((row) => row.stats as PlayerLine);
    expect(
      stats
        .filter((line) => line.teamId === home)
        .reduce((n, line) => n + (line.batting?.runs ?? 0), 0),
    ).toBe(4);
    expect(
      stats
        .filter((line) => line.teamId === away)
        .reduce((n, line) => n + (line.batting?.runs ?? 0), 0),
    ).toBe(6);
    expect(stats.reduce((n, line) => n + (line.bowling?.legalBalls ?? 0), 0)).toBe(2);
    expect(stats.reduce((n, line) => n + (line.bowling?.runs ?? 0), 0)).toBe(10);
    expect(
      lines.every(
        (line) =>
          line.formatKey === "t10" && line.sport === "cricket" && line.trustLevel === "verified",
      ),
    ).toBe(true);
    const picks = await owner.db.select().from(matchAwards).where(eq(matchAwards.fixtureId, id));
    expect(picks).toHaveLength(2);
    expect(
      picks.every(
        (pick) =>
          pick.source === "auto" && pick.computedRegistrationId === pick.winnerRegistrationId,
      ),
    ).toBe(true);
    expect(picks.find((pick) => pick.kind === "player_of_match")?.winnerRegistrationId).toBe(
      reg(11),
    );
    expect(picks.find((pick) => pick.kind === "fighter_of_match")?.winnerRegistrationId).toBe(
      reg(0),
    );
    await append(id, [finish]);
    expect(await owner.db.select().from(matchAwards).where(eq(matchAwards.fixtureId, id))).toEqual(
      picks,
    );
  });
  it("organiser overrides append, retain computed pick and chosen score, and remain selected after corrected finalization", async () => {
    const id = await setup();
    const chase = await ready(id);
    await append(id, [event("finish", {})]);
    const before = await owner.db.select().from(matchAwards).where(eq(matchAwards.fixtureId, id));
    const choose = (registrationId: string) =>
      withTenantDb(app, { personId: organizer, orgId }, (db) =>
        awards.overrideAward(
          db,
          {
            fixtureId: id,
            kind: "player_of_match",
            registrationId,
            reason: "  Outstanding effort  ",
            actorId: organizer,
          },
          now,
        ),
      );
    const first = await choose(reg(0));
    const second = await choose(reg(12));
    expect(first).toMatchObject({
      source: "organizer",
      winnerRegistrationId: reg(0),
      computedRegistrationId: reg(11),
      reason: "Outstanding effort",
    });
    expect(second.createdAt.getTime()).toBeGreaterThan(first.createdAt.getTime());
    expect(second.score).toBe("0.00");
    const amendment = event(
      "amend",
      {
        payload: {
          strikerId: reg(11),
          nonStrikerId: reg(12),
          bowlerId: reg(1),
          runsBat: 5,
          extras: {},
        },
      },
      chase.eventId,
    );
    await append(id, [amendment]);
    expect(
      await withTenantDb(app, { personId: organizer, orgId }, (db) =>
        awards.currentAward(db, { fixtureId: id }, "player_of_match"),
      ),
    ).toEqual(second);
    const after = await owner.db.select().from(matchAwards).where(eq(matchAwards.fixtureId, id));
    expect(after.filter((row) => row.kind === "player_of_match")).toHaveLength(3);
    expect(after.filter((row) => before.some((old) => old.id === row.id))).toEqual(before);
    expect(
      (
        (
          await owner.db
            .select()
            .from(matchPlayerLines)
            .where(
              and(eq(matchPlayerLines.fixtureId, id), eq(matchPlayerLines.registrationId, reg(11))),
            )
        )[0]?.stats as PlayerLine
      ).batting?.runs,
    ).toBe(5);
    const audits = await owner.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.award.overridden")));
    expect(audits).toHaveLength(2);
    expect(audits.every((row) => row.at.getTime() === now.getTime())).toBe(true);
  });
  it("computes and appends season defaults once, including the unregistered scorer and null emerging pick", async () => {
    const id = await setup();
    await ready(id);
    await append(id, [event("finish", {})]);
    await owner.db.update(matches).set({ trustLevel: "verified" }).where(eq(matches.fixtureId, id));
    const computation = await withTenantDb(app, { personId: organizer, orgId }, (db) =>
      seasonAwardComputation(db, competitionId),
    );
    expect(computation?.picks.scorer_of_season?.personId).toBe(actor);
    expect(computation?.picks.emerging).toBeNull();
    const write = () =>
      withTenantDb(app, { personId: organizer, orgId }, (db) =>
        persistSeasonAwards(db, competitionId, organizer, now),
      );
    const inserted = await write();
    expect(inserted).toHaveLength(7);
    expect(inserted.find((row) => row.kind === "scorer_of_season")).toMatchObject({
      winnerPersonId: actor,
      computedPersonId: actor,
      winnerRegistrationId: null,
    });
    expect(inserted.find((row) => row.kind === "emerging")).toMatchObject({
      winnerPersonId: null,
      winnerRegistrationId: null,
      score: null,
    });
    expect(await write()).toEqual([]);
    const emptyId = newId();
    await owner.db.insert(competitions).values({
      id: emptyId,
      orgId,
      sport: "cricket",
      name: "No trusted matches",
      slug: `empty-${emptyId}`,
      createdBy: organizer,
    });
    const empty = await withTenantDb(app, { personId: organizer, orgId }, (db) =>
      persistSeasonAwards(db, emptyId, organizer, now),
    );
    expect(empty).toHaveLength(7);
    expect(
      empty.every(
        (row) =>
          row.winnerRegistrationId === null && row.winnerPersonId === null && row.score === null,
      ),
    ).toBe(true);
    expect(
      await withTenantDb(app, { personId: organizer, orgId }, (db) =>
        persistSeasonAwards(db, emptyId, organizer, now),
      ),
    ).toEqual([]);
  });
  it("regenerates real zero-ball non-striker and retirement condition denominators after correction", async () => {
    const id = await setup();
    clientSeq = Math.max(clientSeq, 3);
    const night = event("conditions_changed", { conditions: { timeOfDay: "night" } });
    const stream: ClientEvent[] = [
      event("toss", { winnerTeamId: home, decision: "bat" }),
      event("innings_started", {
        inningsNo: 1,
        battingTeamId: home,
        strikerId: reg(0),
        nonStrikerId: reg(1),
        bowlerId: reg(11),
      }),
      night,
      event("ball", {
        strikerId: reg(0),
        nonStrikerId: reg(1),
        bowlerId: reg(11),
        runsBat: 0,
        extras: {},
        wicket: { kind: "run_out", playerOutId: reg(1), fielderIds: [reg(12)] },
      }),
      event("new_batter", { registrationId: reg(2), end: "non_striker" }),
      event("conditions_changed", { conditions: { timeOfDay: "day" } }),
      event("ball", {
        strikerId: reg(0),
        nonStrikerId: reg(2),
        bowlerId: reg(11),
        runsBat: 4,
        boundary: 4,
        extras: {},
      }),
    ];
    for (let out = 0; out < 9; out++) {
      stream.push(
        event("retire", { registrationId: out === 0 ? reg(0) : reg(out + 2), kind: "out" }),
      );
      if (out < 8)
        stream.push(event("new_batter", { registrationId: reg(out + 3), end: "striker" }));
    }
    stream.push(
      event("innings_started", {
        inningsNo: 2,
        battingTeamId: away,
        strikerId: reg(11),
        nonStrikerId: reg(12),
        bowlerId: reg(2),
      }),
      event("ball", {
        strikerId: reg(11),
        nonStrikerId: reg(12),
        bowlerId: reg(2),
        runsBat: 6,
        boundary: 6,
        extras: {},
      }),
      event("finish", {}),
    );
    const result = await append(id, stream);
    if (!result.ok || result.acks.some((ack) => ack.status !== "stored"))
      throw new Error(JSON.stringify(result));
    const read = (index: number) =>
      withTenantDb(app, { personId: actor, orgId }, (db) =>
        batterInsights(db, { kind: "self", personId: players[index] ?? "missing" }),
      );
    const zero = await read(1);
    expect(zero.conditions.light).toContainEqual(
      expect.objectContaining({ key: "night", balls: 0, average: 0 }),
    );
    const faced = await read(0);
    expect(faced.conditions.light.find((row) => row.key === "day")?.runs).toBeGreaterThanOrEqual(4);
    const canonical = await owner.db
      .select()
      .from(matchPlayerLines)
      .where(and(eq(matchPlayerLines.fixtureId, id), eq(matchPlayerLines.registrationId, reg(1))));
    expect((canonical[0]?.stats as PlayerLine).batting?.dismissals).toMatchObject([
      { inningsNo: 1, conditions: { timeOfDay: "night" } },
    ]);
    const corrected = await append(id, [
      event("amend", { payload: { conditions: { timeOfDay: "day" } } }, night.eventId),
    ]);
    expect(corrected.ok && corrected.acks[0]?.status).toBe("stored");
    const after = await read(1);
    expect(after.conditions.light.some((row) => row.key === "night")).toBe(false);
    expect(after.conditions.light).toContainEqual(
      expect.objectContaining({ key: "day", balls: 0, average: 0 }),
    );
    const facts = await owner.db.select().from(ballFacts).where(eq(ballFacts.fixtureId, id));
    expect(facts).toHaveLength(3);
    expect(facts.every((row) => row.timeOfDay === "day")).toBe(true);
  });
  it("keeps complete-match points and selected-set qualification without modifying stored season picks", async () => {
    const id = await setup();
    await ready(id);
    const [started] = await owner.db
      .select()
      .from(matchEvents)
      .where(and(eq(matchEvents.fixtureId, id), eq(matchEvents.type, "match_started")));
    if (!started) throw new Error("Missing match start");
    expect(
      await append(id, [
        event(
          "amend",
          {
            payload: {
              ...(started.payload as object),
              conditions: { ball: { type: "tennis" }, timeOfDay: "night" },
            },
          },
          started.eventId,
        ),
      ]),
    ).toMatchObject({ ok: true });
    await append(id, [event("finish", {})]);
    await owner.db.update(matches).set({ trustLevel: "verified" }).where(eq(matches.fixtureId, id));
    await withTenantDb(app, { personId: organizer, orgId }, (db) =>
      persistSeasonAwards(db, competitionId, organizer, now),
    );
    const before = await owner.db
      .select()
      .from(matchAwards)
      .where(eq(matchAwards.competitionId, competitionId));
    const filtered = await withTenantDb(app, { personId: organizer, orgId }, (db) =>
      seasonAwardComputation(db, competitionId, { ballType: "tennis", timeOfDay: "night" }),
    );
    expect(filtered?.matchCount).toBe(1);
    const accepted = await owner.db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.fixtureId, id))
      .orderBy(matchEvents.seq);
    const state = replayMatch(accepted.map(persistedMatchEvent));
    const points = scoreMatch(playerLines(state), state, "t10");
    for (const row of filtered?.players ?? []) {
      expect(row.teamMatches).toBe(1);
      expect(row.matches).toBe(1);
      expect(row.mvpEligible).toBe(true);
      expect(row.points).toBe(points.get(row.registrationId)?.points ?? 0);
    }
    const batting = filtered?.players.find((row) => row.registrationId === reg(0));
    expect(batting?.strikeRate).toMatchObject({ qualified: false, remaining: 59 });
    const excluded = await withTenantDb(app, { personId: organizer, orgId }, (db) =>
      seasonAwardComputation(db, competitionId, { ballType: "leather" }),
    );
    expect(excluded?.matchCount).toBe(0);
    expect(excluded?.players).toEqual([]);
    expect(
      await owner.db.select().from(matchAwards).where(eq(matchAwards.competitionId, competitionId)),
    ).toEqual(before);
  });
  it("stores an unregistered scorer override with explicit person identity and current trusted fixture count", async () => {
    const id = await setup();
    await ready(id);
    await append(id, [event("finish", {})]);
    await owner.db.update(matches).set({ trustLevel: "verified" }).where(eq(matches.fixtureId, id));
    expect(
      await owner.db.select().from(registrations).where(eq(registrations.personId, actor)),
    ).toEqual([]);
    const eligible = await withTenantDb(app, { personId: organizer, orgId }, (db) =>
      eligibleSeasonScorers(db, competitionId),
    );
    const scorer = eligible.find((row) => row.personId === actor);
    if (!scorer) throw new Error("Missing eligible unregistered scorer");
    const choose = (personId: string, actorId = organizer) =>
      withTenantDb(app, { personId: actorId, orgId }, (db) =>
        awards.overrideAward(
          db,
          {
            competitionId,
            kind: "scorer_of_season",
            personId,
            reason: "Reliable scoring",
            actorId,
          },
          now,
        ),
      );
    const chosen = await choose(actor);
    expect(chosen).toMatchObject({
      kind: "scorer_of_season",
      scope: "season",
      fixtureId: null,
      winnerPersonId: actor,
      computedPersonId: actor,
      winnerRegistrationId: null,
      computedRegistrationId: null,
      score: scorer.completedVerifiedMatches.toFixed(2),
      source: "organizer",
    });
    await withTenantDb(app, { personId: organizer, orgId }, async (db) => {
      await persistSeasonAwards(db, competitionId, organizer, now);
      expect((await awards.currentAward(db, { competitionId }, "scorer_of_season"))?.id).toBe(
        chosen.id,
      );
    });
    await expect(choose(organizer)).rejects.toThrow("eligible scoring participation");
    await expect(choose(actor, actor)).rejects.toThrow();
    await owner.db.update(matches).set({ trustLevel: "flagged" }).where(eq(matches.fixtureId, id));
    const reduced = await withTenantDb(app, { personId: organizer, orgId }, (db) =>
      eligibleSeasonScorers(db, competitionId),
    );
    expect(reduced.find((row) => row.personId === actor)?.completedVerifiedMatches ?? 0).toBe(
      scorer.completedVerifiedMatches - 1,
    );
    await owner.db.update(matches).set({ trustLevel: "verified" }).where(eq(matches.fixtureId, id));
    await expect(
      owner.db.insert(matchAwards).values({ ...chosen, id: newId(), winnerRegistrationId: reg(0) }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      owner.db.insert(matchAwards).values({ ...chosen, id: newId(), kind: "season_mvp" }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it("refuses scorer-only, foreign registration, wrong kind, empty reason and unfinished overrides", async () => {
    const id = await setup();
    const choose = (
      actorId: string,
      registrationId = reg(0),
      reason = "Reason",
      kind: Exclude<awards.AwardKind, "scorer_of_season"> = "player_of_match",
    ) =>
      withTenantDb(app, { personId: actorId, orgId }, (db) =>
        awards.overrideAward(db, { fixtureId: id, kind, registrationId, reason, actorId }),
      );
    await expect(choose(organizer)).rejects.toThrow("finalized");
    await ready(id);
    await append(id, [event("finish", {})]);
    await expect(choose(actor)).rejects.toThrow();
    await expect(choose(organizer, newId())).rejects.toThrow("participant");
    await expect(choose(organizer, reg(0), "  ")).rejects.toThrow("reason");
    await expect(choose(organizer, reg(0), "Reason", "season_mvp")).rejects.toThrow("kind");
    expect(
      (await owner.db.select().from(matchAwards).where(eq(matchAwards.fixtureId, id))).every(
        (row) => row.source === "auto",
      ),
    ).toBe(true);
  });
  it("permits a manual season pick with null computed context, ordered under the competition lock", async () => {
    const player = (index: number) => {
      const id = players[index];
      if (!id) throw new Error("Missing manual season person");
      return id;
    };
    const manualSeason = newId(),
      manualFirst = newId(),
      manualSecond = newId();
    const manualHome = newId(),
      manualAway = newId();
    await owner.db.insert(competitions).values({
      id: manualSeason,
      orgId,
      sport: "cricket",
      name: "Manual-only season",
      slug: `manual-${manualSeason}`,
      createdBy: organizer,
    });
    await owner.db.insert(teams).values([
      {
        id: manualHome,
        orgId,
        competitionId: manualSeason,
        name: "Manual home",
        createdBy: organizer,
      },
      {
        id: manualAway,
        orgId,
        competitionId: manualSeason,
        name: "Manual away",
        createdBy: organizer,
      },
    ]);
    await owner.db.insert(registrations).values([
      {
        id: manualFirst,
        orgId,
        competitionId: manualSeason,
        teamId: manualHome,
        personId: player(0),
        status: "approved",
        registrationNumber: "MANUAL-1",
      },
      {
        id: manualSecond,
        orgId,
        competitionId: manualSeason,
        teamId: manualAway,
        personId: player(11),
        status: "approved",
        registrationNumber: "MANUAL-2",
      },
    ]);
    const choose = (registrationId: string) =>
      withTenantDb(app, { personId: organizer, orgId }, (db) =>
        awards.overrideAward(
          db,
          {
            competitionId: manualSeason,
            kind: "season_mvp",
            registrationId,
            reason: "Season contribution",
            actorId: organizer,
          },
          now,
        ),
      );
    const first = await choose(manualFirst);
    const second = await choose(manualSecond);
    expect(first).toMatchObject({
      scope: "season",
      fixtureId: null,
      computedRegistrationId: null,
      score: null,
      source: "organizer",
    });
    expect(second.createdAt.getTime()).toBeGreaterThan(first.createdAt.getTime());
    await expect(choose(newId())).rejects.toThrow("season");
  });
  it("serializes simultaneous correction finalization and override without replacing the organiser selection", async () => {
    const id = await setup();
    const chase = await ready(id);
    await append(id, [event("finish", {})]);
    const amendment = event(
      "amend",
      {
        payload: {
          strikerId: reg(11),
          nonStrikerId: reg(12),
          bowlerId: reg(1),
          runsBat: 5,
          extras: {},
        },
      },
      chase.eventId,
    );
    const [correction, chosen] = await Promise.all([
      append(id, [amendment]),
      withTenantDb(app, { personId: organizer, orgId }, (db) =>
        awards.overrideAward(
          db,
          {
            fixtureId: id,
            kind: "player_of_match",
            registrationId: reg(0),
            reason: "Organiser choice",
            actorId: organizer,
          },
          now,
        ),
      ),
    ]);
    expect(correction.ok).toBe(true);
    expect(
      await withTenantDb(app, { personId: organizer, orgId }, (db) =>
        awards.currentAward(db, { fixtureId: id }, "player_of_match"),
      ),
    ).toEqual(chosen);
    expect(chosen.computedRegistrationId).toBe(reg(11));
    expect(
      (
        (
          await owner.db
            .select()
            .from(matchPlayerLines)
            .where(
              and(eq(matchPlayerLines.fixtureId, id), eq(matchPlayerLines.registrationId, reg(11))),
            )
        )[0]?.stats as PlayerLine
      ).batting?.runs,
    ).toBe(5);
  });
  it("allows tenant and own-registration reads but the person arm cannot write across tenants", async () => {
    const player = players[11];
    if (!player) throw new Error("Missing player");
    const id = await setup();
    await ready(id);
    await append(id, [event("finish", {})]);
    const tenant = await withTenantDb(app, { personId: actor, orgId }, (db) =>
      db.select().from(matchPlayerLines).where(eq(matchPlayerLines.fixtureId, id)),
    );
    expect(tenant).toHaveLength(22);
    const own = await withTenantDb(app, { personId: player }, (db) =>
      db.select().from(matchPlayerLines).where(eq(matchPlayerLines.fixtureId, id)),
    );
    expect(own.map((row) => row.registrationId)).toEqual([reg(11)]);
    expect(
      await withTenantDb(app, { personId: organizer }, (db) =>
        db.select().from(matchPlayerLines).where(eq(matchPlayerLines.fixtureId, id)),
      ),
    ).toEqual([]);
    const where = and(
      eq(matchPlayerLines.fixtureId, id),
      eq(matchPlayerLines.registrationId, reg(11)),
    );
    expect(
      await withTenantDb(app, { personId: player }, (db) =>
        db.update(matchPlayerLines).set({ points: "999.00" }).where(where).returning(),
      ),
    ).toEqual([]);
    expect(
      await withTenantDb(app, { personId: player }, (db) =>
        db.delete(matchPlayerLines).where(where).returning(),
      ),
    ).toEqual([]);
    const original = own[0];
    if (!original) throw new Error("Missing own line");
    await expect(
      withTenantDb(app, { personId: player }, (db) => db.insert(matchPlayerLines).values(original)),
    ).rejects.toThrow();
    await expect(
      withTenantDb(app, { personId: player, orgId: newId() }, (db) =>
        db.insert(matchPlayerLines).values(original),
      ),
    ).rejects.toThrow();
    expect(
      await withTenantDb(app, { personId: player, orgId: newId() }, (db) =>
        db.update(matchPlayerLines).set({ points: "999.00" }).where(where).returning(),
      ),
    ).toEqual([]);
    await withTenantDb(app, { personId: actor, orgId }, async (db) => {
      expect(
        await db.update(matchPlayerLines).set({ points: "123.00" }).where(where).returning(),
      ).toHaveLength(1);
      expect(await db.delete(matchPlayerLines).where(where).returning()).toHaveLength(1);
      expect(await db.insert(matchPlayerLines).values(original).returning()).toHaveLength(1);
    });
    expect(await owner.db.select().from(matchPlayerLines).where(where)).toEqual([original]);
    expect(
      (
        (
          await owner.db
            .select()
            .from(matchPlayerLines)
            .where(
              and(eq(matchPlayerLines.fixtureId, id), eq(matchPlayerLines.registrationId, reg(11))),
            )
        )[0]?.stats as PlayerLine
      ).batting?.runs,
    ).toBe(6);
  });
  it("rolls back already-written lines and awards if finalization fails after projection writes", async () => {
    const id = await setup();
    await ready(id);
    const finish = event("finish", {});
    const real = awards.persistFinalizedLinesAndAwards;
    const fault = vi
      .spyOn(awards, "persistFinalizedLinesAndAwards")
      .mockImplementationOnce(async (...args) => {
        await real(...args);
        throw new Error("After projection fault");
      });
    try {
      await expect(append(id, [finish])).rejects.toThrow("After projection fault");
    } finally {
      fault.mockRestore();
    }
    expect(
      await owner.db.select().from(matchPlayerLines).where(eq(matchPlayerLines.fixtureId, id)),
    ).toEqual([]);
    expect(await owner.db.select().from(matchAwards).where(eq(matchAwards.fixtureId, id))).toEqual(
      [],
    );
    expect(
      await owner.db.select().from(fixtureResults).where(eq(fixtureResults.fixtureId, id)),
    ).toEqual([]);
    expect(
      await owner.db
        .select()
        .from(matchEvents)
        .where(and(eq(matchEvents.fixtureId, id), eq(matchEvents.eventId, finish.eventId))),
    ).toEqual([]);
    expect((await append(id, [finish])).ok).toBe(true);
  });
  it("rejects unsupported frozen award versions atomically", async () => {
    const id = await setup();
    await ready(id);
    await owner.db
      .update(matches)
      .set({ awardVersion: "unknown/t10" })
      .where(eq(matches.fixtureId, id));
    await expect(append(id, [event("finish", {})])).rejects.toThrow("award configuration");
    expect(
      await owner.db.select().from(matchPlayerLines).where(eq(matchPlayerLines.fixtureId, id)),
    ).toEqual([]);
    expect(await owner.db.select().from(matchAwards).where(eq(matchAwards.fixtureId, id))).toEqual(
      [],
    );
  });

  it("accepts an effective replacement as an award candidate and retains the replaced appearance", async () => {
    const id = await setup();
    await ready(id, true);
    await append(id, [event("finish", {})]);
    const lines = await owner.db
      .select()
      .from(matchPlayerLines)
      .where(eq(matchPlayerLines.fixtureId, id));
    expect(lines.map((line) => line.registrationId)).toEqual(
      expect.arrayContaining([reg(11), reg(22)]),
    );
    const chosen = await withTenantDb(app, { personId: organizer, orgId }, (db) =>
      awards.overrideAward(
        db,
        {
          fixtureId: id,
          kind: "player_of_match",
          registrationId: reg(22),
          reason: "Replacement impact",
          actorId: organizer,
        },
        now,
      ),
    );
    expect(chosen).toMatchObject({
      winnerRegistrationId: reg(22),
      computedRegistrationId: reg(22),
    });
  });
  it("writes explicit null Fighter on no-result and preserves the picker's valid PoM", async () => {
    const id = await setup();
    const careerPerson = players[0];
    if (!careerPerson) throw new Error("Career no-result person fixture");
    const careerBefore = await cricketCareerFor(owner.db, { kind: "self", personId: careerPerson });

    expect(
      (
        await append(id, [
          event("toss", { winnerTeamId: home, decision: "bat" }),
          event("innings_started", {
            inningsNo: 1,
            battingTeamId: home,
            strikerId: reg(0),
            nonStrikerId: reg(1),
            bowlerId: reg(11),
          }),
          event("ball", {
            strikerId: reg(0),
            nonStrikerId: reg(1),
            bowlerId: reg(11),
            runsBat: 4,
            boundary: 4,
            extras: {},
          }),
        ])
      ).ok,
    ).toBe(true);
    // A prior automatic projection must be cleared, not hidden by omission.
    await owner.db.insert(matchAwards).values({
      id: newId(),
      fixtureId: id,
      orgId,
      competitionId,
      scope: "match",
      kind: "fighter_of_match",
      source: "auto",
      computedRegistrationId: reg(11),
      winnerRegistrationId: reg(11),
      score: "9.00",
      createdAt: now,
    });
    expect(
      (
        await append(id, [
          event("abandon", { kind: "no_result", reason: "Rain" }),
          event("finish", {}),
        ])
      ).ok,
    ).toBe(true);
    const fighter = await withTenantDb(app, { personId: actor, orgId }, (db) =>
      awards.currentAward(db, { fixtureId: id }, "fighter_of_match"),
    );
    expect(fighter).toMatchObject({
      source: "auto",
      computedRegistrationId: null,
      winnerRegistrationId: null,
      score: null,
    });
    expect(
      await owner.db
        .select()
        .from(matchAwards)
        .where(and(eq(matchAwards.fixtureId, id), eq(matchAwards.kind, "fighter_of_match"))),
    ).toHaveLength(2);
    expect(
      (
        await withTenantDb(app, { personId: actor, orgId }, (db) =>
          awards.currentAward(db, { fixtureId: id }, "player_of_match"),
        )
      )?.winnerRegistrationId,
    ).toBe(reg(0));
    const careerAfter = await cricketCareerFor(owner.db, { kind: "self", personId: careerPerson });
    expect(careerAfter.groups[0]?.runs).toBe((careerBefore.groups[0]?.runs ?? 0) + 4);
    expect(careerAfter.groups[0]?.matches).toBe((careerBefore.groups[0]?.matches ?? 0) + 1);
    expect(careerAfter.awards["player_of_match"]).toBe(
      (careerBefore.awards["player_of_match"] ?? 0) + 1,
    );
    const notices = await owner.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "match.award_won"));
    expect(
      notices.some((row) => row.subject?.startsWith(`match.award:${id}:fighter_of_match:`)),
    ).toBe(false);
  });
  it("does not append unchanged automatic picks on genuine re-finalization", async () => {
    const id = await setup();
    const chase = await ready(id);
    await append(id, [event("finish", {})]);
    const before = await owner.db.select().from(matchAwards).where(eq(matchAwards.fixtureId, id));
    const amendment = event(
      "amend",
      {
        payload: {
          strikerId: reg(11),
          nonStrikerId: reg(12),
          bowlerId: reg(1),
          runsBat: 6,
          boundary: 6,
          extras: {},
          zoneId: "cover",
          zoneSource: "manual",
        },
      },
      chase.eventId,
    );
    expect((await append(id, [amendment])).ok).toBe(true);
    expect(await owner.db.select().from(matchAwards).where(eq(matchAwards.fixtureId, id))).toEqual(
      before,
    );
  });
  it("every runtime role is denied rewriting or deleting award evidence", async () => {
    const id = await setup();
    await ready(id);
    await append(id, [event("finish", {})]);
    for (const [role, password] of [
      ["app", "ci-app"],
      ["system", "ci-system"],
      ["engine", "ci-engine"],
      ["runner", "ci-runner"],
    ] as const) {
      const url = new URL(env.DATABASE_URL);
      url.username = `desiauction_${role}`;
      url.password = password;
      const handle = createDb(url.href, { max: 1 });
      try {
        await expect(
          handle.sql`update match_awards set reason='rewrite' where fixture_id=${id}`,
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          handle.sql`delete from match_awards where fixture_id=${id}`,
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await handle.sql.end();
      }
    }
    expect(
      await owner.db.select().from(matchAwards).where(eq(matchAwards.fixtureId, id)),
    ).toHaveLength(2);
  });

  it("runs the dedicated runtime RLS proof once with finalized lines, with and without a membership sample", async () => {
    if (!env.APP_DATABASE_URL) throw new Error("C35 requires the app-role proof");
    const id = await setup();
    await ready(id);
    await append(id, [event("finish", {})]);
    const runProof = async () => {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          "--env-file-if-exists=../../.env.local",
          "node_modules/tsx/dist/cli.mjs",
          "scripts/verify-rls.ts",
        ],
        {
          env: {
            NODE_ENV: env.NODE_ENV,
            DATABASE_URL: env.DATABASE_URL,
            APP_DATABASE_URL: env.APP_DATABASE_URL,
          },
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        },
      );
      return stdout;
    };
    const assertLinesProof = (stdout: string) => {
      for (const message of [
        "match_player_lines: tenant and person-only reads match their exact owner counts",
        "match_player_lines: unrelated person sees zero rows",
        "match_player_lines: person-only UPDATE and DELETE affect zero rows",
      ]) {
        expect(stdout.split(message)).toHaveLength(2);
      }
      expect(stdout).toContain("RLS VERIFICATION PASSED");
    };
    const [membershipSample] = await owner.db.select().from(orgMembers).limit(1);
    const withoutFixtureMembership = await runProof();
    assertLinesProof(withoutFixtureMembership);
    if (!membershipSample) {
      expect(withoutFixtureMembership).toContain(
        "no organization membership sample — membership-based proof skipped",
      );
    }
    await owner.db.insert(orgMembers).values({ orgId, personId: actor });
    try {
      const withMembership = await runProof();
      expect(withMembership).toContain("load-bearing proof (org");
      assertLinesProof(withMembership);
    } finally {
      await owner.db
        .delete(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.personId, actor)));
    }
  });

  it("dispatches result and award notices once, changes winners, and resolves private links only for the recipient", async () => {
    const id = await setup();
    await ready(id);
    await append(id, [event("finish", {})]);
    const boundaries = reminderBoundariesFor(app);
    const notices = () =>
      owner.db
        .select()
        .from(auditLog)
        .where(
          and(
            inArray(auditLog.action, ["match.result_published", "match.award_won"]),
            inArray(auditLog.scopeId, players),
          ),
        );
    const initial = (await notices()).filter(
      (row) => (row.meta as { fixtureId?: string }).fixtureId === id,
    );
    expect(initial.filter((row) => row.action === "match.result_published")).toHaveLength(22);
    expect(initial.filter((row) => row.action === "match.award_won")).toHaveLength(2);
    expect(await dispatchResultNotices(orgId, id, boundaries)).toBe(0);
    const notice = initial.find(
      (row) => row.action === "match.award_won" && row.subject?.includes("player_of_match"),
    );
    if (!notice) throw new Error("Missing award notice");
    expect(await resolveMatchNoticeLink(notice.scopeId, notice.id, boundaries)).toMatch(/^\/m\//);
    expect(await resolveMatchNoticeLink(organizer, notice.id, boundaries)).toBeNull();
    const messages = await owner.db
      .select()
      .from(messageOutbox)
      .where(and(eq(messageOutbox.orgId, orgId), eq(messageOutbox.personId, notice.scopeId)));
    expect(
      messages
        .filter((row) => row.dedupeKey.includes(id))
        .every((row) => !row.bodyText.includes("/m/") && row.bodyText.includes("matchNotice=")),
    ).toBe(true);
    await awards.overrideAwardRequest(
      app,
      { personId: organizer, orgId },
      {
        fixtureId: id,
        kind: "player_of_match",
        registrationId: reg(12),
        reason: "Team contribution",
      },
    );
    const revised = (await notices()).filter(
      (row) => (row.meta as { fixtureId?: string }).fixtureId === id,
    );
    expect(revised.filter((row) => row.action === "match.award_won")).toHaveLength(3);
    expect(await resolveMatchNoticeLink(notice.scopeId, notice.id, boundaries)).toBeNull();
    expect(await dispatchResultNotices(orgId, id, boundaries)).toBe(0);
    await owner.db.update(matches).set({ phase: "void" }).where(eq(matches.fixtureId, id));
    const current = revised.find((row) =>
      row.subject?.includes(`player_of_match:${players[12] ?? ""}`),
    );
    if (!current) throw new Error("Missing replacement notice");
    expect(await resolveMatchNoticeLink(current.scopeId, current.id, boundaries)).toBeNull();
  });

  it("keeps a minor award winner initial-only with no face in public details and organizer exports", async () => {
    const id = await setup();
    const [before] = await owner.db
      .select()
      .from(registrations)
      .where(eq(registrations.id, reg(11)));
    if (!before) throw new Error("Missing winner");
    try {
      await owner.db
        .update(registrations)
        .set({
          dateOfBirth: "2015-01-01",
          enteredPhotoKey: "private-face.png",
          enteredPhotoConsentAt: now,
        })
        .where(eq(registrations.id, reg(11)));
      await ready(id);
      await append(id, [event("finish", {})]);
      const [match] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
      if (!match) throw new Error("Missing match");
      const publicResult = await publicLiveResult(
        id,
        { t: match.shareToken },
        new Date(now.getTime() + 60000),
        owner.db,
      );
      const winner = publicResult?.resultDetails?.awards.find(
        (award) => award.kind === "player_of_match",
      );
      expect(winner).toBeDefined();
      expect(winner?.name).not.toBe(before.enteredName);
      expect(winner?.name).toBe(winner?.initials);
      expect(winner?.photoUrl).toBeNull();
      await owner.db
        .insert(orgMembers)
        .values({ orgId, personId: organizer })
        .onConflictDoNothing();
      const poster = await resultPosterFor(organizer, slug, id, {
        theme: "stadium",
        size: "portrait",
        kind: "result",
      });
      expect(poster.ok).toBe(true);
      if (!poster.ok) throw new Error("Result export refused");
      expect(poster.input.playerOfMatch?.name).toBe(winner?.name);
      expect(poster.input.playerOfMatch?.photoUrl).toBeNull();
      expect(poster.shareUrl).toBeNull();
    } finally {
      await owner.db
        .update(registrations)
        .set({
          dateOfBirth: before.dateOfBirth,
          enteredPhotoKey: before.enteredPhotoKey,
          enteredPhotoConsentAt: before.enteredPhotoConsentAt,
        })
        .where(eq(registrations.id, reg(11)));
    }
  });
  it("recovers committed finalization when request dispatch was missed", async () => {
    const id = await setup();
    await ready(id);
    await withTenantDb(app, { personId: actor, orgId }, (db) =>
      import("./append").then(({ appendScoringEvents }) =>
        appendScoringEvents(db, id, actor, {
          deviceId,
          attempt: 1,
          events: [event("finish", {})],
        }),
      ),
    );
    const before = await owner.db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "match.result_published"), inArray(auditLog.scopeId, players)),
      );
    expect(
      before.filter((row) => (row.meta as { fixtureId?: string }).fixtureId === id),
    ).toHaveLength(0);
    await recoverResultNotices(owner.db, reminderBoundariesFor(app), [id]);
    const after = await owner.db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "match.result_published"), inArray(auditLog.scopeId, players)),
      );
    expect(
      after.filter((row) => (row.meta as { fixtureId?: string }).fixtureId === id),
    ).toHaveLength(22);
    expect(await dispatchResultNotices(orgId, id, reminderBoundariesFor(app))).toBe(0);
  });

  it.each([
    "sent",
    "no_mapping",
    "opt_out",
    "unconfigured",
    "platform_off",
    "transient",
    "unknown",
    "obsolete",
    "void",
  ] as const)("award WhatsApp-only delivery: %s never uses SMS", async (mode) => {
    const id = await setup();
    await ready(id);
    const winner = players[11];
    if (!winner) throw new Error("Missing award player");
    await owner.db.update(people).set({ phone: "+919876500321" }).where(eq(people.id, winner));
    await setWhatsappOptIn(owner.db, { personId: winner, granted: true, source: "account" });
    const [channelBefore] = await owner.db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.channel, "whatsapp"));
    try {
      await append(id, [event("finish", {})]);
      const key = `whatsapp:match.award:${id}:player_of_match:${winner}`;
      const [queued] = await owner.db
        .select()
        .from(messageOutbox)
        .where(eq(messageOutbox.dedupeKey, key));
      if (!queued) throw new Error("Award WhatsApp not queued");
      if (mode === "opt_out") {
        await new Promise((resolve) => setTimeout(resolve, 5));
        await setWhatsappOptIn(owner.db, { personId: winner, granted: false, source: "account" });
      }
      if (mode === "obsolete")
        await awards.overrideAwardRequest(
          app,
          { personId: organizer, orgId },
          {
            fixtureId: id,
            kind: "player_of_match",
            registrationId: reg(12),
            reason: "Changed winner",
          },
        );
      if (mode === "void")
        await owner.db.update(matches).set({ phase: "void" }).where(eq(matches.fixtureId, id));
      if (mode === "platform_off") {
        await owner.db
          .insert(notificationChannels)
          .values({ channel: "whatsapp", enabled: false })
          .onConflictDoUpdate({ target: notificationChannels.channel, set: { enabled: false } });
        invalidatePlatformSwitches();
      }
      const smsSend = vi.fn().mockResolvedValue(undefined);
      const sms: PlayerSmsSender = { send: smsSend };
      const whatsappSend = vi.fn(() => {
        if (mode === "transient")
          throw new WhatsAppSendError("Temporary outage", false, "unavailable");
        if (mode === "unknown") throw new WhatsAppSendError("Timed out", true);
        return Promise.resolve({ messageId: "wamid.test" });
      });
      const whatsapp: PersonalWhatsAppSender = { send: whatsappSend };
      const now = new Date();
      now.setUTCHours(7, 0, 0, 0);
      await owner.db
        .update(messageOutbox)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(messageOutbox.id, queued.id));
      await drainOutbox({
        db: owner.db,
        sms,
        whatsapp: mode === "unconfigured" ? null : whatsapp,
        whatsappTemplate: () => (mode === "no_mapping" ? undefined : "da_match_award"),
        now,
        dedupeKeys: [key],
      });
      expect(smsSend).not.toHaveBeenCalled();
      const [row] = await owner.db
        .select()
        .from(messageOutbox)
        .where(eq(messageOutbox.id, queued.id));
      expect(row?.status).toBe(
        mode === "sent"
          ? "sent"
          : mode === "transient"
            ? "pending"
            : mode === "unknown"
              ? "failed"
              : "suppressed",
      );
      if (mode === "sent") {
        await drainOutbox({
          db: owner.db,
          sms,
          whatsapp,
          whatsappTemplate: () => "da_match_award",
          now,
          dedupeKeys: [key],
        });
        expect(whatsappSend).toHaveBeenCalledTimes(1);
      }
      if (mode === "unknown") expect(row?.lastError).toContain("delivery unknown");
    } finally {
      if (mode === "platform_off") {
        if (channelBefore)
          await owner.db
            .update(notificationChannels)
            .set(channelBefore)
            .where(eq(notificationChannels.channel, "whatsapp"));
        else
          await owner.db
            .delete(notificationChannels)
            .where(eq(notificationChannels.channel, "whatsapp"));
        invalidatePlatformSwitches();
      }

      await owner.db.update(people).set({ phone: null }).where(eq(people.id, winner));
      await owner.db.delete(consentRecords).where(eq(consentRecords.personId, winner));
    }
  });
  it("C37 careers enforce current trust, delayed corrections, published same-club audience and void exclusion", async () => {
    await owner.db
      .update(competitions)
      .set({ visibility: "public" })
      .where(eq(competitions.id, competitionId));
    const id = await setup();
    await ready(id);
    await append(id, [event("finish", {})]);
    await owner.db
      .update(matches)
      .set({ finishedAt: new Date(now.getTime() + 1000), trustLevel: "self_scored" })
      .where(eq(matches.fixtureId, id));
    await owner.db.update(fixtures).set({ publishedAt: now }).where(eq(fixtures.id, id));
    const personId = players[0];
    if (!personId) throw new Error("Career person fixture");
    const scope = { kind: "public" as const, personId: personId, orgId };
    const find = async (at: Date) =>
      (await cricketCareerFor(owner.db, scope, at)).recent.find((row) => row.fixtureId === id);
    const [snapshot] = await owner.db
      .select()
      .from(matchLiveState)
      .where(eq(matchLiveState.fixtureId, id));
    if (!snapshot) throw new Error("Career snapshot fixture");
    const before = new Date(snapshot.updatedAt.getTime() + 59999);
    const cutoff = new Date(snapshot.updatedAt.getTime() + 60000);
    expect(await find(before)).toBeUndefined();
    expect(await find(cutoff)).toMatchObject({ trust: "self_scored", opponent: "Away" });
    expect(
      (await cricketCareerFor(owner.db, { kind: "self", personId: personId }, before)).recent.some(
        (row) => row.fixtureId === id,
      ),
    ).toBe(true);
    expect((await cricketCareerFor(owner.db, { ...scope, orgId: newId() }, cutoff)).recent).toEqual(
      [],
    );
    expect(
      (await cricketCareerFor(owner.db, { kind: "self", personId: newId() }, cutoff)).groups[0]
        ?.matches,
    ).toBe(0);
    await owner.db
      .update(matchLiveState)
      .set({ updatedAt: cutoff })
      .where(eq(matchLiveState.fixtureId, id));
    expect(await find(cutoff)).toBeUndefined();
    expect(await find(new Date(cutoff.getTime() + 60000))).toBeDefined();
    await owner.db.update(matches).set({ trustLevel: "verified" }).where(eq(matches.fixtureId, id));
    expect(await find(cutoff)).toMatchObject({ trust: "verified" });
    await owner.db
      .update(competitions)
      .set({ visibility: "private" })
      .where(eq(competitions.id, competitionId));
    try {
      expect(await find(cutoff)).toBeUndefined();
    } finally {
      await owner.db
        .update(competitions)
        .set({ visibility: "public" })
        .where(eq(competitions.id, competitionId));
    }
    await owner.db.update(matches).set({ phase: "void" }).where(eq(matches.fixtureId, id));
    expect(await find(cutoff)).toBeUndefined();
    expect(
      (await cricketCareerFor(owner.db, { kind: "self", personId: personId }, cutoff)).recent.some(
        (row) => row.fixtureId === id,
      ),
    ).toBe(false);
  });
});

for (const branch of ["new_phone", "existing_account"] as const) {
  it(`C39 ${branch} claim keeps canonical events and finalized lines while career ownership follows the registration`, async () => {
    const guestId = players[0];
    if (!guestId) throw new Error("Missing guest person");
    const [original] = await owner.db.select().from(people).where(eq(people.id, guestId));
    if (!original) throw new Error("Missing original person");
    const phone = `+9183${String(Date.now()).slice(-7)}${branch === "new_phone" ? "4" : "5"}`;
    const holder = branch === "existing_account" ? newId() : guestId;
    if (holder !== guestId) {
      claimPeople.push(holder);
      await owner.db.insert(people).values({
        id: holder,
        phone,
        email: `claim-${holder}@example.test`,
        name: "Existing account owner",
      });
    }
    await owner.db
      .update(people)
      .set({ name: "Guest Player", email: null, phone: null, clubOrgId: orgId })
      .where(eq(people.id, guestId));
    await owner.db.insert(auditLog).values({
      id: newId(),
      actor,
      action: "registration.added",
      scopeType: "org",
      scopeId: orgId,
      subject: reg(0),
      meta: { competitionId, source: "scorer_guest", clubOnly: "true" },
    });
    try {
      const id = await setup();
      await ready(id);
      await append(id, [event("finish", {})]);
      const eventsBefore = await owner.db
        .select()
        .from(matchEvents)
        .where(eq(matchEvents.fixtureId, id))
        .orderBy(matchEvents.seq);
      const linesBefore = await owner.db
        .select()
        .from(matchPlayerLines)
        .where(eq(matchPlayerLines.fixtureId, id))
        .orderBy(matchPlayerLines.registrationId);
      const factsBefore = await owner.db
        .select()
        .from(ballFacts)
        .where(eq(ballFacts.fixtureId, id))
        .orderBy(ballFacts.seq);
      expect(factsBefore.some((row) => row.batterId === reg(0))).toBe(true);
      const ownFacts = (personId: string) =>
        withTenantDb(app, { personId }, (db) =>
          db
            .select()
            .from(ballFacts)
            .where(and(eq(ballFacts.fixtureId, id), eq(ballFacts.batterId, reg(0)))),
        );
      expect(await ownFacts(guestId)).not.toHaveLength(0);
      expect(linesBefore.find((row) => row.registrationId === reg(0))?.stats).toMatchObject({
        batting: { runs: 4 },
      });
      expect(
        (await cricketCareerFor(owner.db, { kind: "self", personId: guestId })).recent.some(
          (row) => row.fixtureId === id,
        ),
      ).toBe(true);
      if (branch === "new_phone") {
        const attemptClaim = (personId: string, tenant: string, mobile: string) =>
          withTenantDb(app, { personId, orgId: tenant }, (db) =>
            claimScoringGuest(db, id, personId, { registrationId: reg(0), phone: mobile }),
          );
        expect(await attemptClaim(players[1] ?? "", orgId, phone)).toMatchObject({
          ok: false,
          error: "forbidden",
        });
        expect(await attemptClaim(actor, newId(), phone)).toMatchObject({
          ok: false,
          error: "not_found",
        });
        expect(await attemptClaim(actor, orgId, "9999999999")).toMatchObject({
          ok: false,
          error: "bad_phone",
        });
        const thirdTeam = newId();
        await owner.db
          .insert(teams)
          .values({ id: thirdTeam, orgId, competitionId, name: "Not playing", createdBy: actor });
        await owner.db
          .update(registrations)
          .set({ teamId: thirdTeam })
          .where(eq(registrations.id, reg(0)));
        expect(await attemptClaim(actor, orgId, phone)).toMatchObject({
          ok: false,
          error: "not_guest",
        });
        await owner.db
          .update(registrations)
          .set({ teamId: home })
          .where(eq(registrations.id, reg(0)));
        const alreadyPerson = players[22];
        if (!alreadyPerson) throw new Error("Missing existing player");
        const [beforePhone] = await owner.db
          .select()
          .from(people)
          .where(eq(people.id, alreadyPerson));
        if (!beforePhone) throw new Error("Missing existing player phone");
        const existingPhone = `+9184${String(Date.now()).slice(-7)}8`;
        try {
          await owner.db
            .update(people)
            .set({ phone: existingPhone })
            .where(eq(people.id, alreadyPerson));
          expect(await attemptClaim(actor, orgId, existingPhone)).toMatchObject({
            ok: false,
            error: "already_in_season",
          });
          expect(
            (
              await owner.db
                .select()
                .from(registrations)
                .where(eq(registrations.id, reg(0)))
            )[0]?.personId,
          ).toBe(guestId);
        } finally {
          await owner.db
            .update(people)
            .set({ phone: beforePhone.phone })
            .where(eq(people.id, alreadyPerson));
        }
      }
      const claimed = await withTenantDb(app, { personId: actor, orgId }, (db) =>
        claimScoringGuest(db, id, actor, { registrationId: reg(0), phone: phone.slice(3) }),
      );
      expect(claimed).toEqual({ ok: true, registrationId: reg(0) });
      // Recover a committed claim even when its request never dispatched notices.
      await recoverGuestClaimInvites(owner.db, reminderBoundariesFor(app), [id]);
      await recoverableGuestClaimDispatch(orgId, reg(0), reminderBoundariesFor(app));
      const [registration] = await owner.db
        .select()
        .from(registrations)
        .where(eq(registrations.id, reg(0)));
      expect(registration?.personId).toBe(holder);
      expect(
        await owner.db
          .select()
          .from(matchEvents)
          .where(eq(matchEvents.fixtureId, id))
          .orderBy(matchEvents.seq),
      ).toEqual(eventsBefore);
      expect(
        await owner.db
          .select()
          .from(matchPlayerLines)
          .where(eq(matchPlayerLines.fixtureId, id))
          .orderBy(matchPlayerLines.registrationId),
      ).toEqual(linesBefore);
      expect(
        await owner.db
          .select()
          .from(ballFacts)
          .where(eq(ballFacts.fixtureId, id))
          .orderBy(ballFacts.seq),
      ).toEqual(factsBefore);
      expect(await ownFacts(holder)).not.toHaveLength(0);
      if (holder !== guestId) expect(await ownFacts(guestId)).toHaveLength(0);
      expect(await ownFacts(organizer)).toHaveLength(0);
      expect(
        (await cricketCareerFor(owner.db, { kind: "self", personId: holder })).recent.find(
          (row) => row.fixtureId === id,
        )?.batting?.runs,
      ).toBe(4);
      if (holder !== guestId)
        expect(
          (await cricketCareerFor(owner.db, { kind: "self", personId: guestId })).recent.some(
            (row) => row.fixtureId === id,
          ),
        ).toBe(false);
      const notices = await owner.db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.scopeType, "person"),
            eq(auditLog.scopeId, holder),
            eq(auditLog.action, "player.claim_invited"),
          ),
        );
      expect(
        notices.filter((row) => row.subject === `player.claim_invite:${reg(0)}:${holder}`),
      ).toHaveLength(1);
      expect(JSON.stringify(notices)).not.toContain(phone);
      const audit = await owner.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.subject, reg(0)), eq(auditLog.action, "registration.phone_added")));
      expect(audit.at(-1)?.meta).toMatchObject({ source: "scorer_guest_claim" });
      expect(
        await withTenantDb(app, { personId: actor, orgId }, (db) =>
          claimScoringGuest(db, id, actor, { registrationId: reg(0), phone }),
        ),
      ).toMatchObject({ ok: false, error: "not_guest" });
    } finally {
      await owner.db.insert(people).values(original).onConflictDoNothing();
      await owner.db
        .update(registrations)
        .set({ personId: guestId })
        .where(eq(registrations.id, reg(0)));
      await owner.db.update(people).set(original).where(eq(people.id, guestId));
      await owner.db
        .delete(messageOutbox)
        .where(and(eq(messageOutbox.orgId, orgId), eq(messageOutbox.kind, "player.claim_invite")));
    }
  });
}
it("C39 public careers withhold historical minor performances while self careers retain them", async () => {
  const personId = players[0];
  if (!personId) throw new Error("Missing player");
  const [original] = await owner.db
    .select()
    .from(registrations)
    .where(eq(registrations.id, reg(0)));
  if (!original) throw new Error("Missing registration");
  const id = await setup();
  await ready(id);
  await append(id, [event("finish", {})]);
  await owner.db.update(fixtures).set({ publishedAt: now }).where(eq(fixtures.id, id));
  await owner.db.update(matches).set({ trustLevel: "verified" }).where(eq(matches.fixtureId, id));
  try {
    await owner.db
      .update(registrations)
      .set({ dateOfBirth: "2008-10-10" })
      .where(eq(registrations.id, reg(0)));
    expect(
      (
        await cricketCareerFor(
          owner.db,
          { kind: "public", personId, orgId },
          new Date("2026-10-11T12:00:00Z"),
        )
      ).recent.some((row) => row.fixtureId === id),
    ).toBe(false);
    expect(
      (await cricketCareerFor(owner.db, { kind: "self", personId })).recent.some(
        (row) => row.fixtureId === id,
      ),
    ).toBe(true);
    await owner.db
      .update(registrations)
      .set({ dateOfBirth: "2008-10-09" })
      .where(eq(registrations.id, reg(0)));
    expect(
      (await cricketCareerFor(owner.db, { kind: "public", personId, orgId })).recent.some(
        (row) => row.fixtureId === id,
      ),
    ).toBe(true);
  } finally {
    await owner.db
      .update(registrations)
      .set({ dateOfBirth: original.dateOfBirth })
      .where(eq(registrations.id, reg(0)));
  }
});
