import {
  publicLiveState,
  publicScorecard,
  publicCharts,
  overlayProjection,
  replayMatch,
  REJECT_MESSAGES,
  type MatchEvent,
} from "@desiauction/core/scoring";
import {
  auditLog,
  competitions,
  createDb,
  fixtures,
  grants,
  matches,
  matchEvents,
  matchLiveState,
  newId,
  organizations,
  people,
  registrations,
  teams,
  withTenantDb,
} from "@desiauction/db";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../../env";
import { purgeOrg } from "../test-support/purge-org";
import { appendScoringEvents, persistedMatchEvent, type ClientEvent } from "./append";
import {
  matchAgeDate,
  scoringNames,
  type LiveHistoryEntry,
  type StoredLiveState,
} from "./live-state";
import { startScoredMatch } from "./start";
import { addScoringGuest, GuestRefusal } from "./guests";
import { claimScoring } from "./claim";

const owner = createDb(env.DATABASE_URL);
const app = env.APP_DATABASE_URL ? createDb(env.APP_DATABASE_URL) : owner;
const actor = newId();
const other = newId();
const organiser = newId();
const playerIds = Array.from({ length: 7 }, () => newId());
const registrationIds = playerIds.map(() => newId());
function reg(index: number): string {
  const id = registrationIds[index];
  if (!id) throw new Error("Missing registration");
  return id;
}
const orgId = newId();
const competitionId = newId();
const home = newId();
const away = newId();
const deviceId = "append-device";
const now = new Date();
const within = <T>(personId: string, fn: (db: typeof owner.db) => Promise<T>) =>
  withTenantDb(app, { personId, orgId }, fn);
let fixtureSeq = 0;
let clientSeq = 0;
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
    clientRecordedAt: new Date(now.getTime() - 3_600_000 + clientSeq * 1000).toISOString(),
  } as ClientEvent;
}
async function setup() {
  const id = newId();
  fixtureSeq += 1;
  await owner.db.insert(fixtures).values({
    id,
    orgId,
    competitionId,
    fixtureNumber: `APP-${String(fixtureSeq)}`,
    seq: fixtureSeq,
    homeTeamId: home,
    awayTeamId: away,
    status: "published",
    kickoffAt: "2026-10-09T12:00",
    createdBy: organiser,
  });
  // Each append fixture starts with unknown profiles; explicit style events in an
  // earlier test must not add initial seeds to this fixture's sequence/rate proof.
  await owner.db
    .update(registrations)
    .set({ battingStyle: null, bowlingStyle: null })
    .where(inArray(registrations.id, registrationIds));
  const result = await within(actor, (db) =>
    startScoredMatch(db, id, actor, {
      deviceId,
      formatKey: "t20",
      conditions: {},
      lineups: [
        {
          teamId: home,
          battingOrder: registrationIds.slice(0, 2),
          captainId: reg(0),
          keeperId: reg(1),
          substitutes: [],
        },
        {
          teamId: away,
          battingOrder: registrationIds.slice(2),
          captainId: reg(2),
          keeperId: reg(3),
          substitutes: [],
        },
      ],
    }),
  );
  expect(result.ok).toBe(true);
  return id;
}
function append(
  id: string,
  events: ClientEvent[],
  personId = actor,
  device = deviceId,
  time = now,
) {
  return within(personId, (db) =>
    appendScoringEvents(db, id, personId, { deviceId: device, attempt: 1, events }, time),
  );
}
async function storedEvents(id: string) {
  return (
    await owner.db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.fixtureId, id))
      .orderBy(matchEvents.seq)
  ).map(persistedMatchEvent);
}
async function snapshot(id: string) {
  const [row] = await owner.db
    .select()
    .from(matchLiveState)
    .where(eq(matchLiveState.fixtureId, id));
  if (!row) throw new Error("Missing live snapshot");
  return {
    ...row,
    state: row.state as StoredLiveState,
    history: row.history as LiveHistoryEntry[],
  };
}
beforeAll(async () => {
  await owner.db.insert(people).values(
    [actor, other, organiser, ...playerIds].map((id) => ({
      id,
      name: "Full Player Name",
      email: `append-${id}@example.test`,
    })),
  );
  await owner.db
    .insert(organizations)
    .values({ id: orgId, name: "Append club", slug: `append-${orgId}`, createdBy: organiser });
  await owner.db.insert(competitions).values({
    id: competitionId,
    orgId,
    name: "Append cup",
    slug: `append-${competitionId}`,
    sport: "cricket",
    createdBy: organiser,
  });
  await owner.db.insert(teams).values([
    { id: home, orgId, competitionId, name: "Home", createdBy: organiser },
    { id: away, orgId, competitionId, name: "Away", createdBy: organiser },
  ]);
  await owner.db.insert(grants).values([
    ...[actor, other].map((personId) => ({
      id: newId(),
      personId,
      scopeType: "tournament" as const,
      scopeId: competitionId,
      capabilitySet: "fixture:scorer",
      grantedBy: organiser,
    })),
    {
      id: newId(),
      personId: organiser,
      scopeType: "org",
      scopeId: orgId,
      capabilitySet: "org:owner",
      grantedBy: organiser,
    },
  ]);
  await owner.db.insert(registrations).values(
    playerIds.map((personId, index) => ({
      id: reg(index),
      personId,
      orgId,
      competitionId,
      teamId: index < 2 ? home : away,
      registrationNumber: `APP-R${String(index)}`,
      status: "approved" as const,
    })),
  );
});
afterAll(async () => {
  await purgeOrg(owner.db, orgId);
  for (const id of [actor, other, organiser, ...playerIds])
    await owner.db.delete(people).where(eq(people.id, id));
  if (app !== owner) await app.sql.end();
  await owner.sql.end();
});

