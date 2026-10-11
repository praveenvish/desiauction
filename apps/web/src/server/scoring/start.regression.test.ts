import { resumeScoring } from "./claim";
import {
  auditLog,
  auctions,
  auctionOwnerInvites,
  teamManagers,
  competitions,
  createDb,
  fixtureLineups,
  fixtureResults,
  ballFacts,
  matchAwards,
  matchPlayerLines,
  matchLiveState,
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
import { replayMatch, rallyEngine, type MatchEvent } from "@desiauction/core/scoring";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../../env";
import { purgeOrg } from "../test-support/purge-org";
import { startScoredMatch, type StartScoredMatchInput } from "./start";
import { appendScoringEvents, persistedMatchEvent, type ClientEvent } from "./append";
import { noticeParticipants } from "./notice-participants";
import { overrideAward } from "./awards";
import { scoringShareToken } from "./share-token";

const owner = createDb(env.DATABASE_URL);
const app = env.APP_DATABASE_URL ? createDb(env.APP_DATABASE_URL) : owner;
const actor = newId();
const other = newId();
const stranger = newId();
const playerIds = Array.from({ length: 5 }, () => newId());
const registrationIds = playerIds.map(() => newId());
function registrationAt(index: number): string {
  const id = registrationIds[index];
  if (!id) throw new Error("Missing seeded registration");
  return id;
}
const orgId = newId();
const competitionId = newId();
const homeTeamId = newId();
const awayTeamId = newId();
const input: StartScoredMatchInput = {
  deviceId: "score-device",
  formatKey: "t20",
  conditions: { timeOfDay: "day" },
  lineups: [
    {
      teamId: homeTeamId,
      battingOrder: registrationIds.slice(0, 2),
      captainId: registrationAt(0),
      keeperId: registrationAt(1),
      substitutes: [],
    },
    {
      teamId: awayTeamId,
      battingOrder: registrationIds.slice(2, 4),
      captainId: registrationAt(2),
      keeperId: registrationAt(3),
      substitutes: [],
    },
  ],
};
let sequence = 0;
async function fixture(status: "draft" | "scheduled" | "published" = "published") {
  const id = newId();
  sequence += 1;
  await owner.db.insert(fixtures).values({
    id,
    orgId,
    competitionId,
    homeTeamId,
    awayTeamId,
    fixtureNumber: `START-${String(sequence)}`,
    seq: sequence,
    status,
    createdBy: actor,
  });
  return id;
}
function start(id: string, personId = actor, setup = input) {
  return withTenantDb(app, { personId, orgId }, (db) => startScoredMatch(db, id, personId, setup));
}
beforeAll(async () => {
  await owner.db.insert(people).values(
    [actor, other, stranger, ...playerIds].map((id) => ({
      id,
      name: "Start match person",
      email: `start-${id}@example.test`,
    })),
  );
  await owner.db
    .insert(organizations)
    .values({ id: orgId, name: "Start club", slug: `start-${orgId}`, createdBy: actor });
  await owner.db.insert(competitions).values({
    id: competitionId,
    orgId,
    sport: "cricket",
    name: "Start cup",
    slug: `start-${competitionId}`,
    createdBy: actor,
  });
  await owner.db.insert(teams).values(
    [homeTeamId, awayTeamId].map((id, index) => ({
      id,
      orgId,
      competitionId,
      name: `Side ${String(index)}`,
      createdBy: actor,
    })),
  );
  await owner.db.insert(grants).values(
    [actor, other].map((personId) => ({
      id: newId(),
      personId,
      scopeType: "tournament" as const,
      scopeId: competitionId,
      capabilitySet: "fixture:scorer",
      grantedBy: actor,
    })),
  );
  await owner.db.insert(registrations).values(
    playerIds.map((personId, index) => ({
      id: registrationAt(index),
      personId,
      orgId,
      competitionId,
      teamId: index < 2 || index === 4 ? homeTeamId : awayTeamId,
      registrationNumber: `START-R${String(index)}`,
      status: index === 4 ? ("submitted" as const) : ("approved" as const),
    })),
  );
});
afterAll(async () => {
  await purgeOrg(owner.db, orgId);
  for (const id of [actor, other, stranger, ...playerIds])
    await owner.db.delete(people).where(eq(people.id, id));
  if (app !== owner) await app.sql.end();
  await owner.sql.end();
});

describe("API-2 start a scored match", () => {
  it("creates the claimed match, first three events, lineups, fixture transition and audit", async () => {
    const id = await fixture();
    expect(await start(id)).toMatchObject({
      ok: true,
      fixtureId: id,
      lastSeq: 3,
      attempt: 1,
      phase: "not_started",
    });
    const [match] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
    expect(match).toMatchObject({
      scorerPersonId: actor,
      scorerDeviceId: input.deviceId,
      awardVersion: "cricket-v1/t20",
      lastSeq: 3,
    });
    expect(match?.shareToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(
      (
        await owner.db
          .select()
          .from(matchEvents)
          .where(eq(matchEvents.fixtureId, id))
          .orderBy(matchEvents.seq)
      ).map((row) => [row.seq, row.type]),
    ).toEqual([
      [1, "match_started"],
      [2, "lineup_confirmed"],
      [3, "lineup_confirmed"],
    ]);
    expect(
      await owner.db.select().from(fixtureLineups).where(eq(fixtureLineups.fixtureId, id)),
    ).toHaveLength(4);
    expect((await owner.db.select().from(fixtures).where(eq(fixtures.id, id)))[0]?.status).toBe(
      "in_progress",
    );
    expect(
      (await owner.db.select().from(auditLog).where(eq(auditLog.subject, id))).some(
        (row) => row.action === "match.started",
      ),
    ).toBe(true);
  });
  it("refuses a non-approved registration without partial match writes", async () => {
    const id = await fixture();
    const setup = structuredClone(input);
    setup.lineups[0].battingOrder[1] = registrationAt(4);
    setup.lineups[0].keeperId = registrationAt(4);
    expect(await start(id, actor, setup)).toMatchObject({ ok: false, error: "bad_payload" });
    expect(await owner.db.select().from(matches).where(eq(matches.fixtureId, id))).toHaveLength(0);
    expect(
      await owner.db.select().from(matchEvents).where(eq(matchEvents.fixtureId, id)),
    ).toHaveLength(0);
  });
  it("refuses draft and scheduled fixtures with the publish instruction", async () => {
    for (const status of ["draft", "scheduled"] as const)
      expect(await start(await fixture(status))).toEqual({
        ok: false,
        error: "bad_payload",
        message: "Publish the match first",
      });
  });
  it("serializes same-device starts and preserves the first claim on same-person retry", async () => {
    const id = await fixture();
    const results = await Promise.all([start(id), start(id)]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await start(id, actor, { ...input, deviceId: "other-device" })).toMatchObject({
      ok: true,
      lastSeq: 3,
    });
    expect(
      await owner.db.select().from(matchEvents).where(eq(matchEvents.fixtureId, id)),
    ).toHaveLength(3);
    expect(
      (await owner.db.select().from(matches).where(eq(matches.fixtureId, id)))[0]?.scorerDeviceId,
    ).toBe(input.deviceId);
    expect(await start(id, other)).toEqual({
      ok: false,
      error: "forbidden",
      message: "Another scorer holds this match.",
    });
  });
  it("refuses unknown fixtures, unauthorized callers and malformed setup", async () => {
    expect(await start(newId())).toMatchObject({ ok: false, error: "not_found" });
    const id = await fixture();
    expect(await start(id, stranger)).toMatchObject({ ok: false, error: "forbidden" });
    expect(
      await start(id, actor, {
        ...input,
        conditions: { pitch: "unknown" },
      } as unknown as StartScoredMatchInput),
    ).toMatchObject({ ok: false, error: "bad_payload" });
    expect(await start(id, actor, { ...input, formatKey: "unknown" })).toMatchObject({
      ok: false,
      error: "bad_payload",
    });
  });
  it("lazily provisions an accepted auction owner before checking scoring authority", async () => {
    const auctionId = newId();
    await owner.db.insert(auctions).values({
      id: auctionId,
      orgId,
      competitionId,
      name: "Completed auction",
      status: "completed",
      config: {},
      createdBy: actor,
    });
    await owner.db.insert(auctionOwnerInvites).values({
      id: newId(),
      orgId,
      auctionId,
      teamId: homeTeamId,
      tokenHash: newId(),
      createdBy: actor,
      expiresAt: new Date(),
      acceptedBy: stranger,
      acceptedAt: new Date(),
    });
    expect(await start(await fixture(), stranger)).toMatchObject({ ok: true, lastSeq: 3 });
    expect(
      (await owner.db.select().from(teamManagers).where(eq(teamManagers.personId, stranger)))[0],
    ).toMatchObject({ source: "auction_owner", teamId: homeTeamId });
  });
  it("accepts the two sides in either input order", async () => {
    expect(
      await start(await fixture(), actor, {
        ...input,
        lineups: [input.lineups[1], input.lineups[0]],
      }),
    ).toMatchObject({ ok: true });
  });
  it("freezes known and partial profiles including substitutes, preserves unknowns and retry history", async () => {
    await owner.db
      .update(registrations)
      .set({ battingStyle: "Left Hand Opener", bowlingStyle: "Right Arm Medium" })
      .where(eq(registrations.id, registrationAt(0)));
    await owner.db
      .update(registrations)
      .set({ battingStyle: "unrecognized", bowlingStyle: "Left Arm Medium" })
      .where(eq(registrations.id, registrationAt(1)));
    await owner.db
      .update(registrations)
      .set({ status: "approved", battingStyle: "right_hand" })
      .where(eq(registrations.id, registrationAt(4)));
    const setup = structuredClone(input);
    setup.lineups[0].substitutes = [registrationAt(4)];
    const id = await fixture();
    expect(await start(id, actor, setup)).toMatchObject({ ok: true, lastSeq: 6 });
    const rows = await owner.db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.fixtureId, id))
      .orderBy(matchEvents.seq);
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows.map((row) => row.clientSeq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(rows.map((row) => row.eventId)).size).toBe(6);
    expect(rows.every((row) => row.actorPersonId === actor)).toBe(true);
    const seed = rows.filter((row) => row.type === "style_set");
    expect(seed.map((row) => (row.payload as { registrationId: string }).registrationId)).toEqual(
      [registrationAt(0), registrationAt(1), registrationAt(4)].sort(),
    );
    const state = replayMatch(
      rows.map((row) => ({
        ...row,
        clientRecordedAt: row.clientRecordedAt.toISOString(),
      })) as MatchEvent[],
    );
    expect(state.styles[registrationAt(0)]).toEqual({
      battingHand: "left",
      bowlingStyle: "right_arm_medium",
    });
    expect(state.styles[registrationAt(1)]).toEqual({ bowlingStyle: "left_arm_medium" });
    expect(state.styles[registrationAt(2)]).toBeUndefined();
    expect(state.styles[registrationAt(4)]).toEqual({ battingHand: "right" });
    await owner.db
      .update(registrations)
      .set({ battingStyle: "right_hand", bowlingStyle: "left_arm_fast" })
      .where(eq(registrations.id, registrationAt(0)));
    expect(await start(id, actor, setup)).toMatchObject({ ok: true, lastSeq: 6 });
    expect(
      await owner.db
        .select()
        .from(matchEvents)
        .where(eq(matchEvents.fixtureId, id))
        .orderBy(matchEvents.seq),
    ).toEqual(rows);
    const audit = await owner.db.select().from(auditLog).where(eq(auditLog.subject, id));
    expect(audit.find((row) => row.action === "match.started")?.meta).toMatchObject({
      seededStyles: seed.map((row) => ({
        registrationId: (row.payload as { registrationId: string }).registrationId,
        eventId: row.eventId,
        source: "registration_profile",
      })),
    });
    expect(audit.some((row) => row.action === "registration.style_set_by_scorer")).toBe(false);
    await owner.db
      .update(registrations)
      .set({ bowlingStyle: "right_arm_fast" })
      .where(eq(registrations.id, registrationAt(2)));
    const ball = {
      strikerId: registrationAt(0),
      nonStrikerId: registrationAt(1),
      bowlerId: registrationAt(2),
      runsBat: 0,
      extras: {},
    };
    const later = [
      { type: "toss", payload: { winnerTeamId: homeTeamId, decision: "bat" } },
      {
        type: "innings_started",
        payload: {
          inningsNo: 1,
          battingTeamId: homeTeamId,
          strikerId: registrationAt(0),
          nonStrikerId: registrationAt(1),
          bowlerId: registrationAt(2),
        },
      },
      { type: "ball", payload: ball },
      {
        type: "style_set",
        payload: { registrationId: registrationAt(2), bowlingStyle: "right_arm_fast" },
      },
      { type: "ball", payload: ball },
    ];
    const entries = later.map((entry, index) => ({
      ...entry,
      eventId: newId(),
      attempt: 1,
      v: 1,
      targetEventId: null,
      clientSeq: rows.length + index + 1,
      clientRecordedAt: new Date().toISOString(),
    })) as ClientEvent[];
    expect(
      await withTenantDb(app, { personId: actor, orgId }, (db) =>
        appendScoringEvents(db, id, actor, {
          deviceId: input.deviceId,
          attempt: 1,
          events: entries,
        }),
      ),
    ).toMatchObject({ ok: true, lastSeq: 11, acks: entries.map(() => ({ status: "stored" })) });
    const accepted = await owner.db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.fixtureId, id))
      .orderBy(matchEvents.seq);
    const replay = replayMatch(accepted.map(persistedMatchEvent));
    const deliveries = replay.innings[0]?.overs[0]?.balls;
    expect(deliveries?.[0]).toMatchObject({ batterHand: "left" });
    expect(deliveries?.[0]).not.toHaveProperty("bowlerStyle");
    expect(deliveries?.[1]).toMatchObject({ batterHand: "left", bowlerStyle: "right_arm_fast" });
  });
  it("generates independent 24-byte URL-safe share tokens", () => {
    const values = Array.from({ length: 100 }, scoringShareToken);
    expect(new Set(values).size).toBe(100);
    expect(values.every((value) => /^[A-Za-z0-9_-]{32}$/.test(value))).toBe(true);
  });
});

