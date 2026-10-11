import { playWindow } from "./trust-facts";
import { sealScoring } from "./sweep";
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
  fixtureParticipants,
  matches,
  matchEvents,
  matchPlayerLines,
  matchAwards,
  ballFacts,
  fixtureResults,
  withTenantDb,
  teamManagers,
} from "@desiauction/db";
import {
  placementEngine,
  NEW_SEASON_SCORING_RULES,
  placementTable,
} from "@desiauction/core/scoring";
import { and, eq, inArray } from "drizzle-orm";
import { env } from "../../env";
import { purgeOrg } from "../test-support/purge-org";
import { startScoredMatch } from "./start";
import { appendScoringRequest, persistedMatchEvent, type ClientEvent } from "./append";
import { standingsOf, recordLobbyResult } from "../competition/results";
import { overrideAward } from "./awards";
import { noticeParticipants } from "./notice-participants";
import { publicLiveResult } from "./public";
import { publicPage } from "./public-page";
import { finalizeScoredMatch } from "./finalize";
import { claimScoring, resumeScoring } from "./claim";
import { confirmMatch } from "./confirmation";
import { confirmationToken } from "./confirmation-token";
import { updateMatchTrust } from "./trust";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
if (!env.SYSTEM_DATABASE_URL) throw new Error("Placement regressions require system role");
if (!env.APP_DATABASE_URL) throw new Error("Placement regressions require app role");
const owner = createDb(env.DATABASE_URL),
  app = createDb(env.APP_DATABASE_URL),
  system = createDb(env.SYSTEM_DATABASE_URL),
  orgId = newId(),
  actor = newId(),
  competitionId = newId(),
  teamIds = [newId(), newId(), newId()],
  persons = Array.from({ length: 6 }, () => newId()),
  regs = persons.map(() => newId()),
  managers = teamIds.map(() => newId()),
  slug = `lobby-${competitionId}`;
let fixtureSeq = 0,
  clientSeq = 10;
function required<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("Missing fixture");
  return v;
}
const tid = (i: number) => required(teamIds[i]),
  rid = (i: number) => required(regs[i]);