describe("API-1 append events", () => {
  // Three fixtures and ~250 appends, each a full transaction: well past the 5 s default on a shared CI runner.
  it("120 balls batched by 1, 7 and 50 produce the same canonical public state", async () => {
    const first = await setup();
    const initial = await storedEvents(first);
    const stream: ClientEvent[] = [];
    let state = replayMatch(initial);
    const push = (entry: ClientEvent) => {
      stream.push(entry);
      state = replayMatch([
        ...initial,
        ...stream.map((item, index) => ({ ...item, actorPersonId: actor, seq: index + 4 })),
      ]);
    };
    push(event("toss", { winnerTeamId: home, decision: "bat" }));
    push(
      event("innings_started", {
        inningsNo: 1,
        battingTeamId: home,
        strikerId: reg(0),
        nonStrikerId: reg(1),
        bowlerId: reg(2),
      }),
    );
    for (let ball = 0; ball < 120; ball += 1) {
      if (ball > 0 && ball % 6 === 0)
        push(
          event("bowler_set", { bowlerId: reg(2 + (Math.floor(ball / 6) % 5)), midOver: false }),
        );
      const innings = state.innings.at(-1);
      if (!innings) throw new Error("Missing innings");
      push(
        event("ball", {
          strikerId: innings.strikerId,
          nonStrikerId: innings.nonStrikerId,
          bowlerId: innings.bowlerId,
          runsBat: 0,
          extras: {},
        }),
      );
    }
    const names = await scoringNames(
      owner.db,
      competitionId,
      matchAgeDate("2026-10-09T12:00", null),
    );
    const expected = { ...publicLiveState(state, names), updatedAt: now.toISOString() };
    for (const size of [1, 7, 50]) {
      const id = size === 1 ? first : await setup();
      for (let offset = 0; offset < stream.length; offset += size) {
        const result = await append(id, stream.slice(offset, offset + size));
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.acks.every((ack) => ack.status === "stored")).toBe(true);
      }
      const live = await snapshot(id);
      const { scorecard, charts, overlay, ...publicState } = live.state;
      const history = live.history;
      expect(live.state).not.toHaveProperty("history");
      expect(publicState).toEqual(expected);
      expect(scorecard).toEqual(publicScorecard(state, names));
      expect(charts).toEqual(publicCharts(state, names));
      expect(overlay).toEqual(overlayProjection(state));
      for (const entry of history) expect(entry.overlay?.seq).toBe(entry.state.seq);
      for (const entry of history) expect(entry.charts?.seq).toBe(entry.state.seq);
      for (const entry of history) expect(entry.scorecard?.seq).toBe(entry.state.seq);
      expect(history.at(-1)?.state).toEqual(expected);
      expect(history.at(-1)?.scorecard).toEqual(scorecard);
      expect(history.at(-1)?.charts).toEqual(charts);
      expect(history.length).toBe(Math.min(30, Math.ceil(stream.length / size)));
      expect(live.seq).toBe(state.lastSeq);
      expect(
        (await owner.db.select().from(matches).where(eq(matches.fixtureId, id)))[0]?.lastSeq,
      ).toBe(live.seq);
    }
  }, 30_000);
  it("notifies only committed accepted app-role appends, never rollback or duplicate", async () => {
    const id = await setup();
    const received: string[] = [];
    const listener = await owner.sql.listen("match_live", (payload) => {
      if (payload.startsWith(id + ":")) received.push(payload);
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 75));
    try {
      const committed = event("style_set", { registrationId: reg(0), battingHand: "right" });
      await within(actor, async (db) => {
        expect(
          await appendScoringEvents(
            db,
            id,
            actor,
            { deviceId, attempt: 1, events: [committed] },
            now,
          ),
        ).toMatchObject({ ok: true, lastSeq: 4 });
        expect(received).toEqual([]);
      });
      await settle();
      expect(received).toEqual([id + ":4"]);
      await append(id, [committed]);
      await settle();
      expect(received).toEqual([id + ":4"]);
      const rolledBack = event("style_set", { registrationId: reg(1), battingHand: "left" });
      await expect(
        within(actor, async (db) => {
          expect(
            await appendScoringEvents(
              db,
              id,
              actor,
              { deviceId, attempt: 1, events: [rolledBack] },
              now,
            ),
          ).toMatchObject({ ok: true, lastSeq: 5 });
          throw new Error("rollback notification proof");
        }),
      ).rejects.toThrow("rollback notification proof");
      await settle();
      expect(received).toEqual([id + ":4"]);
      expect((await snapshot(id)).seq).toBe(4);
    } finally {
      await listener.unlisten();
    }
  });
  it("duplicates consume no sequence, snapshot entry or capacity", async () => {
    const id = await setup();
    const entry = event("style_set", { registrationId: reg(0), battingHand: "right" });
    expect(await append(id, [entry])).toMatchObject({
      ok: true,
      lastSeq: 4,
      acks: [{ status: "stored", seq: 4 }],
    });
    expect(await append(id, [entry, entry])).toMatchObject({
      ok: true,
      lastSeq: 4,
      acks: [
        { status: "duplicate", seq: 4 },
        { status: "duplicate", seq: 4 },
      ],
    });
    expect((await snapshot(id)).history).toHaveLength(1);
    expect(await storedEvents(id)).toHaveLength(4);
  });
  it("stores earlier accepted entries, rejects the illegal event and skips later entries", async () => {
    const id = await setup();
    const good = event("style_set", { registrationId: reg(0), battingHand: "right" });
    const bad = event("ball", {
      strikerId: reg(0),
      nonStrikerId: reg(1),
      bowlerId: reg(2),
      runsBat: 11,
      extras: {},
    });
    const later = event("style_set", { registrationId: reg(1), battingHand: "left" });
    const result = await append(id, [good, bad, later]);
    expect(result).toMatchObject({
      ok: true,
      lastSeq: 4,
      acks: [
        { status: "stored" },
        {
          status: "rejected",
          reason: "runs_out_of_range",
          message: REJECT_MESSAGES.runs_out_of_range,
        },
        { status: "rejected", message: "Skipped after an earlier refusal." },
      ],
    });
    expect((await storedEvents(id)).map((item) => item.eventId)).not.toContain(bad.eventId);
    expect((await storedEvents(id)).map((item) => item.eventId)).not.toContain(later.eventId);
  });
  it("refuses a cricket player added from another season, even an approved one", async () => {
    const id = await setup();
    const elsewhere = newId();
    const elsewhereTeam = newId();
    const outsider = newId();
    const outsiderRegistration = newId();
    await owner.db.insert(competitions).values({
      id: elsewhere,
      orgId,
      name: "Another cup",
      slug: `append-other-${elsewhere}`,
      sport: "cricket",
      createdBy: organiser,
    });
    await owner.db.insert(teams).values({
      id: elsewhereTeam,
      orgId,
      competitionId: elsewhere,
      name: "Other",
      createdBy: organiser,
    });
    await owner.db.insert(people).values({
      id: outsider,
      name: "Other Season Player",
      email: `append-${outsider}@example.test`,
    });
    await owner.db.insert(registrations).values({
      id: outsiderRegistration,
      personId: outsider,
      orgId,
      competitionId: elsewhere,
      teamId: elsewhereTeam,
      registrationNumber: "APP-OTHER",
      status: "approved",
    });
    try {
      const added = event("player_added", { teamId: home, registrationId: outsiderRegistration });
      const result = await append(id, [added]);
      expect(result).toMatchObject({
        ok: true,
        acks: [{ status: "rejected", reason: "bad_payload" }],
      });
      expect((await storedEvents(id)).map((item) => item.eventId)).not.toContain(added.eventId);
    } finally {
      await owner.db.delete(registrations).where(eq(registrations.id, outsiderRegistration));
      await owner.db.delete(teams).where(eq(teams.id, elsewhereTeam));
      await owner.db.delete(competitions).where(eq(competitions.id, elsewhere));
      await owner.db.delete(people).where(eq(people.id, outsider));
    }
  });
  it("refuses a non-holder, wrong device and wrong attempt", async () => {
    const id = await setup();
    const entry = event("style_set", { registrationId: reg(0), battingHand: "right" });
    expect(await append(id, [entry], other)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await append(id, [entry], actor, "wrong-device")).toMatchObject({
      ok: false,
      error: "forbidden",
    });
    expect(
      await within(actor, (db) =>
        appendScoringEvents(db, id, actor, {
          deviceId,
          attempt: 2,
          events: [{ ...entry, attempt: 2 }],
        }),
      ),
    ).toMatchObject({ ok: false, error: "wrong_attempt" });
  });
  it("serializes concurrent batches and their snapshots", async () => {
    const id = await setup();
    const entries = [
      event("style_set", { registrationId: reg(0), battingHand: "right" }),
      event("style_set", { registrationId: reg(1), battingHand: "left" }),
    ];
    const results = await Promise.all(entries.map((entry) => append(id, [entry])));
    expect(results.every((result) => result.ok)).toBe(true);
    expect((await storedEvents(id)).map((item) => item.seq)).toEqual([1, 2, 3, 4, 5]);
    expect((await snapshot(id)).seq).toBe(5);
  });
  it("enforces the DB-counted 300-event minute while still acknowledging a retry", async () => {
    const id = await setup();
    const entries = Array.from({ length: 297 }, () =>
      event("style_set", { registrationId: reg(0), battingHand: "right" }),
    );
    for (let offset = 0; offset < entries.length; offset += 50)
      expect((await append(id, entries.slice(offset, offset + 50))).ok).toBe(true);
    expect(
      await append(id, [event("style_set", { registrationId: reg(1), battingHand: "left" })]),
    ).toMatchObject({ ok: false, error: "rate_limited" });
    const last = entries.at(-1);
    if (!last) throw new Error("Missing event");
    expect(await append(id, [last])).toMatchObject({
      ok: true,
      lastSeq: 300,
      acks: [{ status: "duplicate" }],
    });
  });
  it("after finish only the scorer who finished or an organiser corrects, and nobody forces the claim", async () => {
    const id = await setup();
    const style = event("style_set", { registrationId: reg(0), battingHand: "right" });
    const walkover = event("walkover", { winnerTeamId: home, reason: "Opponent absent" });
    expect((await append(id, [style, walkover, event("finish", {})])).ok).toBe(true);
    const later = new Date(now.getTime() + 10 * 60_000);
    expect(
      await within(other, (db) =>
        claimScoring(db, id, other, { deviceId: "other-device", mode: "force" }, later),
      ),
    ).toMatchObject({ ok: false, error: "claim_held" });
    // However the claim moved (a handover), the new holder did not finish it.
    await owner.db
      .update(matches)
      .set({ scorerPersonId: other, scorerDeviceId: "other-device" })
      .where(eq(matches.fixtureId, id));
    expect(
      await append(id, [event("void", {}, style.eventId)], other, "other-device", later),
    ).toMatchObject({ ok: true, acks: [{ status: "rejected", reason: "already_finished" }] });
    expect(
      await within(organiser, (db) =>
        claimScoring(db, id, organiser, { deviceId: "organiser-device", mode: "force" }, later),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await append(id, [event("void", {}, style.eventId)], organiser, "organiser-device", later),
    ).toMatchObject({ ok: true, acks: [{ status: "stored" }] });
    await owner.db
      .update(matches)
      .set({ scorerPersonId: actor, scorerDeviceId: deviceId })
      .where(eq(matches.fixtureId, id));
    expect(
      await append(
        id,
        [
          event(
            "amend",
            { payload: { winnerTeamId: away, reason: "Corrected winner" } },
            walkover.eventId,
          ),
        ],
        actor,
        deviceId,
        later,
      ),
    ).toMatchObject({ ok: true, acks: [{ status: "stored" }] });
  });
  it("accepts finished corrections within the window, refuses expired edits and restricts final edits to organisers", async () => {
    const id = await setup();
    const style = event("style_set", { registrationId: reg(0), battingHand: "right" });
    const walkover = event("walkover", { winnerTeamId: home, reason: "Opponent absent" });
    expect((await append(id, [style, walkover, event("finish", {})])).ok).toBe(true);
    expect(
      (await owner.db.select().from(matches).where(eq(matches.fixtureId, id)))[0]?.finishedAt,
    ).toEqual(now);
    expect(
      await append(id, [
        event("void", {}, style.eventId),
        event(
          "amend",
          { payload: { winnerTeamId: away, reason: "Corrected winner" } },
          walkover.eventId,
        ),
      ]),
    ).toMatchObject({ ok: true, acks: [{ status: "stored" }, { status: "stored" }] });
    expect(
      await append(
        id,
        [
          event(
            "amend",
            { payload: { winnerTeamId: home, reason: "Late correction" } },
            walkover.eventId,
          ),
        ],
        actor,
        deviceId,
        new Date(now.getTime() + 24 * 3_600_000 + 1),
      ),
    ).toMatchObject({ ok: true, acks: [{ status: "rejected", reason: "already_finished" }] });
    await owner.db.update(matches).set({ phase: "final" }).where(eq(matches.fixtureId, id));
    expect(
      await append(id, [
        event(
          "amend",
          { payload: { winnerTeamId: home, reason: "Final correction" } },
          walkover.eventId,
        ),
      ]),
    ).toMatchObject({ ok: true, acks: [{ status: "rejected", reason: "already_finished" }] });
    await owner.db
      .update(matches)
      .set({ scorerPersonId: organiser, scorerDeviceId: "organiser-device" })
      .where(eq(matches.fixtureId, id));
    expect(
      await append(
        id,
        [
          event(
            "amend",
            { payload: { winnerTeamId: home, reason: "Organiser correction" } },
            walkover.eventId,
          ),
        ],
        organiser,
        "organiser-device",
      ),
    ).toMatchObject({ ok: true, phase: "final", acks: [{ status: "stored" }] });
  });
  it("rejects malformed envelopes and inherited property names before any insert", async () => {
    const id = await setup();
    const valid = event("style_set", { registrationId: reg(0), battingHand: "right" });
    for (const type of ["toString", "constructor", "__proto__", "unknown"]) {
      expect(
        await within(actor, (db) =>
          appendScoringEvents(db, id, actor, {
            deviceId,
            attempt: 1,
            events: [{ ...valid, type }],
          }),
        ),
      ).toMatchObject({ ok: false, error: "bad_payload" });
    }
    expect(await storedEvents(id)).toHaveLength(3);
  });
  it("uses the historical match date and withholds minor or unconfirmed-age photos", async () => {
    const date = matchAgeDate("2026-10-09T00:01", null);
    expect(matchAgeDate(null, new Date("2026-10-08T18:30:00Z"))).toEqual(date);
    expect(() => matchAgeDate(null, null)).toThrow();
    await owner.db
      .update(registrations)
      .set({
        dateOfBirth: "2008-10-09",
        enteredPhotoKey: "test/photo.jpg",
        enteredPhotoConsentAt: now,
        adultConfirmedAt: now,
      })
      .where(eq(registrations.id, reg(0)));
    expect((await scoringNames(owner.db, competitionId, date)).players[reg(0)]?.name).toBe(
      "Full Player Name",
    );
    expect(
      (await scoringNames(owner.db, competitionId, matchAgeDate("2026-10-08T23:59", null))).players[
        reg(0)
      ],
    ).toMatchObject({ name: "FN", photoUrl: null });
    await owner.db
      .update(registrations)
      .set({ dateOfBirth: null, adultConfirmedAt: null })
      .where(eq(registrations.id, reg(0)));
    expect((await scoringNames(owner.db, competitionId, date)).players[reg(0)]).toMatchObject({
      name: "Full Player Name",
      photoUrl: null,
    });
    await owner.db
      .update(registrations)
      .set({ adultConfirmedAt: new Date("2026-10-10T00:00Z") })
      .where(eq(registrations.id, reg(0)));
    expect(
      (await scoringNames(owner.db, competitionId, date)).players[reg(0)]?.photoUrl,
    ).toBeNull();
    await owner.db
      .update(registrations)
      .set({ adultConfirmedAt: new Date("2026-10-08T00:00Z") })
      .where(eq(registrations.id, reg(0)));
    const names = await scoringNames(owner.db, competitionId, date);
    expect(names.players[reg(0)]?.photoUrl).not.toBeNull();
    expect(Object.keys(names.players[reg(0)] ?? {}).sort()).toEqual([
      "initials",
      "name",
      "photoUrl",
    ]);
  });
});

