import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  auditLog,
  auctions,
  auctionOwnerInvites,
  teamManagers,
  competitions,
  createDb,
  fixtureResults,
  fixtures,
  grants,
  matchEvents,
  matchLiveState,
  matches,
  newId,
  organizations,
  people,
  registrations,
  teams,
  withTenantDb,
} from "@desiauction/db";
import { env } from "../../env";
import { purgeOrg } from "../test-support/purge-org";
import { resultOf, resultsOf, standingsOf } from "../competition/results";
import { appendScoringEvents, appendScoringRequest, type ClientEvent } from "./append";
import { startScoredMatch } from "./start";
import { syncAuctionOwnersToManagers } from "./managers";
import { claimScoring, resumeScoring } from "./claim";
import { scoringDay, scoringHome, scoringSetup, scoringAcceptedSetupForPerson } from "./home";
import { prepareScoring } from "./prepare";
import * as liveState from "./live-state";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const owner = createDb(env.DATABASE_URL),
  app = env.APP_DATABASE_URL ? createDb(env.APP_DATABASE_URL) : owner;
const actor = newId(),
  scorer = newId(),
  orgId = newId(),
  season = newId(),
  home = newId(),
  away = newId();
const players = Array.from({ length: 4 }, () => newId()),
  regs = players.map(() => newId());
const at = (index: number) => {
  const id = regs[index];
  if (!id) throw new Error("Missing registration");
  return id;
};
const now = new Date();
let sequence = 0,
  clientSeq = 3;
const within = <T>(personId: string, fn: (db: typeof owner.db) => Promise<T>) =>
  withTenantDb(app, { personId, orgId }, fn);
function event(type: ClientEvent["type"], payload: unknown): ClientEvent {
  return {
    eventId: newId(),
    type,
    payload,
    attempt: 1,
    v: 1,
    targetEventId: null,
    clientSeq: ++clientSeq,
    clientRecordedAt: now.toISOString(),
  } as ClientEvent;
}
const append = (id: string, events: ClientEvent[], personId = actor, deviceId = "void-device") =>
  appendScoringRequest(app, { personId, orgId }, id, { deviceId, attempt: 1, events }, now);