beforeAll(async () => {
  await owner.db.insert(people).values(
    [actor, ...persons, ...managers].map((id) => ({
      id,
      name: `Person ${id}`,
      email: `${id}@example.test`,
    })),
  );
  await owner.db
    .insert(organizations)
    .values({ id: orgId, name: "Lobby club", slug: `lobby-${orgId}`, createdBy: actor });
  await owner.db.insert(competitions).values({
    id: competitionId,
    orgId,
    sport: "battle_royale",
    name: "Lobby cup",
    slug,
    visibility: "public",
    createdBy: actor,
    scoringRules: { ...NEW_SEASON_SCORING_RULES, publicDelaySeconds: 60 },
  });
  await owner.db.insert(teams).values(
    teamIds.map((id, i) => ({
      id,
      orgId,
      competitionId,
      name: `Squad ${String(i + 1)}`,
      createdBy: actor,
    })),
  );
  await owner.db.insert(grants).values({
    id: newId(),
    personId: actor,
    scopeType: "org",
    scopeId: orgId,
    capabilitySet: "org:owner",
    grantedBy: actor,
  });
  await owner.db.insert(registrations).values(
    persons.map((personId, i) => ({
      id: rid(i),
      personId,
      orgId,
      competitionId,
      teamId: tid(Math.floor(i / 2)),
      status: "approved" as const,
      registrationNumber: `LB-${String(i)}`,
    })),
  );
  await owner.db.insert(teamManagers).values(
    teamIds.map((teamId, i) => ({
      id: newId(),
      orgId,
      competitionId,
      teamId,
      personId: required(managers[i]),
      source: "organizer" as const,
      role: "manager" as const,
      createdBy: actor,
    })),
  );
});
afterAll(async () => {
  await purgeOrg(owner.db, orgId);
  await owner.db.delete(people).where(inArray(people.id, [actor, ...persons, ...managers]));
  await system.sql.end();
  await app.sql.end();
  await owner.sql.end();
});
async function fixture() {
  const id = newId();
  fixtureSeq++;
  await owner.db.insert(fixtures).values({
    id,
    orgId,
    competitionId,
    homeTeamId: null,
    awayTeamId: null,
    fixtureNumber: `Lobby ${String(fixtureSeq)}`,
    seq: fixtureSeq,
    status: "published",
    createdBy: actor,
  });
  await owner.db
    .insert(fixtureParticipants)
    .values(teamIds.map((teamId) => ({ fixtureId: id, teamId, orgId, competitionId })));
  return id;
}
function setupInput(rounds = 2) {
  return {
    deviceId: "lobby-test",
    formatKey: `lobby_${String(rounds)}`,
    rounds,
    conditions: {},
    lineups: teamIds.map((teamId, i) => ({ teamId, players: regs.slice(i * 2, i * 2 + 2) })),
  };
}
async function setup(rounds = 2, scorer = actor) {
  const id = await fixture();
  expect(
    await withTenantDb(app, { personId: scorer, orgId }, (db) =>
      startScoredMatch(db, id, scorer, setupInput(rounds)),
    ),
  ).toMatchObject({ ok: true });
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
function round(roundNo: number, kills = [7, 2, 1], placements = [1, 2, 3]) {
  return {
    round: roundNo,
    rows: teamIds.map((teamId, i) => ({
      teamId,
      placement: required(placements[i]),
      kills: required(kills[i]),
      playerKills: { [rid(i * 2)]: required(kills[i]), [rid(i * 2 + 1)]: 0 },
    })),
  };
}
async function append(id: string, events: ClientEvent[], scorer = actor) {
  const result = await appendScoringRequest(
    app,
    { personId: scorer, orgId },
    id,
    { deviceId: "lobby-test", attempt: events[0]?.attempt ?? 1, events },
    new Date(),
  );
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.message);
  expect(result.acks.every((ack) => ["stored", "duplicate"].includes(ack.status))).toBe(true);
  return result;
}
async function state(id: string) {
  const rows = await owner.db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.fixtureId, id))
    .orderBy(matchEvents.seq);
  return placementEngine.replay(rows.map(persistedMatchEvent));
}
it("multiround finalization writes aggregate source/score/points, canonical identities/public privacy, no cricket facts, idempotent top fragger", async () => {
  const id = await setup();
  const e1 = event("lobby_round", round(1, [100, 2, 1])),
    e2 = event("lobby_round", round(2, [100, 2, 1]));
  await append(id, [e1, e2, event("finish", {})]);
  const canonical = await state(id);
  expect(placementTable(canonical)[0]).toMatchObject({ teamId: tid(0), kills: 200, points: 220 });
  const participants = await owner.db
    .select()
    .from(fixtureParticipants)
    .where(eq(fixtureParticipants.fixtureId, id));
  expect(participants.find((row) => row.teamId === tid(0))).toMatchObject({
    source: "scored",
    placement: 1,
    score: { kills: 200 },
  });
  const table = await withTenantDb(app, { personId: actor, orgId }, (db) =>
    standingsOf(db, competitionId),
  );
  expect(table.rows.find((row) => row.teamId === tid(0))).toMatchObject({ played: 1, points: 220 });
  const readTable = () =>
    withTenantDb(app, { personId: actor, orgId }, (db) => standingsOf(db, competitionId));
  await owner.db
    .update(fixtureParticipants)
    .set({ score: { kills: 199 } })
    .where(and(eq(fixtureParticipants.fixtureId, id), eq(fixtureParticipants.teamId, tid(0))));
  expect((await readTable()).recorded).toBe(table.recorded - 1);
  await owner.db
    .update(fixtureParticipants)
    .set({ score: { kills: 200 } })
    .where(and(eq(fixtureParticipants.fixtureId, id), eq(fixtureParticipants.teamId, tid(0))));
  await owner.db
    .update(matches)
    .set({ format: { key: "malformed" } })
    .where(eq(matches.fixtureId, id));
  expect((await readTable()).recorded).toBe(table.recorded - 1);
  await owner.db.update(matches).set({ format: canonical.format }).where(eq(matches.fixtureId, id));
  expect((await readTable()).recorded).toBe(table.recorded);

  expect(
    await withTenantDb(app, { personId: actor, orgId }, (db) =>
      recordLobbyResult(db, {
        orgId,
        fixtureId: id,
        actorId: actor,
        placements: teamIds.map((teamId, i) => ({ teamId, placement: i + 1, score: { kills: 2 } })),
      }),
    ),
  ).toMatchObject({ ok: false, reason: "scored_fixture" });
  expect(
    await owner.db.select().from(fixtureResults).where(eq(fixtureResults.fixtureId, id)),
  ).toEqual([]);
  expect(await owner.db.select().from(ballFacts).where(eq(ballFacts.fixtureId, id))).toEqual([]);
  expect(
    await owner.db.select().from(matchPlayerLines).where(eq(matchPlayerLines.fixtureId, id)),
  ).toEqual([]);
  const awards = await owner.db.select().from(matchAwards).where(eq(matchAwards.fixtureId, id));
  expect(awards).toHaveLength(1);
  expect(awards[0]).toMatchObject({
    kind: "top_fragger",
    winnerRegistrationId: rid(0),
    score: "200.00",
  });
  await withTenantDb(app, { personId: actor, orgId }, (db) =>
    finalizeScoredMatch(db, id, actor, canonical),
  );
  expect(
    await owner.db.select().from(matchAwards).where(eq(matchAwards.fixtureId, id)),
  ).toHaveLength(1);
  expect(
    await withTenantDb(app, { personId: actor, orgId }, (db) =>
      noticeParticipants(db, id, orgId, competitionId),
    ),
  ).toHaveLength(6);
  const live = await publicLiveResult(id, { s: slug }, new Date(), owner.db);
  expect(live?.live.family).toBe("placement");
  expect(Array.isArray(live?.live.teams)).toBe(true);
  expect(JSON.stringify(live)).not.toMatch(/@example|clientRecordedAt|playerKills|actorPersonId/);
  expect(
    (await publicPage({ slug, fixtureNumber: `Lobby ${String(fixtureSeq)}` }, owner.db))?.teams,
  ).toHaveLength(3);
});
it("correction refinalizes exact projections, duplicate receipts do not duplicate rounds and organizer override retains provenance", async () => {
  const id = await setup();
  const original = event("lobby_round", round(1));
  await append(id, [original, event("lobby_round", round(2)), event("finish", {})]);
  await append(id, [original]);
  const correction = event("amend", { payload: round(1, [0, 30, 0], [2, 1, 3]) }, original.eventId);
  await append(id, [correction]);
  expect(placementTable(await state(id))[0]?.teamId).toBe(tid(1));
  const override = await withTenantDb(app, { personId: actor, orgId }, (db) =>
    overrideAward(db, {
      fixtureId: id,
      actorId: actor,
      kind: "top_fragger",
      registrationId: rid(4),
      reason: "Organizer reviewed the complete rounds",
    }),
  );
  expect(override).toMatchObject({
    computedRegistrationId: rid(2),
    winnerRegistrationId: rid(4),
    source: "organizer",
  });
  await append(id, [event("amend", { payload: round(1, [40, 0, 0]) }, original.eventId)]);
  const rows = await owner.db
    .select()
    .from(matchAwards)
    .where(and(eq(matchAwards.fixtureId, id), eq(matchAwards.source, "organizer")));
  expect(rows).toHaveLength(1);
  expect(rows[0]?.winnerRegistrationId).toBe(rid(4));
  await expect(
    withTenantDb(app, { personId: actor, orgId }, (db) =>
      overrideAward(db, {
        fixtureId: id,
        actorId: actor,
        kind: "player_of_match",
        registrationId: rid(0),
        reason: "Wrong family award attempt",
      }),
    ),
  ).rejects.toThrow(/Only top fragger/);
});
it("null award at zero kills, abandonment excludes competition and typed bounds remain single-round", async () => {
  const id = await setup(1);
  await append(id, [event("lobby_round", round(1, [0, 0, 0], [1, 1, 1])), event("finish", {})]);
  const awards = await owner.db.select().from(matchAwards).where(eq(matchAwards.fixtureId, id));
  expect(awards[0]?.winnerRegistrationId).toBeNull();
  const abandoned = await setup();
  await append(abandoned, [
    event("abandon", { kind: "abandoned", reason: "Lobby cancelled during play" }),
  ]);
  expect(
    (
      await owner.db
        .select()
        .from(fixtureParticipants)
        .where(eq(fixtureParticipants.fixtureId, abandoned))
    ).every((row) => row.source === "scored" && row.placement === null),
  ).toBe(true);
  const typed = await fixture();
  expect(
    await withTenantDb(app, { personId: actor, orgId }, (db) =>
      recordLobbyResult(db, {
        orgId,
        fixtureId: typed,
        actorId: actor,
        placements: teamIds.map((teamId, i) => ({
          teamId,
          placement: i + 1,
          score: { kills: 101 },
        })),
      }),
    ),
  ).toMatchObject({ ok: false, reason: "impossible_score" });
});
it("every other lobby team must confirm the current revision, revoked managers no longer satisfy confirmation", async () => {
  const scorer = required(managers[0]),
    id = await setup(1, scorer);
  await append(id, [event("lobby_round", round(1)), event("finish", {})], scorer);
  const canonical = await state(id);
  const token = (i: number) =>
    confirmationToken(
      { fixtureId: id, attempt: canonical.attempt, lastSeq: canonical.lastSeq, teamId: tid(i) },
      new Date(),
    );
  expect(
    await withTenantDb(app, { personId: required(managers[1]), orgId }, (db) =>
      confirmMatch(db, required(managers[1]), token(1), "confirmed", ""),
    ),
  ).toMatchObject({ ok: true });
  expect(
    (await owner.db.select().from(matches).where(eq(matches.fixtureId, id)))[0]?.trustLevel,
  ).toBe("self_scored");
  expect(
    await withTenantDb(app, { personId: required(managers[2]), orgId }, (db) =>
      confirmMatch(db, required(managers[2]), token(2), "confirmed", ""),
    ),
  ).toMatchObject({ ok: true });
  expect(
    (await owner.db.select().from(matches).where(eq(matches.fixtureId, id)))[0]?.trustLevel,
  ).toBe("confirmed");
  await owner.db
    .update(teamManagers)
    .set({ revokedAt: new Date() })
    .where(eq(teamManagers.personId, required(managers[2])));
  await withTenantDb(app, { personId: actor, orgId }, (db) =>
    updateMatchTrust(db, id, canonical, new Date()),
  );
  expect(
    (await owner.db.select().from(matches).where(eq(matches.fixtureId, id)))[0]?.trustLevel,
  ).toBe("self_scored");
  await owner.db
    .update(teamManagers)
    .set({ revokedAt: null })
    .where(eq(teamManagers.personId, required(managers[2])));
});
it("current trust delay/private gates and device claim preserve complete canonical lobby history", async () => {
  const id = await setup();
  await append(id, [event("lobby_round", round(1))]);
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
  expect(released?.live.family).toBe("placement");
  expect(JSON.stringify(released)).not.toMatch(/playerKills|actorPersonId|@example/);
  await owner.db
    .update(competitions)
    .set({ visibility: "private" })
    .where(eq(competitions.id, competitionId));
  expect(
    await publicLiveResult(id, { s: slug }, new Date(at.getTime() + 61000), owner.db),
  ).toBeNull();
  await owner.db
    .update(competitions)
    .set({ visibility: "public" })
    .where(eq(competitions.id, competitionId));
  expect(
    await withTenantDb(app, { personId: actor, orgId }, (db) =>
      claimScoring(db, id, actor, { deviceId: "lobby-second", mode: "clean" }),
    ),
  ).toMatchObject({ ok: true });
  expect(
    await withTenantDb(app, { personId: actor, orgId }, (db) => resumeScoring(db, id, actor, 0)),
  ).toMatchObject({ ok: true, lastSeq: 5 });
  const next = event("lobby_round", round(2));
  expect(
    await appendScoringRequest(app, { personId: actor, orgId }, id, {
      deviceId: "lobby-test",
      attempt: 1,
      events: [next],
    }),
  ).toMatchObject({ ok: false, error: "forbidden" });
  expect(
    await appendScoringRequest(app, { personId: actor, orgId }, id, {
      deviceId: "lobby-second",
      attempt: 1,
      events: [next],
    }),
  ).toMatchObject({ ok: true, acks: [{ status: "stored" }] });
  await withTenantDb(app, { personId: actor, orgId }, (db) =>
    claimScoring(db, id, actor, { deviceId: "lobby-test", mode: "clean" }),
  );
  await append(id, [event("finish", {})]);
});
it("missing canonical scored histories fail closed and multiple represented squads require explicit authorized selection", async () => {
  const id = await fixture();
  await owner.db.update(fixtures).set({ status: "completed" }).where(eq(fixtures.id, id));
  await owner.db
    .update(fixtureParticipants)
    .set({ source: "scored", placement: 1, score: { kills: 7 } })
    .where(eq(fixtureParticipants.fixtureId, id));
  const view = await withTenantDb(app, { personId: actor, orgId }, (db) =>
    standingsOf(db, competitionId),
  );
  const before = view.recorded;
  await owner.db
    .update(fixtureParticipants)
    .set({ score: { kills: 99 } })
    .where(eq(fixtureParticipants.fixtureId, id));
  expect(
    (await withTenantDb(app, { personId: actor, orgId }, (db) => standingsOf(db, competitionId)))
      .recorded,
  ).toBe(before);
  const manager = required(managers[0]);
  await owner.db.insert(teamManagers).values({
    id: newId(),
    orgId,
    competitionId,
    teamId: tid(1),
    personId: manager,
    source: "organizer",
    role: "manager",
    createdBy: actor,
  });
  const pending = await fixture();
  expect(
    await withTenantDb(app, { personId: manager, orgId }, (db) =>
      startScoredMatch(db, pending, manager, setupInput(1)),
    ),
  ).toMatchObject({ ok: false, error: "bad_payload" });
  expect(
    await withTenantDb(app, { personId: manager, orgId }, (db) =>
      startScoredMatch(db, pending, manager, { ...setupInput(1), representedTeamId: tid(0) }),
    ),
  ).toMatchObject({ ok: true });
  await append(pending, [event("lobby_round", round(1)), event("finish", {})], manager);
});