describe("API-6/7 guest players and persisted styles", () => {
  it("creates an approved team registration through the aggregate without contact or a notice", async () => {
    const id = await setup();
    const result = await within(actor, (db) =>
      addScoringGuest(db, id, actor, {
        teamId: home,
        name: "Guest Batter",
        phone: "+919999999999",
      }),
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.message);
    const [registration] = await owner.db
      .select()
      .from(registrations)
      .where(eq(registrations.id, result.registrationId));
    expect(registration).toMatchObject({ status: "approved", teamId: home, reviewedBy: actor });
    if (!registration) throw new Error("registration");
    const [person] = await owner.db
      .select()
      .from(people)
      .where(eq(people.id, registration.personId));
    expect(person).toMatchObject({
      clubOrgId: orgId,
      name: "Guest Batter",
      phone: null,
      email: null,
    });
    const audit = await owner.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.subject, result.registrationId));
    expect(audit.map((a) => a.action).sort()).toEqual([
      "registration.added",
      "registration.approve",
      "registration.team_assigned",
    ]);
    expect(audit.find((a) => a.action === "registration.added")?.meta).toMatchObject({
      source: "scorer_guest",
    });
    expect(
      await owner.db.select().from(auditLog).where(eq(auditLog.scopeId, registration.personId)),
    ).toHaveLength(0);
    await expect(
      within(actor, (db) => addScoringGuest(db, id, actor, { teamId: home, name: "Guest Batter" })),
    ).rejects.toBeInstanceOf(GuestRefusal);
    expect(
      await within(playerIds[0] ?? "", (db) =>
        addScoringGuest(db, id, playerIds[0] ?? "", { teamId: home, name: "Refused player" }),
      ),
    ).toMatchObject({ ok: false, error: "forbidden" });
    expect(
      await within(actor, (db) =>
        addScoringGuest(db, id, actor, { teamId: newId(), name: "Wrong team" }),
      ),
    ).toMatchObject({ ok: false, error: "wrong_team" });
  });
  it("rolls back person, registration and audits when the existing approval ceiling refuses", async () => {
    const id = await setup();
    const approved = await owner.db
      .select({ id: registrations.id })
      .from(registrations)
      .where(
        and(eq(registrations.competitionId, competitionId), eq(registrations.status, "approved")),
      );
    const ids = Array.from({ length: 40 - approved.length }, () => newId());
    await owner.db
      .insert(people)
      .values(ids.map((personId) => ({ id: personId, name: "Ceiling filler", clubOrgId: orgId })));
    const regs = ids.map((personId) => ({
      id: newId(),
      personId,
      orgId,
      competitionId,
      status: "approved" as const,
      teamId: away,
    }));
    await owner.db.insert(registrations).values(regs);
    const beforePeople = await owner.db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.clubOrgId, orgId));
    const beforeRegs = await owner.db
      .select({ id: registrations.id })
      .from(registrations)
      .where(eq(registrations.competitionId, competitionId));
    const beforeAudit = await owner.db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.scopeId, orgId));
    try {
      await expect(
        within(actor, (db) =>
          addScoringGuest(db, id, actor, { teamId: home, name: "Over the ceiling" }),
        ),
      ).rejects.toMatchObject({ reason: "tier_limit" });
      expect(
        await owner.db.select({ id: people.id }).from(people).where(eq(people.clubOrgId, orgId)),
      ).toHaveLength(beforePeople.length);
      expect(
        await owner.db
          .select({ id: registrations.id })
          .from(registrations)
          .where(eq(registrations.competitionId, competitionId)),
      ).toHaveLength(beforeRegs.length);
      expect(
        await owner.db
          .select({ id: auditLog.id })
          .from(auditLog)
          .where(eq(auditLog.scopeId, orgId)),
      ).toHaveLength(beforeAudit.length);
    } finally {
      await owner.db.delete(registrations).where(
        inArray(
          registrations.id,
          regs.map((r) => r.id),
        ),
      );
      await owner.db.delete(people).where(inArray(people.id, ids));
    }
  });
  it("fills null style columns independently, audits changes, and leaves duplicate/rejected events inert", async () => {
    const id = await setup();
    await owner.db
      .update(registrations)
      .set({ battingStyle: null, bowlingStyle: null })
      .where(eq(registrations.id, reg(0)));
    const first = event("style_set", { registrationId: reg(0), battingHand: "right" });
    expect(await append(id, [first])).toMatchObject({ ok: true, acks: [{ status: "stored" }] });
    const second = event("style_set", {
      registrationId: reg(0),
      battingHand: "left",
      bowlingStyle: "off_break",
    });
    expect(await append(id, [second])).toMatchObject({ ok: true, acks: [{ status: "stored" }] });
    const [row] = await owner.db
      .select()
      .from(registrations)
      .where(eq(registrations.id, reg(0)));
    expect(row).toMatchObject({ battingStyle: "right_hand", bowlingStyle: "off_break" });
    const changed = await owner.db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "registration.style_set_by_scorer"), eq(auditLog.subject, reg(0))),
      );
    const forFixture = changed.filter(
      (a) =>
        a.meta && typeof a.meta === "object" && "fixtureId" in a.meta && a.meta.fixtureId === id,
    );
    expect(forFixture).toHaveLength(2);
    expect(await append(id, [second])).toMatchObject({ ok: true, acks: [{ status: "duplicate" }] });
    expect(
      await append(id, [
        event("style_set", { registrationId: reg(0), battingHand: "ambidextrous" }),
      ]),
    ).toMatchObject({ ok: true, acks: [{ status: "rejected" }] });
    expect(
      await append(id, [
        event("style_set", {
          registrationId: reg(0),
          battingHand: "left",
          bowlingStyle: "leg_break",
        }),
      ]),
    ).toMatchObject({ ok: true, acks: [{ status: "stored" }] });
    const after = await owner.db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "registration.style_set_by_scorer"), eq(auditLog.subject, reg(0))),
      );
    expect(after).toHaveLength(changed.length);
    const [untouched] = await owner.db
      .select()
      .from(registrations)
      .where(eq(registrations.id, reg(0)));
    expect(untouched).toMatchObject({ battingStyle: "right_hand", bowlingStyle: "off_break" });
  });
});