it("C47 unsupported sports refuse start, append and resume without delivery fallback or writes", async () => {
  const id = await fixture();
  await owner.db
    .update(competitions)
    .set({ sport: "esports" })
    .where(eq(competitions.id, competitionId));
  const message = "Live scoring for Esports is coming soon. Enter the result after the match.";
  try {
    expect(await start(id)).toMatchObject({ ok: false, error: "bad_payload", message });
    const raw = {
      deviceId: input.deviceId,
      attempt: 1,
      events: [
        {
          eventId: newId(),
          attempt: 1,
          type: "interrupt",
          v: 1,
          payload: { reason: "Rain" },
          targetEventId: null,
          clientSeq: 1,
          clientRecordedAt: new Date().toISOString(),
        },
      ],
    };
    expect(
      await withTenantDb(app, { personId: actor, orgId }, (db) =>
        appendScoringEvents(db, id, actor, raw),
      ),
    ).toMatchObject({ ok: false, error: "bad_payload", message });
    expect(await owner.db.select().from(matches).where(eq(matches.fixtureId, id))).toHaveLength(0);
    expect(
      await owner.db.select().from(matchEvents).where(eq(matchEvents.fixtureId, id)),
    ).toHaveLength(0);
    await owner.db
      .update(competitions)
      .set({ sport: "cricket" })
      .where(eq(competitions.id, competitionId));
    expect((await start(id)).ok).toBe(true);
    await owner.db
      .update(competitions)
      .set({ sport: "esports" })
      .where(eq(competitions.id, competitionId));
    expect(
      await withTenantDb(app, { personId: actor, orgId }, (db) => resumeScoring(db, id, actor, 0)),
    ).toMatchObject({ ok: false, error: "bad_payload", message });
    expect(
      await withTenantDb(app, { personId: actor, orgId }, (db) =>
        appendScoringEvents(db, id, actor, raw),
      ),
    ).toMatchObject({ ok: false, error: "bad_payload", message });
  } finally {
    await owner.db
      .update(competitions)
      .set({ sport: "cricket" })
      .where(eq(competitions.id, competitionId));
  }
});