it("effective rounds retain original receipt coverage through corrections and sealing preserves top-fragger provenance", async () => {
  const id = await setup(1),
    original = event("lobby_round", round(1));
  await append(id, [original]);
  await append(id, [event("finish", {})]);
  const rows = await owner.db
    .select()
    .from(matchEvents)
    .where(eq(matchEvents.fixtureId, id))
    .orderBy(matchEvents.seq);
  const canonical = placementEngine.replay(rows.map(persistedMatchEvent));
  const originalRow = rows.find((row) => row.eventId === original.eventId);
  if (!originalRow) throw new Error("Missing round");
  const at = new Date(originalRow.receivedAt.getTime() + 1000);
  const receiptRows = rows.map((row) => (row.type === "finish" ? { ...row, receivedAt: at } : row));
  expect(playWindow(canonical, receiptRows, at)).not.toBeNull();
  expect(
    playWindow(
      canonical,
      receiptRows.filter((row) => row.eventId !== original.eventId),
      at,
    ),
  ).toBeNull();
  expect(
    playWindow(
      canonical,
      receiptRows.map((row) =>
        row.eventId === original.eventId
          ? { ...row, receivedAt: new Date(row.clientRecordedAt.getTime() + 120001) }
          : row,
      ),
      at,
    ),
  ).toBeNull();
  await append(id, [event("amend", { payload: round(1, [8, 2, 1]) }, original.eventId)]);
  expect((await state(id)).rounds[0]?.clientRecordedAt).toBe(original.clientRecordedAt);
  expect(
    await withTenantDb(app, { personId: actor, orgId }, (db) =>
      sealScoring(db, id, new Date(Date.now() + 10 * 86400000)),
    ),
  ).toMatchObject({ sealed: true });
  expect((await owner.db.select().from(matches).where(eq(matches.fixtureId, id)))[0]?.phase).toBe(
    "final",
  );
  expect(
    (await owner.db.select().from(matchAwards).where(eq(matchAwards.fixtureId, id))).every(
      (row) => row.kind === "top_fragger",
    ),
  ).toBe(true);
});

it("canonical setup publishes a delayed system-role zero-round snapshot without satisfying genuine-play receipts", async () => {
  const id = await setup(1),
    canonical = await state(id),
    at = new Date(Date.now() + 61000);
  expect(canonical.phase).toBe("live");
  expect(canonical.rounds).toEqual([]);
  expect(playWindow(canonical, [], at)).toBeNull();
  const live = await publicLiveResult(id, { s: slug }, at, system.db);
  expect(live?.live).toMatchObject({
    family: "placement",
    phase: "live",
    panel: { round: 0, rounds: 1 },
  });
  expect(live?.live.teams).toHaveLength(3);
  expect(JSON.stringify(live)).not.toMatch(/playerKills|actorPersonId|@example/);
});
