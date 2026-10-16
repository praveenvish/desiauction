import {
  auditLog,
  competitions,
  createDb,
  fixtureResults,
  fixtures,
  grants,
  matchEvents,
  matches,
  matchLiveState,
  teamManagers,
  matchConfirmations,
  messageOutbox,
  newId,
  organizations,
  orgMembers,
  people,
  registrations,
  teams,
  withTenantDb,
} from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../env";
import { purgeOrg } from "../test-support/purge-org";
import { appendScoringRequest, type ClientEvent } from "./append";
import { startScoredMatch } from "./start";
import { SCORING_SYSTEM_ACTOR, sealScoring, sweepScoring } from "./sweep";
import { reviewMatchTrust } from "./trust-review";
import { confirmationToken } from "./confirmation-token";
import { confirmMatch } from "./confirmation";
import { dispatchConfirmationNotices } from "./result-notice-delivery";
import { confirmationHomeTask } from "./confirmation-home";
import { resolveConfirmationNoticeLink } from "./confirmation-notice-link";
import { reminderBoundariesFor } from "./reminder-boundaries";
import { overlappingPlay, playWindow } from "./trust-facts";
import {
  RALLY_FORMAT_PRESETS,
  rallyEngine,
  replayMatch,
  type MatchEvent,
} from "@desiauction/core/scoring";
import { persistedMatchEvent } from "./persisted-event";
import { drainOutbox } from "../messaging/outbox";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const owner = createDb(env.DATABASE_URL),
  app = env.APP_DATABASE_URL ? createDb(env.APP_DATABASE_URL) : owner;
const actor = newId(),
  other = newId(),
  orgId = newId(),
  competitionId = newId(),
  home = newId(),
  away = newId();
const players = Array.from({ length: 4 }, () => newId()),
  regs = players.map(() => newId());
const reg = (i: number) => {
  const id = regs[i];
  if (!id) throw new Error("registration");
  return id;
};
const deviceId = "sweep-device",
  now = new Date(),
  after = (ms: number) => new Date(now.getTime() + ms);
let seq = 0,
  clientSeq = 0;