it("C49 rally start and canonical finish retain real participants without cricket facts or awards", async () => {
  await owner.db
    .update(competitions)
    .set({ sport: "badminton" })
    .where(eq(competitions.id, competitionId));
  const id = await fixture();
  const setup = {
    deviceId: input.deviceId,
    formatKey: "badminton_bo3",
    conditions: {},
    lineups: [
      { teamId: homeTeamId, players: registrationIds.slice(0, 2) },
      { teamId: awayTeamId, players: registrationIds.slice(2, 4) },
    ],
  };
  try {
    expect(
      await withTenantDb(app, { personId: actor, orgId }, (db) =>
        startScoredMatch(db, id, actor, { ...setup, formatKey: "tt_bo5" }),
      ),
    ).toMatchObject({ ok: false, error: "bad_payload" });
    expect(
      await withTenantDb(app, { personId: actor, orgId }, (db) =>
        startScoredMatch(db, id, actor, setup),
      ),
    ).toMatchObject({ ok: true, lastSeq: 3 });
    const [match] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
    expect(match?.awardVersion).toBe("unscored/rally/badminton_bo3");
    let clientSeq = 3;
    async function append(entries: { type: MatchEvent["type"]; payload: unknown }[]) {
      const at = new Date();
      const result = await withTenantDb(app, { personId: actor, orgId }, (db) =>
        appendScoringEvents(
          db,
          id,
          actor,
          {
            deviceId: input.deviceId,
            attempt: 1,
            events: entries.map((entry) => ({
              ...entry,
              eventId: newId(),
              attempt: 1,
              v: 1,
              targetEventId: null,
              clientSeq: ++clientSeq,
              clientRecordedAt: at.toISOString(),
            })),
          },
          new Date(at.getTime() + 1),
        ),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.message);
      expect(result.acks.every((ack) => ack.status === "stored")).toBe(true);
      return result;
    }
    const rubber = {
      rubberNo: 1,
      homePlayers: [registrationAt(0)],
      awayPlayers: [registrationAt(2)],
      firstServer: "home",
    };
    await append([
      { type: "rubber_started", payload: rubber },
      ...Array.from({ length: 21 }, () => ({
        type: "rally" as const,
        payload: { winner: "home" },
      })),
    ]);
    await append([
      { type: "rubber_started", payload: rubber },
      ...Array.from({ length: 21 }, () => ({
        type: "rally" as const,
        payload: { winner: "home" },
      })),
      { type: "finish", payload: {} },
    ]);
    const rows = await owner.db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.fixtureId, id))
      .orderBy(matchEvents.seq);
    const state = rallyEngine.replay(rows.map(persistedMatchEvent));
    expect(state.finished).toBe(true);
    expect(state.rallies).toHaveLength(42);
    const [result] = await owner.db
      .select()
      .from(fixtureResults)
      .where(eq(fixtureResults.fixtureId, id));
    expect(result).toMatchObject({
      source: "scored",
      winnerTeamId: homeTeamId,
      score: { home: { rubbers: 1, games: 2 }, away: { rubbers: 0, games: 0 } },
    });
    const [finished] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
    await expect(
      withTenantDb(app, { personId: actor, orgId }, (db) =>
        overrideAward(db, {
          fixtureId: id,
          actorId: actor,
          registrationId: registrationAt(0),
          kind: "player_of_match",
          reason: "Organizer review",
        }),
      ),
    ).rejects.toThrow("unavailable for rally");
    expect(finished?.trustReasons).not.toContain("pace_impossible");
    expect(finished?.trustReasons).not.toContain("scorer_is_top_scorer");
    for (const table of [matchPlayerLines, matchAwards, ballFacts])
      expect(await owner.db.select().from(table).where(eq(table.fixtureId, id))).toHaveLength(0);
    const [snapshot] = await owner.db
      .select()
      .from(matchLiveState)
      .where(eq(matchLiveState.fixtureId, id));
    expect(snapshot?.state).toMatchObject({
      family: "rally",
      panel: { points: { home: 21, away: 0 } },
    });
    expect(snapshot?.state).not.toHaveProperty("scorecard");
    const participants = await withTenantDb(app, { personId: actor, orgId }, (db) =>
      noticeParticipants(db, id, orgId, competitionId),
    );
    expect(participants.map((row) => row.registrationId).sort()).toEqual(
      [registrationAt(0), registrationAt(2)].sort(),
    );
    expect(
      (await withTenantDb(app, { personId: actor, orgId }, (db) => resumeScoring(db, id, actor, 0)))
        .ok,
    ).toBe(true);
  } finally {
    await owner.db
      .update(competitions)
      .set({ sport: "cricket" })
      .where(eq(competitions.id, competitionId));
  }
});