const startInput = {
  deviceId: "void-device",
  formatKey: "t20",
  conditions: {},
  lineups: [
    {
      teamId: home,
      battingOrder: regs.slice(0, 2),
      captainId: at(0),
      keeperId: at(1),
      substitutes: [],
    },
    {
      teamId: away,
      battingOrder: regs.slice(2),
      captainId: at(2),
      keeperId: at(3),
      substitutes: [],
    },
  ],
};
async function setup(personId = actor) {
  const id = newId();
  await owner.db.insert(fixtures).values({
    id,
    orgId,
    competitionId: season,
    seq: ++sequence,
    fixtureNumber: `VOID-${String(sequence)}`,
    homeTeamId: home,
    awayTeamId: away,
    status: "published",
    kickoffAt: `${scoringDay(now)}T19:00`,
    createdBy: actor,
  });
  const start = await within(personId, (db) =>
    startScoredMatch(db, id, personId, {
      ...startInput,
    }),
  );
  if (!start.ok) throw new Error(start.message);
  return id;
}
beforeAll(async () => {
  await owner.db.insert(people).values(
    [actor, scorer, ...players].map((id) => ({
      id,
      name: "Void review",
      email: `void-${id}@example.test`,
    })),
  );
  await owner.db
    .insert(organizations)
    .values({ id: orgId, name: "Void club", slug: `void-${orgId}`, createdBy: actor });
  await owner.db.insert(competitions).values({
    id: season,
    orgId,
    name: "Void cup",
    slug: `void-${season}`,
    sport: "cricket",
    createdBy: actor,
  });
  await owner.db.insert(teams).values(
    [home, away].map((id) => ({
      id,
      orgId,
      competitionId: season,
      name: id === home ? "Home" : "Away",
      createdBy: actor,
    })),
  );
  await owner.db.insert(registrations).values(
    regs.map((id, index) => ({
      id,
      orgId,
      competitionId: season,
      personId: players[index] ?? actor,
      status: "approved" as const,
      teamId: index < 2 ? home : away,
    })),
  );
  await owner.db.insert(grants).values([
    {
      id: newId(),
      personId: actor,
      scopeType: "org" as const,
      scopeId: orgId,
      capabilitySet: "org:owner",
      grantedBy: actor,
    },
    {
      id: newId(),
      personId: scorer,
      scopeType: "tournament" as const,
      scopeId: season,
      capabilitySet: "fixture:scorer",
      grantedBy: actor,
    },
  ]);
});
afterAll(async () => {
  await purgeOrg(owner.db, orgId);
  for (const id of [actor, scorer, ...players])
    await owner.db.delete(people).where(eq(people.id, id));
  if (app !== owner) await app.sql.end();
  await owner.sql.end();
});
describe("C26 whole-match void persistence", () => {
  it("prepares published unstarted information without creating a match or claim", async () => {
    const id = newId();
    await owner.db.insert(fixtures).values({
      id,
      orgId,
      competitionId: season,
      seq: ++sequence,
      fixtureNumber: `PREP-${String(sequence)}`,
      homeTeamId: home,
      awayTeamId: away,
      status: "published",
      kickoffAt: `${scoringDay(now)}T19:00`,
      createdBy: actor,
    });
    {
      expect(await within(actor, (db) => prepareScoring(db, id, actor))).toMatchObject({
        ok: true,
        preparation: "unstarted",
        attempt: null,
        lastSeq: 0,
        events: [],
        bootstrap: { actorId: actor },
      });
      expect(await owner.db.select().from(matches).where(eq(matches.fixtureId, id))).toEqual([]);
      expect(
        await owner.db.select().from(matchEvents).where(eq(matchEvents.fixtureId, id)),
      ).toEqual([]);
      expect(await within(actor, (db) => resumeScoring(db, id, actor, 0))).toMatchObject({
        ok: false,
        error: "not_found",
      });
      expect(
        await within(actor, (db) => startScoredMatch(db, id, actor, startInput)),
      ).toMatchObject({ ok: true });
      expect(await within(actor, (db) => prepareScoring(db, id, actor))).toMatchObject({
        ok: true,
        attempt: 1,
        lastSeq: 3,
      });
      expect(await within(actor, (db) => prepareScoring(db, id, actor))).toMatchObject({
        preparation: "unstarted",
      });
      expect(
        await append(id, [event("toss", { winnerTeamId: home, decision: "bat" })]),
      ).toMatchObject({ ok: true });
      expect(await within(actor, (db) => prepareScoring(db, id, actor))).toMatchObject({
        preparation: "unstarted",
        attempt: 1,
        lastSeq: 4,
      });
      expect(await append(id, [event("interrupt", { reason: "rain" })])).toMatchObject({
        ok: true,
      });
      expect(await within(actor, (db) => prepareScoring(db, id, actor))).toMatchObject({
        preparation: "unstarted",
        attempt: 1,
        lastSeq: 5,
      });
      expect(
        await append(id, [
          event("resume", {}),
          event("innings_started", {
            inningsNo: 1,
            battingTeamId: home,
            strikerId: at(0),
            nonStrikerId: at(1),
            bowlerId: at(2),
          }),
        ]),
      ).toMatchObject({ ok: true, acks: [{ status: "stored" }, { status: "stored" }] });
      expect(await within(actor, (db) => prepareScoring(db, id, actor))).toMatchObject({
        preparation: "started",
        attempt: 1,
        lastSeq: 7,
      });

      expect(
        await append(id, [event("match_voided", { reason: "Unstarted preparation cleanup" })]),
      ).toMatchObject({ ok: true });
    }
  });

  it("prepares an actor-bound tenant snapshot with privacy-filtered player names", async () => {
    const id = await setup();
    await owner.db
      .update(registrations)
      .set({ dateOfBirth: "2015-01-01" })
      .where(eq(registrations.id, at(0)));
    try {
      const prepared = await within(actor, (db) => prepareScoring(db, id, actor));
      expect(prepared).toMatchObject({
        ok: true,
        attempt: 1,
        lastSeq: 3,
        bootstrap: { actorId: actor, setup: { fixtureId: id } },
      });
      if (!prepared.ok) throw new Error("Missing prepared match");
      expect(prepared.events.map((event) => event.seq)).toEqual([1, 2, 3]);
      expect(prepared.bootstrap.names.players[at(0)]).toMatchObject({ name: "VR", photoUrl: null });
      expect(
        prepared.bootstrap.setup.teams[0].players.find((player) => player.id === at(0))?.name,
      ).toBe("VR");
      expect(JSON.stringify(prepared.bootstrap)).not.toMatch(
        /dateOfBirth|email|phone|adultConfirmedAt|photoConsentAt/,
      );
      expect(
        await within(players[0] ?? scorer, (db) => prepareScoring(db, id, players[0] ?? scorer)),
      ).toMatchObject({ ok: false });
      expect(await within(actor, (db) => prepareScoring(db, newId(), actor))).toMatchObject({
        ok: false,
      });
    } finally {
      await owner.db
        .update(registrations)
        .set({ dateOfBirth: null })
        .where(eq(registrations.id, at(0)));
      expect(
        await append(id, [event("match_voided", { reason: "Preparation regression cleanup" })]),
      ).toMatchObject({ ok: true });
    }
  });

  it("restores accepted setup on the server and refuses incomplete restart seed", async () => {
    const id = await setup();
    const initial = await scoringAcceptedSetupForPerson(id, actor);
    expect(initial?.accepted).toMatchObject({ attempt: 1, lastSeq: 3, format: { key: "t20" } });
    expect(await within(actor, (db) => prepareScoring(db, id, actor))).toMatchObject({
      preparation: "unstarted",
      attempt: 1,
      lastSeq: 3,
    });
    if (!initial?.accepted) throw new Error("Missing initial accepted setup");
    expect(await append(id, [event("restart", { reason: "Fresh toss" })])).toMatchObject({
      ok: true,
    });
    expect((await scoringAcceptedSetupForPerson(id, actor))?.accepted).toBeNull();
    expect(await within(actor, (db) => prepareScoring(db, id, actor))).toMatchObject({
      preparation: "unstarted",
      attempt: 2,
      lastSeq: 4,
    });
    const seed = async (entries: ClientEvent[]) =>
      appendScoringRequest(
        app,
        { personId: actor, orgId },
        id,
        {
          deviceId: "void-device",
          attempt: 2,
          events: entries.map((entry) => ({ ...entry, attempt: 2 })),
        },
        now,
      );
    expect(
      await seed([
        event("match_started", {
          format: initial.accepted.format,
          conditions: initial.accepted.conditions,
          homeTeamId: home,
          awayTeamId: away,
        }),
      ]),
    ).toMatchObject({ ok: true });
    expect((await scoringAcceptedSetupForPerson(id, actor))?.accepted).toBeNull();
    expect(
      await seed(initial.accepted.lineups.map((lineup) => event("lineup_confirmed", lineup))),
    ).toMatchObject({ ok: true });
    expect(await within(actor, (db) => prepareScoring(db, id, actor))).toMatchObject({
      preparation: "unstarted",
      attempt: 2,
      lastSeq: 7,
    });
    const restored = await scoringAcceptedSetupForPerson(id, actor);
    expect(restored?.accepted).toMatchObject({
      attempt: 2,
      lastSeq: 7,
      conditions: initial.accepted.conditions,
      lineups: initial.accepted.lineups,
    });
    expect(
      await seed([event("match_voided", { reason: "Restart regression cleanup" })]),
    ).toMatchObject({ ok: true, phase: "void" });
  });

  it("does not expose completed typed-only fixtures or another tenant", async () => {
    const id = newId();
    await owner.db.insert(fixtures).values({
      id,
      orgId,
      competitionId: season,
      seq: ++sequence,
      fixtureNumber: `TYPED-${String(sequence)}`,
      homeTeamId: home,
      awayTeamId: away,
      status: "completed",
      createdBy: actor,
    });
    expect(await within(actor, (db) => scoringSetup(db, id, actor, now))).toBeNull();
    await owner.db.delete(fixtures).where(eq(fixtures.id, id));
    const scored = await setup();
    const otherOrg = newId();
    await owner.db.insert(organizations).values({
      id: otherOrg,
      name: "Other tenant",
      slug: `void-other-${otherOrg}`,
      createdBy: actor,
    });
    try {
      expect(
        await withTenantDb(app, { personId: actor, orgId: otherOrg }, (db) =>
          scoringSetup(db, scored, actor, now),
        ),
      ).toBeNull();
    } finally {
      await owner.db.delete(organizations).where(eq(organizations.id, otherOrg));
      expect(
        await append(scored, [event("match_voided", { reason: "Tenant regression cleanup" })]),
      ).toMatchObject({ ok: true });
    }
  });

  it("orders manager, resume, start and terminal locks without a three-way cycle", async () => {
    const id = await setup();
    const auctionId = newId();
    await owner.db.insert(auctions).values({
      id: auctionId,
      orgId,
      competitionId: season,
      name: "Lock auction",
      status: "completed",
      config: {},
      createdBy: actor,
    });
    const inviteId = newId();
    await owner.db.insert(auctionOwnerInvites).values({
      id: inviteId,
      orgId,
      auctionId,
      teamId: home,
      tokenHash: newId(),
      createdBy: actor,
      expiresAt: now,
      acceptedBy: actor,
      acceptedAt: now,
    });
    await within(actor, (db) => syncAuctionOwnersToManagers(db, season, actor));
    expect(
      await owner.db
        .select()
        .from(teamManagers)
        .where(and(eq(teamManagers.teamId, home), eq(teamManagers.personId, actor))),
    ).toHaveLength(1);
    const latch = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    };
    const manager = latch(),
      match = latch(),
      starting = latch(),
      proceed = latch();
    let startPid = 0;
    const reading = within(actor, async (db) => {
      await db.execute(sql`set local lock_timeout = '3s'`);
      await scoringSetup(db, id, actor);
      manager.resolve();
      await proceed.promise;
      return resumeScoring(db, id, actor, 0);
    });
    const terminal = within(actor, async (db) => {
      await manager.promise;
      await db.execute(sql`set local lock_timeout = '3s'`);
      await db.select().from(matches).where(eq(matches.fixtureId, id)).for("update");
      match.resolve();
      await proceed.promise;
      return appendScoringEvents(
        db,
        id,
        actor,
        {
          deviceId: "void-device",
          attempt: 1,
          events: [event("match_voided", { reason: "Lock regression cleanup" })],
        },
        now,
      );
    });
    const restarting = within(actor, async (db) => {
      await match.promise;
      await db.execute(sql`set local lock_timeout = '3s'`);
      const rows = await db.execute(sql`select pg_backend_pid() as pid`);
      startPid = Number(rows[0]?.pid);
      starting.resolve();
      return startScoredMatch(db, id, actor, startInput);
    });
    await starting.promise;
    try {
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const rows = await owner.db.execute(
          sql`select cardinality(pg_blocking_pids(${startPid})) > 0 as blocked`,
        );
        if (rows[0]?.blocked) {
          blocked = true;
          break;
        }
        await new Promise((done) => setTimeout(done, 10));
      }
      expect(blocked).toBe(true);
    } finally {
      proceed.resolve();
    }
    const results = await Promise.allSettled([reading, terminal, restarting]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    for (const result of results)
      if (result.status === "fulfilled") expect(result.value).toMatchObject({ ok: true });
    expect((await owner.db.select().from(matches).where(eq(matches.fixtureId, id)))[0]?.phase).toBe(
      "void",
    );
    await owner.db.delete(auctionOwnerInvites).where(eq(auctionOwnerInvites.id, inviteId));
    await owner.db
      .delete(teamManagers)
      .where(and(eq(teamManagers.teamId, home), eq(teamManagers.personId, actor)));
    await owner.db.delete(auctions).where(eq(auctions.id, auctionId));
  });

  it.each(["finish", "match_voided"] as const)(
    "existing start does not invert locks against %s",
    async (type) => {
      const id = await setup();
      if (type === "finish")
        expect(
          await append(id, [event("abandon", { kind: "no_result", reason: "Rain" })]),
        ).toMatchObject({ ok: true });
      let fixtureReady!: () => void, matchReady!: () => void, releaseMatch!: () => void;
      const fixtureLocked = new Promise<void>((resolve) => {
        fixtureReady = resolve;
      });
      const matchLocked = new Promise<void>((resolve) => {
        matchReady = resolve;
      });
      const startReadDone = new Promise<void>((resolve) => {
        releaseMatch = resolve;
      });
      const request = event(type, type === "finish" ? {} : { reason: "Duplicate fixture" });
      const starting = within(actor, async (db) => {
        await db.execute(sql`set local lock_timeout = '2s'`);
        await db.select().from(fixtures).where(eq(fixtures.id, id)).for("update");
        fixtureReady();
        await matchLocked;
        try {
          return await startScoredMatch(db, id, actor, startInput);
        } finally {
          releaseMatch();
        }
      });
      const terminal = within(actor, async (db) => {
        await fixtureLocked;
        await db.execute(sql`set local lock_timeout = '2s'`);
        await db.select().from(matches).where(eq(matches.fixtureId, id)).for("update");
        matchReady();
        await startReadDone;
        return appendScoringEvents(
          db,
          id,
          actor,
          { deviceId: "void-device", attempt: 1, events: [request] },
          now,
        );
      });
      const results = await Promise.allSettled([starting, terminal]);
      expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
      for (const result of results)
        if (result.status === "fulfilled") expect(result.value).toMatchObject({ ok: true });
      expect(
        (await owner.db.select().from(matches).where(eq(matches.fixtureId, id)))[0]?.phase,
      ).toBe(type === "finish" ? "no_result" : "void");
      if (type === "finish")
        expect(
          await append(id, [event("match_voided", { reason: "Concurrency fixture cleanup" })]),
        ).toMatchObject({ ok: true, phase: "void" });
    },
  );

  it("requires an organiser and the current claim, then atomically cancels an unfinished fixture", async () => {
    const id = await setup(scorer);
    const request = event("match_voided", { reason: "Duplicate fixture" });
    expect(await append(id, [request], scorer)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await append(id, [request])).toMatchObject({ ok: false, error: "forbidden" });
    expect(
      await within(actor, (db) =>
        claimScoring(db, id, actor, { deviceId: "void-device", mode: "force" }, now),
      ),
    ).toMatchObject({ ok: true });
    expect(await append(id, [request])).toMatchObject({
      ok: true,
      phase: "void",
      acks: [{ status: "stored" }],
    });
    const [fixture] = await owner.db.select().from(fixtures).where(eq(fixtures.id, id));
    expect(fixture?.status).toBe("cancelled");
    const [match] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
    expect(match).toMatchObject({ phase: "void", finishedAt: null });
    const [snapshot] = await owner.db
      .select()
      .from(matchLiveState)
      .where(eq(matchLiveState.fixtureId, id));
    expect(snapshot?.state).toMatchObject({ phase: "void", situation: "Match void" });
    const audits = await owner.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.voided")));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.meta).toMatchObject({
      reason: "Duplicate fixture",
      eventId: request.eventId,
      attempt: 1,
      seq: 4,
    });
    expect(
      (await within(actor, (db) => scoringHome(db, actor, scoringDay(now), now))).some(
        (match) => match.fixtureId === id,
      ),
    ).toBe(false);
    expect(await append(id, [request])).toMatchObject({
      ok: true,
      acks: [{ status: "duplicate" }],
    });
    expect(
      await owner.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.voided"))),
    ).toHaveLength(1);
    expect(await append(id, [event("restart", { reason: "Resurrect" })])).toMatchObject({
      ok: true,
      acks: [{ status: "rejected", reason: "already_finished" }],
    });
  });
  it.each([false, true])(
    "retains results and timestamps while excluding a finished match (final=%s)",
    async (final) => {
      const id = await setup();
      expect(
        await append(id, [
          event("abandon", { kind: "no_result", reason: "Rain" }),
          event("finish", {}),
        ]),
      ).toMatchObject({ ok: true });
      if (final)
        await owner.db
          .update(matches)
          .set({ phase: "final", finalizedAt: new Date(now.getTime() + 1000) })
          .where(eq(matches.fixtureId, id));
      expect(await within(actor, (db) => scoringSetup(db, id, actor, now))).not.toBeNull();
      expect(
        await within(scorer, (db) => scoringSetup(db, id, players[0] ?? "missing", now)),
      ).toBeNull();
      expect(
        (await within(actor, (db) => scoringHome(db, actor, scoringDay(now), now))).some(
          (row) => row.fixtureId === id,
        ),
      ).toBe(false);
      const [before] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
      expect(await within(actor, (db) => resultOf(db, id))).not.toBeNull();
      const result = await append(id, [event("match_voided", { reason: "Incorrect fixture" })]);
      expect(result).toMatchObject({ ok: true, phase: "void" });
      const [after] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
      expect(after?.finishedAt).toEqual(before?.finishedAt);
      expect(after?.finalizedAt).toEqual(before?.finalizedAt);
      expect(
        await owner.db.select().from(fixtureResults).where(eq(fixtureResults.fixtureId, id)),
      ).toHaveLength(1);
      expect(await within(actor, (db) => resultOf(db, id))).toBeNull();
      expect((await within(actor, (db) => resultsOf(db, season))).has(id)).toBe(false);
      const table = await within(actor, (db) => standingsOf(db, season));
      expect(table.recorded).toBe(0);
      expect(await within(actor, (db) => scoringSetup(db, id, actor, now))).toBeNull();
      expect(table.playable).toBe(0);
      expect(table.rows.every((row) => row.played === 0)).toBe(true);
      const [fixture] = await owner.db.select().from(fixtures).where(eq(fixtures.id, id));
      expect(fixture?.status).toBe("completed");
    },
  );
  it("rolls back event, phase, lifecycle and audit on snapshot failure", async () => {
    const id = await setup();
    const failure = vi
      .spyOn(liveState, "writeLiveState")
      .mockRejectedValueOnce(new Error("Injected snapshot fault"));
    try {
      await expect(
        append(id, [event("match_voided", { reason: "Invalid fixture" })]),
      ).rejects.toThrow("Injected snapshot fault");
    } finally {
      failure.mockRestore();
    }
    expect(
      await owner.db.select().from(matchEvents).where(eq(matchEvents.fixtureId, id)),
    ).toHaveLength(3);
    const [match] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
    expect(match?.phase).toBe("not_started");
    const [fixture] = await owner.db.select().from(fixtures).where(eq(fixtures.id, id));
    expect(fixture?.status).toBe("in_progress");
    expect(
      await owner.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.voided"))),
    ).toHaveLength(0);
  });
  it("refuses a missing or whitespace-only reason without storing any event", async () => {
    const id = await setup();
    for (const payload of [{}, { reason: " " }])
      expect(await append(id, [event("match_voided", payload)])).toMatchObject({
        ok: true,
        acks: [{ status: "rejected", reason: "bad_payload" }],
      });
    expect(
      await owner.db.select().from(matchEvents).where(eq(matchEvents.fixtureId, id)),
    ).toHaveLength(3);
  });
});