function event(
  type: ClientEvent["type"],
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
const append = (id: string, events: ClientEvent[], personId = actor) =>
  appendScoringRequest(app, { personId, orgId }, id, { deviceId, attempt: 1, events }, now);
async function setup() {
  const id = newId();
  seq += 1;
  await owner.db.insert(fixtures).values({
    id,
    orgId,
    competitionId,
    homeTeamId: home,
    awayTeamId: away,
    fixtureNumber: `SWEEP-${String(seq)}`,
    seq,
    status: "published",
    kickoffAt: "2026-10-09T12:00",
    createdBy: actor,
  });
  const result = await withTenantDb(app, { personId: actor, orgId }, (db) =>
    startScoredMatch(db, id, actor, {
      deviceId,
      formatKey: "t20",
      conditions: {},
      lineups: [
        {
          teamId: home,
          battingOrder: regs.slice(0, 2),
          captainId: reg(0),
          keeperId: reg(1),
          substitutes: [],
        },
        {
          teamId: away,
          battingOrder: regs.slice(2),
          captainId: reg(2),
          keeperId: reg(3),
          substitutes: [],
        },
      ],
    }),
  );
  if (!result.ok) throw new Error(result.message);
  await owner.db
    .update(matches)
    .set({ startedAt: now, scorerClaimedAt: now })
    .where(eq(matches.fixtureId, id));
  return id;
}
async function live() {
  const id = await setup();
  expect(
    await append(id, [
      event("toss", { winnerTeamId: home, decision: "bat" }),
      event("innings_started", {
        inningsNo: 1,
        battingTeamId: home,
        strikerId: reg(0),
        nonStrikerId: reg(1),
        bowlerId: reg(2),
      }),
      event("ball", {
        strikerId: reg(0),
        nonStrikerId: reg(1),
        bowlerId: reg(2),
        runsBat: 0,
        extras: {},
      }),
    ]),
  ).toMatchObject({ ok: true });
  return id;
}
async function finished(kind: "finished" | "walkover" | "no_result" | "abandoned" = "walkover") {
  if (kind === "finished") {
    const id = await live();
    expect(
      await append(id, [
        event("innings_closed", { reason: "forfeit" }),
        event("innings_started", {
          inningsNo: 2,
          battingTeamId: away,
          strikerId: reg(2),
          nonStrikerId: reg(3),
          bowlerId: reg(1),
        }),
        event("ball", {
          strikerId: reg(2),
          nonStrikerId: reg(3),
          bowlerId: reg(1),
          runsBat: 1,
          extras: {},
        }),
        event("finish", {}),
      ]),
    ).toMatchObject({ ok: true });
    return { id, outcome: event("finish", {}) };
  }
  const id = await setup();
  const outcome =
    kind === "walkover"
      ? event("walkover", { winnerTeamId: home, reason: "Opponent absent" })
      : event("abandon", { kind, reason: "Rain" });
  expect(await append(id, [outcome, event("finish", {})])).toMatchObject({ ok: true });
  return { id, outcome };
}
const sweep = (ids: string[], at: Date) =>
  sweepScoring({ readDb: owner.db, handle: app, fixtureIds: ids, now: at });
beforeAll(async () => {
  await owner.db.insert(people).values(
    [actor, other, ...players].map((id) => ({
      id,
      name: "Sweep person",
      email: `sweep-${id}@example.test`,
    })),
  );
  await owner.db
    .insert(organizations)
    .values({ id: orgId, name: "Sweep club", slug: `sweep-${orgId}`, createdBy: actor });
  await owner.db.insert(orgMembers).values({ orgId, personId: actor });
  await owner.db.insert(competitions).values({
    id: competitionId,
    orgId,
    sport: "cricket",
    name: "Sweep cup",
    slug: `sweep-${competitionId}`,
    createdBy: actor,
  });
  await owner.db.insert(teams).values([
    { id: home, orgId, competitionId, name: "Home", createdBy: actor },
    { id: away, orgId, competitionId, name: "Away", createdBy: actor },
  ]);
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
      personId: other,
      scopeType: "tournament",
      scopeId: competitionId,
      capabilitySet: "fixture:scorer",
      grantedBy: actor,
    },
  ]);
  await owner.db.insert(registrations).values(
    players.map((personId, i) => ({
      id: reg(i),
      personId,
      orgId,
      competitionId,
      teamId: i < 2 ? home : away,
      status: "approved" as const,
      registrationNumber: `SWEEP-R${String(i)}`,
    })),
  );
});
beforeEach(() => vi.clearAllMocks());
afterAll(async () => {
  await purgeOrg(owner.db, orgId);
  for (const id of [actor, other, ...players])
    await owner.db.delete(people).where(eq(people.id, id));
  if (app !== owner) await app.sql.end();
  await owner.sql.end();
});
describe("API-8 scheduled scoring maintenance", () => {
  it("detects the same person playing across clubs without exposing unrelated or superseded matches", async () => {
    const id = await live();
    const [original] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
    const [fixture] = await owner.db.select().from(fixtures).where(eq(fixtures.id, id));
    const rows = await owner.db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.fixtureId, id))
      .orderBy(matchEvents.seq);
    if (!original || !fixture) throw new Error("missing match");
    const state = replayMatch(rows.map(persistedMatchEvent));
    const at = after(5000);
    const readOnlyDb = new Proxy(owner.db, {
      get(target, key, receiver) {
        if (["insert", "update", "delete", "execute"].includes(String(key)))
          throw new Error("Trust facts must not perform elevated writes");
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const window = playWindow(state, rows, at);
    expect(window).not.toBeNull();
    const foreignOrg = newId(),
      foreignSeason = newId(),
      foreignFixture = newId(),
      foreignHome = newId(),
      foreignAway = newId();
    const foreignRegs = regs.map(() => newId());
    const unrelated = players.map(() => newId());
    await owner.db.insert(people).values(
      unrelated.map((personId) => ({
        id: personId,
        name: "Unrelated player",
        email: `unrelated-${personId}@example.test`,
      })),
    );
    const mappings = [
      [id, foreignFixture],
      [orgId, foreignOrg],
      [competitionId, foreignSeason],
      [home, foreignHome],
      [away, foreignAway],
      ...regs.map((value, index) => [value, foreignRegs[index] ?? ""]),
    ];
    const remap = (value: unknown): unknown => {
      let text = JSON.stringify(value);
      for (const [source, target] of mappings) {
        if (!source || !target) throw new Error("invalid remapping");
        text = text.replaceAll(source, target);
      }
      return JSON.parse(text) as unknown;
    };
    await owner.db.insert(organizations).values({
      id: foreignOrg,
      name: "Other club",
      slug: `other-${foreignOrg}`,
      createdBy: actor,
    });
    try {
      await owner.db.insert(competitions).values({
        id: foreignSeason,
        orgId: foreignOrg,
        sport: "cricket",
        name: "Other cup",
        slug: `other-${foreignSeason}`,
        createdBy: actor,
      });
      await owner.db.insert(teams).values([
        {
          id: foreignHome,
          orgId: foreignOrg,
          competitionId: foreignSeason,
          name: "Other home",
          createdBy: actor,
        },
        {
          id: foreignAway,
          orgId: foreignOrg,
          competitionId: foreignSeason,
          name: "Other away",
          createdBy: actor,
        },
      ]);
      await owner.db.insert(registrations).values(
        players.map((personId, index) => {
          const registrationId = foreignRegs[index];
          if (!registrationId) throw new Error("missing registration");
          return {
            id: registrationId,
            personId,
            orgId: foreignOrg,
            competitionId: foreignSeason,
            teamId: index < 2 ? foreignHome : foreignAway,
            status: "approved" as const,
            registrationNumber: `FOREIGN-${String(index)}`,
          };
        }),
      );
      await owner.db.insert(fixtures).values({
        ...fixture,
        id: foreignFixture,
        orgId: foreignOrg,
        competitionId: foreignSeason,
        homeTeamId: foreignHome,
        awayTeamId: foreignAway,
      });
      await owner.db.insert(matches).values({
        ...original,
        fixtureId: foreignFixture,
        orgId: foreignOrg,
        competitionId: foreignSeason,
        shareToken: `other-${foreignFixture}`,
      });
      await owner.db.insert(matchEvents).values(
        rows.map((row) => ({
          ...row,
          fixtureId: foreignFixture,
          orgId: foreignOrg,
          competitionId: foreignSeason,
          payload: remap(row.payload),
        })),
      );
      expect(await overlappingPlay(fixture, state, window, at, readOnlyDb)).toBe(true);
      // The same people playing an actual second family must remain visible in both directions.
      await owner.db
        .update(competitions)
        .set({ sport: "badminton" })
        .where(eq(competitions.id, foreignSeason));
      const rallyPayloads: { type: MatchEvent["type"]; payload: unknown }[] = [
        {
          type: "match_started",
          payload: {
            format: RALLY_FORMAT_PRESETS.badminton_bo3,
            conditions: {},
            homeTeamId: foreignHome,
            awayTeamId: foreignAway,
          },
        },
        {
          type: "lineup_confirmed",
          payload: { teamId: foreignHome, players: foreignRegs.slice(0, 2) },
        },
        {
          type: "lineup_confirmed",
          payload: { teamId: foreignAway, players: foreignRegs.slice(2) },
        },
        {
          type: "rubber_started",
          payload: {
            rubberNo: 1,
            homePlayers: foreignRegs.slice(0, 2),
            awayPlayers: foreignRegs.slice(2),
            firstServer: "home",
          },
        },
        { type: "rally", payload: { winner: "home" } },
      ];
      const first = rows[0];
      if (!first) throw new Error("Missing event envelope");
      await owner.db.delete(matchEvents).where(eq(matchEvents.fixtureId, foreignFixture));
      await owner.db.insert(matchEvents).values(
        rallyPayloads.map((entry, index) => ({
          ...first,
          ...entry,
          fixtureId: foreignFixture,
          orgId: foreignOrg,
          competitionId: foreignSeason,
          eventId: newId(),
          seq: index + 1,
          clientSeq: index + 1,
          clientRecordedAt: now,
          receivedAt: now,
          targetEventId: null,
        })),
      );
      await owner.db
        .update(matches)
        .set({
          lastSeq: 5,
          format: RALLY_FORMAT_PRESETS.badminton_bo3,
          awardVersion: "unscored/rally/badminton_bo3",
        })
        .where(eq(matches.fixtureId, foreignFixture));
      const rallyRows = await owner.db
        .select()
        .from(matchEvents)
        .where(eq(matchEvents.fixtureId, foreignFixture))
        .orderBy(matchEvents.seq);
      const rallyState = rallyEngine.replay(rallyRows.map(persistedMatchEvent));
      expect(await overlappingPlay(fixture, state, window, at, readOnlyDb)).toBe(true);
      expect(
        await overlappingPlay(
          { id: foreignFixture, orgId: foreignOrg, competitionId: foreignSeason },
          rallyState,
          playWindow(rallyState, rallyRows, at),
          at,
          readOnlyDb,
        ),
      ).toBe(true);
      await owner.db
        .update(competitions)
        .set({ sport: "football" })
        .where(eq(competitions.id, foreignSeason));
      expect(await overlappingPlay(fixture, state, window, at, readOnlyDb)).toBe(false);
      await owner.db
        .update(competitions)
        .set({ sport: "table_tennis" })
        .where(eq(competitions.id, foreignSeason));
      expect(await overlappingPlay(fixture, state, window, at, readOnlyDb)).toBe(false);
      await owner.db
        .update(competitions)
        .set({ sport: "badminton" })
        .where(eq(competitions.id, foreignSeason));

      for (let index = 0; index < foreignRegs.length; index++) {
        const registrationId = foreignRegs[index],
          personId = unrelated[index];
        if (!registrationId || !personId) throw new Error("missing unrelated registration");
        await owner.db
          .update(registrations)
          .set({ personId })
          .where(eq(registrations.id, registrationId));
      }
      expect(await overlappingPlay(fixture, state, window, at, readOnlyDb)).toBe(false);
      for (let index = 0; index < foreignRegs.length; index++) {
        const registrationId = foreignRegs[index],
          personId = players[index];
        if (!registrationId || !personId) throw new Error("missing registration");
        await owner.db
          .update(registrations)
          .set({ personId })
          .where(eq(registrations.id, registrationId));
      }
      await owner.db
        .update(matches)
        .set({ attempt: 2 })
        .where(eq(matches.fixtureId, foreignFixture));
      expect(await overlappingPlay(fixture, state, window, at, readOnlyDb)).toBe(false);
      await owner.db
        .update(matches)
        .set({ attempt: 1, phase: "void" })
        .where(eq(matches.fixtureId, foreignFixture));
      expect(await overlappingPlay(fixture, state, window, at, readOnlyDb)).toBe(false);
      expect(
        await owner.db.select().from(auditLog).where(eq(auditLog.scopeId, foreignOrg)),
      ).toHaveLength(0);
    } finally {
      await purgeOrg(owner.db, foreignOrg);
      for (const personId of unrelated)
        await owner.db.delete(people).where(eq(people.id, personId));
      await owner.db.delete(fixtures).where(eq(fixtures.id, id));
    }
  });
  it("seals current terminal results after the inclusive edit boundary without rewriting or duplicate finalization", async () => {
    for (const kind of ["finished", "walkover", "no_result", "abandoned"] as const) {
      const { id } = await finished(kind);
      const [before] = await owner.db
        .select()
        .from(fixtureResults)
        .where(eq(fixtureResults.fixtureId, id));
      expect(await sweep([id], after(24 * 3600000))).toMatchObject({ finalized: 0, failures: [] });
      vi.clearAllMocks();
      expect(await sweep([id], after(24 * 3600000 + 1))).toMatchObject({
        finalized: 1,
        failures: [],
      });
      expect(revalidatePath).toHaveBeenCalledTimes(3);
      expect(
        (await owner.db.select().from(matches).where(eq(matches.fixtureId, id)))[0],
      ).toMatchObject({ phase: "final", finalizedAt: after(24 * 3600000 + 1) });
      expect(
        (await owner.db.select().from(fixtureResults).where(eq(fixtureResults.fixtureId, id)))[0],
      ).toEqual(before);
      expect(
        await owner.db
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.finalized"))),
      ).toHaveLength(1);
      const [snapshot] = await owner.db
        .select()
        .from(matchLiveState)
        .where(eq(matchLiveState.fixtureId, id));
      expect(snapshot?.state).toMatchObject({ phase: "final" });
      expect(await sweep([id], after(25 * 3600000))).toMatchObject({ finalized: 0 });
    }
  });
  it("repairs a lagging revision with a system audit and the actual correction actor, regardless of current holder", async () => {
    const { id, outcome } = await finished();
    // After finish only the finishing scorer or an organiser corrects (F09), so
    // the other person corrects here as an organiser of the club.
    const organiserGrant = newId();
    await owner.db.insert(grants).values({
      id: organiserGrant,
      personId: other,
      scopeType: "org",
      scopeId: orgId,
      capabilitySet: "org:owner",
      grantedBy: actor,
    });
    await owner.db.update(matches).set({ scorerPersonId: other }).where(eq(matches.fixtureId, id));
    try {
      expect(
        await append(
          id,
          [
            event(
              "amend",
              { payload: { winnerTeamId: away, reason: "Corrected" } },
              outcome.eventId,
            ),
          ],
          other,
        ),
      ).toMatchObject({ ok: true, acks: [{ status: "stored" }] });
    } finally {
      await owner.db.delete(grants).where(eq(grants.id, organiserGrant));
    }
    await owner.db.update(matches).set({ scorerPersonId: actor }).where(eq(matches.fixtureId, id));
    await owner.db
      .delete(auditLog)
      .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.finalized")));
    expect(await sweep([id], after(25 * 3600000))).toMatchObject({ finalized: 1, failures: [] });
    expect(
      (await owner.db.select().from(fixtureResults).where(eq(fixtureResults.fixtureId, id)))[0],
    ).toMatchObject({ recordedBy: other, winnerTeamId: away });
    const [audit] = await owner.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.finalized")));
    expect(audit?.actor).toBe(SCORING_SYSTEM_ACTOR);
  });
  it("keeps platform exclusion through sealing and refresh without redispatch or refinalization", async () => {
    const { id } = await finished("finished");
    const [initial] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
    if (!initial) throw new Error("missing match");
    const input = {
      fixtureId: id,
      orgId,
      personId: actor,
      attempt: initial.attempt,
      lastSeq: initial.lastSeq,
      reason: "Evidence requires a platform review",
      authority: "platform" as const,
      disposition: "exclude" as const,
    };
    expect(
      await withTenantDb(app, { personId: actor, orgId }, (db) => reviewMatchTrust(db, input, now)),
    ).toMatchObject({ ok: true, trust: "flagged" });
    const before = await owner.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.finalized")));
    expect(await sweep([id], after(49 * 3600000))).toMatchObject({
      finalized: 1,
      trustRefreshed: 0,
      failures: [],
    });
    expect(await sweep([id], after(50 * 3600000))).toMatchObject({
      finalized: 0,
      trustRefreshed: 0,
      failures: [],
    });
    const [held] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
    expect(held).toMatchObject({ phase: "final", trustLevel: "flagged", lastSeq: initial.lastSeq });
    const [snapshot] = await owner.db
      .select()
      .from(matchLiveState)
      .where(eq(matchLiveState.fixtureId, id));
    expect(snapshot?.state).toMatchObject({ trust: "flagged", seq: initial.lastSeq });
    expect(
      await owner.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.finalized"))),
    ).toHaveLength(before.length);
    expect(
      await withTenantDb(app, { personId: actor, orgId }, (db) =>
        reviewMatchTrust(
          db,
          { ...input, authority: "organizer", disposition: "verify" },
          after(50 * 3600000),
        ),
      ),
    ).toMatchObject({ ok: true, trust: "flagged" });
    expect(
      await withTenantDb(app, { personId: actor, orgId }, (db) =>
        reviewMatchTrust(db, { ...input, disposition: "verify" }, after(50 * 3600000)),
      ),
    ).toMatchObject({ ok: true, trust: "verified" });
  });
  it("refuses stale, foreign and unauthorized organizer review without evidence writes", async () => {
    const { id } = await finished();
    const [match] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
    if (!match) throw new Error("missing match");
    const input = {
      fixtureId: id,
      orgId,
      personId: other,
      attempt: match.attempt,
      lastSeq: match.lastSeq,
      reason: "Review against the recorded result",
      authority: "organizer" as const,
      disposition: "verify" as const,
    };
    for (const patch of [
      {},
      { personId: actor, lastSeq: match.lastSeq - 1 },
      { personId: actor, orgId: newId() },
    ]) {
      expect(
        await withTenantDb(app, { personId: patch.personId ?? other, orgId }, (db) =>
          reviewMatchTrust(db, { ...input, ...patch }, now),
        ),
      ).toMatchObject({ ok: false });
    }
    expect(
      await owner.db
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.subject, id), eq(auditLog.action, "match.trust.organizer_verified")),
        ),
    ).toHaveLength(0);
  });
  it("binds confirmation to the active opposing manager and preserves disputes across later confirmations", async () => {
    const { id } = await finished("finished");
    const [match] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
    if (!match) throw new Error("missing match");
    const authorityRows = await owner.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.trust.scoring_authority")));
    for (const row of authorityRows) {
      if (!row.meta || typeof row.meta !== "object") throw new Error("missing authority evidence");
      await owner.db
        .update(auditLog)
        .set({ meta: { ...row.meta, authority: "d", representedTeamIds: [home] } })
        .where(eq(auditLog.id, row.id));
    }
    const managerId = newId();
    await owner.db.insert(teamManagers).values({
      id: managerId,
      orgId,
      competitionId,
      teamId: away,
      personId: other,
      role: "captain",
      source: "organizer",
      createdBy: actor,
    });
    const token = confirmationToken(
      { fixtureId: id, teamId: away, attempt: match.attempt, lastSeq: match.lastSeq },
      now,
    );
    const boundaries = reminderBoundariesFor(app);
    await owner.db.update(people).set({ emailVerifiedAt: now }).where(eq(people.id, other));
    expect(await dispatchConfirmationNotices(orgId, id, boundaries, now)).toBe(1);
    expect(await dispatchConfirmationNotices(orgId, id, boundaries, now)).toBe(0);
    const [notice] = await owner.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.scopeId, other),
          eq(auditLog.action, "match.confirm_requested"),
          eq(
            auditLog.subject,
            `match.confirm_request:${id}:${String(match.attempt)}:${String(match.lastSeq)}:${away}:${other}`,
          ),
        ),
      );
    if (!notice) throw new Error("missing confirmation notice");
    expect(await confirmationHomeTask(actor, notice.id, boundaries, now)).toBeNull();
    expect(await confirmationHomeTask(other, notice.id, boundaries, now)).toMatchObject({
      state: "ready",
      scope: { orgId, competitionId, fixtureId: id, teamId: away },
    });
    expect(
      await confirmationHomeTask(other, notice.id, boundaries, after(7 * 24 * 3600000)),
    ).toBeNull();
    expect(await resolveConfirmationNoticeLink(actor, notice.id, boundaries, now)).toBeNull();
    expect(await resolveConfirmationNoticeLink(other, notice.id, boundaries, now)).toBe(
      `/match/confirm/${token}`,
    );
    expect(
      await resolveConfirmationNoticeLink(other, notice.id, boundaries, after(7 * 24 * 3600000)),
    ).toBeNull();
    const mail = await owner.db
      .select()
      .from(messageOutbox)
      .where(
        and(eq(messageOutbox.personId, other), eq(messageOutbox.kind, "match.confirm_request")),
      );
    expect(JSON.stringify(mail)).not.toContain(token);
    expect(mail).toHaveLength(1);
    const confirm = (personId: string, verdict: "confirmed" | "disputed", note = "") =>
      withTenantDb(app, { personId, orgId }, (db) =>
        confirmMatch(db, personId, token, verdict, note, now),
      );
    expect(await confirm(actor, "confirmed")).toMatchObject({ ok: false });
    expect(await confirm(other, "confirmed")).toMatchObject({ ok: true, trust: "confirmed" });
    expect(await confirmationHomeTask(other, notice.id, boundaries, now)).toMatchObject({
      state: "completed",
    });
    expect(await confirm(other, "disputed", "Recorded score differs from our notes")).toMatchObject(
      { ok: true, trust: "flagged" },
    );
    expect(await confirm(other, "confirmed")).toMatchObject({ ok: true, trust: "flagged" });
    expect(await confirmationHomeTask(other, notice.id, boundaries, now)).toMatchObject({
      state: "waiting",
    });
    expect(
      await withTenantDb(app, { personId: actor, orgId }, (db) =>
        reviewMatchTrust(
          db,
          {
            fixtureId: id,
            orgId,
            personId: actor,
            attempt: match.attempt,
            lastSeq: match.lastSeq,
            reason: "Reviewed both captains and the event evidence",
            authority: "organizer",
            disposition: "verify",
          },
          now,
        ),
      ),
    ).toMatchObject({ ok: true, trust: "verified" });
    expect(await confirmationHomeTask(other, notice.id, boundaries, now)).toMatchObject({
      state: "resolved",
    });
    expect(await confirm(other, "disputed", "Recorded score differs from our notes")).toMatchObject(
      { ok: true, trust: "flagged" },
    );
    expect(await confirmationHomeTask(other, notice.id, boundaries, now)).toMatchObject({
      state: "waiting",
    });
    const rows = await owner.db
      .select()
      .from(matchConfirmations)
      .where(eq(matchConfirmations.fixtureId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ personId: other, verdict: "disputed", teamId: away });
    const evidence = await owner.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.trust.confirmation")));
    expect(evidence).toHaveLength(4);
    expect(JSON.stringify(evidence)).not.toContain(token);
    await owner.db
      .update(teamManagers)
      .set({ revokedAt: now })
      .where(eq(teamManagers.id, managerId));
    expect(await confirm(other, "confirmed")).toMatchObject({ ok: false });
    expect(await confirmationHomeTask(other, notice.id, boundaries, now)).toBeNull();
    expect(await resolveConfirmationNoticeLink(other, notice.id, boundaries, now)).toBeNull();
    const send = vi.fn(() => Promise.resolve("sent" as const));
    await drainOutbox({ db: app.db, personIds: [other], now, mailer: { send } });
    expect(send).not.toHaveBeenCalled();
    expect(
      (
        await owner.db
          .select()
          .from(messageOutbox)
          .where(eq(messageOutbox.id, mail[0]?.id ?? ""))
      )[0]?.status,
    ).toBe("suppressed");
    await owner.db.delete(teamManagers).where(eq(teamManagers.id, managerId));
  });
  it("projects another eligible manager's response as the addressed team's completed obligation", async () => {
    const { id } = await finished("finished");
    const [match] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
    if (!match) throw new Error("missing match");
    const authorityRows = await owner.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.trust.scoring_authority")));
    for (const row of authorityRows) {
      if (!row.meta || typeof row.meta !== "object") throw new Error("authority evidence");
      await owner.db
        .update(auditLog)
        .set({ meta: { ...row.meta, authority: "d", representedTeamIds: [home] } })
        .where(eq(auditLog.id, row.id));
    }
    const respondingManager = players[0];
    if (!respondingManager) throw new Error("responding manager");
    const managerIds = [newId(), newId()];
    await owner.db.insert(teamManagers).values(
      [respondingManager, other].map((personId, index) => ({
        id: managerIds[index] ?? newId(),
        orgId,
        competitionId,
        teamId: away,
        personId,
        role: "captain" as const,
        source: "organizer" as const,
        createdBy: actor,
      })),
    );
    try {
      const boundaries = reminderBoundariesFor(app);
      await dispatchConfirmationNotices(orgId, id, boundaries, now);
      const [notice] = await owner.db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.scopeId, other),
            eq(auditLog.action, "match.confirm_requested"),
            eq(
              auditLog.subject,
              `match.confirm_request:${id}:${String(match.attempt)}:${String(match.lastSeq)}:${away}:${other}`,
            ),
          ),
        );
      if (!notice) throw new Error("recipient notice");
      expect(await confirmationHomeTask(other, notice.id, boundaries, now)).toMatchObject({
        state: "ready",
      });
      const token = confirmationToken(
        { fixtureId: id, teamId: away, attempt: match.attempt, lastSeq: match.lastSeq },
        now,
      );
      expect(
        await withTenantDb(app, { personId: respondingManager, orgId }, (db) =>
          confirmMatch(db, respondingManager, token, "confirmed", "", now),
        ),
      ).toMatchObject({ ok: true });
      expect(await confirmationHomeTask(other, notice.id, boundaries, now)).toMatchObject({
        state: "completed",
        scope: { teamId: away },
      });
      expect(await resolveConfirmationNoticeLink(other, notice.id, boundaries, now)).toBe(
        `/match/confirm/${token}`,
      );
      // Recipient ownership remains distinct even when that actor fulfilled the team request.
      expect(await confirmationHomeTask(respondingManager, notice.id, boundaries, now)).toBeNull();
    } finally {
      for (const managerId of managerIds)
        await owner.db.delete(teamManagers).where(eq(teamManagers.id, managerId));
    }
  });
  it("automatically confirms exactly at 48 hours with complete pace receipts but no inferred scorer authority", async () => {
    const { id } = await finished("finished");
    await owner.db
      .delete(auditLog)
      .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.trust.scoring_authority")));
    await owner.db.update(matches).set({ viewerPeak: 15 }).where(eq(matches.fixtureId, id));
    const [before] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
    expect(await sweep([id], after(48 * 3600000 - 1))).toMatchObject({
      finalized: 1,
      trustRefreshed: 1,
      failures: [],
    });
    expect(
      (await owner.db.select().from(matches).where(eq(matches.fixtureId, id)))[0]?.trustLevel,
    ).toBe("self_scored");
    expect(await sweep([id], after(48 * 3600000))).toMatchObject({
      finalized: 0,
      trustRefreshed: 1,
      failures: [],
    });
    const [match] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
    const [snapshot] = await owner.db
      .select()
      .from(matchLiveState)
      .where(eq(matchLiveState.fixtureId, id));
    expect(match).toMatchObject({
      phase: "final",
      trustLevel: "confirmed",
      lastSeq: before?.lastSeq,
    });
    expect(snapshot?.state).toMatchObject({ trust: "confirmed", seq: before?.lastSeq });
    expect(await sweep([id], after(49 * 3600000))).toMatchObject({
      finalized: 0,
      trustRefreshed: 0,
      failures: [],
    });
    expect(
      await owner.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.trust.scoring_authority"))),
    ).toHaveLength(0);
  });
  it("resets the automatic confirmation clock after an accepted finished correction", async () => {
    const { id } = await finished("finished");
    await owner.db
      .delete(auditLog)
      .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.trust.scoring_authority")));
    await owner.db.update(matches).set({ viewerPeak: 15 }).where(eq(matches.fixtureId, id));
    const rows = await owner.db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.fixtureId, id))
      .orderBy(matchEvents.seq);
    const ball = rows.find((row) => row.type === "ball");
    if (!ball) throw new Error("missing ball");
    const correction = event("amend", { payload: ball.payload }, ball.eventId);
    expect(
      await appendScoringRequest(
        app,
        { personId: actor, orgId },
        id,
        { deviceId, attempt: 1, events: [correction] },
        after(3600000),
      ),
    ).toMatchObject({ ok: true });
    const [revised] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
    expect(revised?.lastSeq).toBe((rows.at(-1)?.seq ?? 0) + 1);
    expect(await sweep([id], after(48 * 3600000))).toMatchObject({ failures: [] });
    expect(
      (await owner.db.select().from(matches).where(eq(matches.fixtureId, id)))[0]?.trustLevel,
    ).toBe("self_scored");
    expect(await sweep([id], after(49 * 3600000 - 1))).toMatchObject({
      trustRefreshed: 0,
      failures: [],
    });
    expect(await sweep([id], after(49 * 3600000))).toMatchObject({
      trustRefreshed: 1,
      failures: [],
    });
    expect(
      (await owner.db.select().from(matches).where(eq(matches.fixtureId, id)))[0]?.trustLevel,
    ).toBe("confirmed");
  });
  it("stalls after six hours of event silence with one system audit and a matching snapshot", async () => {
    const id = await live();
    const receipts = await owner.db
      .select({ at: matchEvents.receivedAt })
      .from(matchEvents)
      .where(eq(matchEvents.fixtureId, id));
    const silenceFrom = Math.max(...receipts.map((r) => r.at.getTime()));
    expect(await sweep([id], new Date(silenceFrom + 6 * 3600000 - 1))).toMatchObject({
      stalled: 0,
    });
    expect(await sweep([id], new Date(silenceFrom + 6 * 3600000))).toMatchObject({
      stalled: 1,
      failures: [],
    });
    expect((await owner.db.select().from(matches).where(eq(matches.fixtureId, id)))[0]?.phase).toBe(
      "stalled",
    );
    const [audit] = await owner.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.subject, id), eq(auditLog.action, "match.stalled")));
    expect(audit?.actor).toBe(SCORING_SYSTEM_ACTOR);
    expect(
      (await owner.db.select().from(matchLiveState).where(eq(matchLiveState.fixtureId, id)))[0]
        ?.state,
    ).toMatchObject({ phase: "stalled" });
    expect(await sweep([id], after(7 * 3600000))).toMatchObject({ stalled: 0 });
  });
  it("deduplicates quiet notices for thirty minutes, including simultaneous jobs", async () => {
    const id = await live();
    expect(await sweep([id], after(15 * 60000 - 1))).toMatchObject({ quiet: 0 });
    const runs = await Promise.all([
      sweep([id], after(15 * 60000)),
      sweep([id], after(15 * 60000)),
    ]);
    expect(runs.reduce((sum, r) => sum + (typeof r.quiet === "number" ? r.quiet : 0), 0)).toBe(1);
    expect(await sweep([id], after(44 * 60000))).toMatchObject({ quiet: 0 });
    expect(await sweep([id], after(46 * 60000))).toMatchObject({ quiet: 1 });
    expect(
      await owner.db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.scopeId, actor),
            eq(auditLog.subject, id),
            eq(auditLog.action, "match.quiet"),
          ),
        ),
    ).toHaveLength(2);
  });
  it("isolates a malformed match and independently maintains another candidate", async () => {
    const { id: bad } = await finished();
    await owner.db.update(matches).set({ lastSeq: 999 }).where(eq(matches.fixtureId, bad));
    const good = await live();
    const result = await sweep([bad, good], after(25 * 3600000));
    expect(result).toMatchObject({ finalized: 0, stalled: 1 });
    expect(result.failures).toContain(`seal:${bad}`);
    expect(
      (await owner.db.select().from(matches).where(eq(matches.fixtureId, bad)))[0]?.phase,
    ).toBe("walkover");
  });
  it("serializes with a correction and refuses to seal a restarted revision or void outcome", async () => {
    const { id, outcome } = await finished();
    const correction = event(
      "amend",
      { payload: { winnerTeamId: away, reason: "Last edit" } },
      outcome.eventId,
    );
    const [sealed] = await Promise.all([
      sweep([id], after(25 * 3600000)),
      append(id, [correction]),
    ]);
    expect(sealed.failures).toEqual([]);
    const [match] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
    expect(match?.phase).toBe("final");
    const [result] = await owner.db
      .select()
      .from(fixtureResults)
      .where(eq(fixtureResults.fixtureId, id));
    expect([home, away]).toContain(result?.winnerTeamId);
    const restarted = await finished();
    await owner.db.update(matches).set({ attempt: 2 }).where(eq(matches.fixtureId, restarted.id));
    await expect(
      withTenantDb(app, { personId: SCORING_SYSTEM_ACTOR, orgId }, (db) =>
        sealScoring(db, restarted.id, after(25 * 3600000)),
      ),
    ).rejects.toThrow("revision is inconsistent");
    const voided = await finished();
    await owner.db.update(matches).set({ phase: "void" }).where(eq(matches.fixtureId, voided.id));
    expect(await sweep([voided.id], after(25 * 3600000))).toMatchObject({ finalized: 0 });
  });
});
