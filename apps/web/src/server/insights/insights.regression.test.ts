import { FORMAT_PRESETS, replayMatch, type MatchEvent } from "@desiauction/core/scoring";
import { writeLiveState } from "../scoring/live-state";
import { publicLiveOverlay, overlayRepresentationEtag } from "../scoring/public";
import {
  ballFacts,
  fixtureLineups,
  withTenantDb,
  matchPlayerLines,
  competitions,
  createDb,
  fixtures,
  fixtureResults,
  matches,
  newId,
  people,
  registrations,
  teams,
  type Db,
} from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../../env";
import { createOrg } from "../orgs/orgs";
import { createCompetition } from "../competition/competitions";
import { purgeOrg } from "../test-support/purge-org";
import { batterInsights, slowestBowlingMatchup } from "./batter";
import { captainBriefIn } from "./brief";
import { bowlerInsights } from "./bowler";

const owner = createDb(env.DATABASE_URL);
const briefApp = createDb(env.APP_DATABASE_URL ?? env.DATABASE_URL);
const actor = newId(),
  batterPerson = newId(),
  bowlerPerson = newId();
const batter = newId(),
  bowler = newId(),
  home = newId(),
  away = newId();
const fixtureIds = [newId(), newId(), newId()];
const now = new Date("2026-10-10T12:00:00Z");
const past = new Date(now.getTime() - 120000);
let orgId = "",
  competitionId = "";
beforeAll(async () => {
  for (const id of [actor, batterPerson, bowlerPerson])
    await owner.db
      .insert(people)
      .values({ id, email: `${id}@example.test`, name: "Insight player" });
  const org = await createOrg(owner.db, actor, `Insights ${newId()}`);
  orgId = org.id;
  const season = await createCompetition(owner.db, orgId, actor, {
    name: `Insight cup ${newId()}`,
    sport: "cricket",
    auctionUnit: "inr",
    teamFormation: "organizer",
  });
  competitionId = season.id;
  await owner.db
    .update(competitions)
    .set({ visibility: "public" })
    .where(eq(competitions.id, competitionId));
  await owner.db.insert(teams).values([
    { id: home, orgId, competitionId, name: "Batters", createdBy: actor },
    { id: away, orgId, competitionId, name: "Bowlers", createdBy: actor },
  ]);
  await owner.db.insert(registrations).values([
    {
      id: batter,
      orgId,
      competitionId,
      personId: batterPerson,
      teamId: home,
      registrationNumber: "1",
      status: "approved",
    },
    {
      id: bowler,
      orgId,
      competitionId,
      personId: bowlerPerson,
      teamId: away,
      registrationNumber: "2",
      status: "approved",
    },
  ]);
  for (const [index, count] of [20, 30, 10].entries()) {
    const id = required(fixtureIds[index]);
    await owner.db.insert(fixtures).values({
      id,
      orgId,
      competitionId,
      homeTeamId: home,
      awayTeamId: away,
      fixtureNumber: `INS-${String(index + 1)}`,
      seq: index + 1,
      status: "completed",
      kickoffAt: "2026-10-10T10:00",
      publishedAt: past,
      createdBy: actor,
    });
    await owner.db.insert(matches).values({
      fixtureId: id,
      orgId,
      competitionId,
      format: { key: "t20" },
      awardVersion: "cricket-v1/t20",
      phase: "finished",
      trustLevel: index === 1 ? "confirmed" : "verified",
      shareToken: newId(),
      startedAt: past,
      finishedAt: past,
      updatedAt: past,
    });
    await owner.db.insert(fixtureResults).values({
      fixtureId: id,
      orgId,
      competitionId,
      source: "scored",
      outcome: "home_win",
      winnerTeamId: home,
      score: { home: { runs: 1 }, away: { runs: 0 } },
      recordedBy: actor,
    });
    const row = {
      fixtureId: id,
      orgId,
      competitionId,
      inningsNo: 1,
      overNo: 1,
      ballInOver: 1,
      legal: true,
      phase: required(["powerplay", "middle", "death"][index]),
      batterId: batter,
      batterHand: "left",
      bowlerId: bowler,
      bowlerStyle: "off_break",
      runsBat: index === 1 ? 1 : 2,
      extras: 0,
      trustLevel: "verified",
      formatKey: "t20",
      ballType: index === 1 ? "tennis" : "leather",
      timeOfDay: index === 1 ? "day" : "night",
      groundType: "full",
      pitch: "turf",
      zone: "mid_wicket",
      angle: 36,
    };
    await owner.db.insert(matchPlayerLines).values({
      fixtureId: id,
      registrationId: batter,
      orgId,
      competitionId,
      teamId: home,
      sport: "cricket",
      formatKey: "t20",
      conditions: {},
      points: "0.00",
      pointsLines: [],
      trustLevel: "verified",
      stats: {
        registrationId: batter,
        teamId: home,
        appeared: true,
        batting: {
          runs: count * row.runsBat,
          balls: count,
          out: true,
          dismissals: [
            {
              inningsNo: 1,
              seq: 100,
              conditions: {
                ball: { type: row.ballType },
                timeOfDay: row.timeOfDay,
                pitch: "turf",
                ground: "full",
              },
            },
          ],
        },
      },
    });
    await owner.db.insert(ballFacts).values(
      Array.from({ length: count }, (_, n) => ({
        ...row,
        seq: n + 1,
        ...(n + 1 === count
          ? { wicketKind: "bowled", playerOutId: batter, wicketX: 0.2, wicketY: -0.3 }
          : {}),
      })),
    );
    if (index === 1)
      await owner.db
        .insert(ballFacts)
        .values({ ...row, seq: 31, legal: false, runsBat: 0, extraKind: "wide", extras: 3 });
    if (index === 2)
      await owner.db
        .insert(ballFacts)
        .values({ ...row, seq: 11, legal: false, runsBat: 0, extraKind: "no_ball", extras: 2 });
  }
});
afterAll(async () => {
  if (orgId) await purgeOrg(owner.db, orgId);
  for (const id of [actor, batterPerson, bowlerPerson])
    await owner.db.delete(people).where(eq(people.id, id));
  await briefApp.sql.end({ timeout: 5 });
  await owner.sql.end({ timeout: 5 });
});
const batting = (db: Db = owner.db) =>
  batterInsights(db, { kind: "self", personId: batterPerson }, {}, now);
describe("three-match hand-built analytics fixture", () => {
  it("aggregates batting, bowling, phases, conditions and the 60-ball threshold", async () => {
    const bat = await batting();
    expect(bat.sample).toMatchObject({ balls: 61, matches: 3, small: false });
    expect(bat.runs).toBe(90);
    expect(bat.average).toBe(30);
    expect(bat.shots.map((row) => [row.key, row.deliveries])).toEqual([
      ["mid_wicket|36|1|0", 30],
      ["mid_wicket|36|2|0", 30],
    ]);
    expect(bat.dismissalPositions).toMatchObject([{ key: "0.2|-0.3", deliveries: 3 }]);
    expect(bat.conditions.ball.map((row) => row.average)).toEqual([30, 30]);
    expect(slowestBowlingMatchup(bat)).toMatchObject({
      style: "off_break",
      rate: (90 * 6) / 61,
      sample: { balls: 61, matches: 3 },
    });
    expect(
      slowestBowlingMatchup({
        bowlingTypes: bat.bowlingTypes.map((row) => ({ ...row, key: "unrecognized_legacy_style" })),
      }),
    ).toBeNull();
    expect(bat.strikeRate).toBeCloseTo((90 * 100) / 61);
    expect(bat.phases.map((row) => [row.key, row.runs, row.sample.balls])).toEqual([
      ["death", 20, 11],
      ["middle", 30, 30],
      ["powerplay", 40, 20],
    ]);
    expect(bat.conditions.ball.every((row) => row.sample.small)).toBe(true);
    const bowl = await bowlerInsights(owner.db, { kind: "self", personId: bowlerPerson }, {}, now);
    expect(bowl.sample).toMatchObject({ balls: 60, matches: 3, small: false });
    expect(bowl.conceded).toBe(95);
    expect(bowl.economy).toBe(9.5);
    expect(bowl.hands[0]).toMatchObject({ key: "left", conceded: 95 });
    expect(
      (
        await batterInsights(
          owner.db,
          { kind: "self", personId: batterPerson },
          { ballType: "tennis" },
          now,
        )
      ).sample,
    ).toMatchObject({ balls: 30, matches: 1, small: true, remaining: 30 });
  });
  it("keeps historical averages unavailable and includes dismissal-only condition buckets", async () => {
    const [line] = await owner.db
      .select()
      .from(matchPlayerLines)
      .where(eq(matchPlayerLines.fixtureId, required(fixtureIds[0])));
    const original = required(line);
    try {
      await owner.db
        .update(matchPlayerLines)
        .set({ stats: { batting: { out: true } } })
        .where(eq(matchPlayerLines.fixtureId, original.fixtureId));
      const historical = await batting();
      expect(historical.average).toBeNull();
      expect(historical.conditions.pitch.every((row) => row.average === null)).toBe(true);
      await owner.db
        .update(matchPlayerLines)
        .set({
          stats: {
            batting: {
              out: true,
              dismissals: [
                {
                  inningsNo: 1,
                  seq: 100,
                  conditions: {
                    ball: { type: "leather" },
                    timeOfDay: "night",
                    pitch: "matting",
                    ground: "full",
                  },
                },
              ],
            },
          },
        })
        .where(eq(matchPlayerLines.fixtureId, original.fixtureId));
      const corrected = await batting();
      expect(corrected.average).toBe(30);
      expect(corrected.conditions.pitch.find((row) => row.key === "matting")).toMatchObject({
        average: 0,
        runs: 0,
        sample: { balls: 0, matches: 1, small: true },
      });
      expect(corrected.conditions.pitch.find((row) => row.key === "turf")?.average).toBe(45);
    } finally {
      await owner.db
        .update(matchPlayerLines)
        .set({ stats: original.stats })
        .where(eq(matchPlayerLines.fixtureId, original.fixtureId));
    }
  });
  it("uses current match trust rather than stale copied fact trust", async () => {
    await owner.db
      .update(matches)
      .set({ trustLevel: "flagged" })
      .where(eq(matches.fixtureId, required(fixtureIds[0])));
    try {
      const reduced = await batting();
      expect(reduced.sample.balls).toBe(41);
      expect(slowestBowlingMatchup(reduced)).toBeNull();
    } finally {
      await owner.db
        .update(matches)
        .set({ trustLevel: "verified" })
        .where(eq(matches.fixtureId, required(fixtureIds[0])));
    }
  });
  it("withholds private, delayed and historical minor data from public readers", async () => {
    const publicView = () =>
      batterInsights(owner.db, { kind: "public", personId: batterPerson, orgId }, {}, now);
    expect((await publicView()).sample.balls).toBe(61);
    await owner.db
      .update(matches)
      .set({ updatedAt: now })
      .where(eq(matches.fixtureId, required(fixtureIds[1])));
    try {
      expect((await publicView()).sample.balls).toBe(31);
      expect((await batting()).sample.balls).toBe(61);
    } finally {
      await owner.db
        .update(matches)
        .set({ updatedAt: past })
        .where(eq(matches.fixtureId, required(fixtureIds[1])));
    }
    await owner.db
      .update(registrations)
      .set({ dateOfBirth: "2008-10-11" })
      .where(eq(registrations.id, batter));
    try {
      expect((await publicView()).sample.balls).toBe(0);
      expect((await batting()).sample.balls).toBe(61);
    } finally {
      await owner.db
        .update(registrations)
        .set({ dateOfBirth: null })
        .where(eq(registrations.id, batter));
    }
    await owner.db
      .update(competitions)
      .set({ visibility: "private" })
      .where(eq(competitions.id, competitionId));
    try {
      expect((await publicView()).sample.balls).toBe(0);
    } finally {
      await owner.db
        .update(competitions)
        .set({ visibility: "public" })
        .where(eq(competitions.id, competitionId));
    }
    expect(
      (
        await batterInsights(
          owner.db,
          { kind: "public", personId: batterPerson, orgId: newId() },
          {},
          now,
        )
      ).sample.balls,
    ).toBe(0);
  });
  it("excludes super-over rows from ordinary delivery insights", async () => {
    const [original] = await owner.db
      .select()
      .from(ballFacts)
      .where(eq(ballFacts.fixtureId, required(fixtureIds[0])))
      .limit(1);
    await owner.db
      .insert(ballFacts)
      .values({ ...required(original), inningsNo: 3, seq: 100, runsBat: 6, boundary: 6 });
    expect((await batting()).runs).toBe(90);
  });
});

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Required test fixture value is missing");
  return value;
}

it("shows only eligible historical overlay STAT at 60 balls, excluding the displayed fixture", async () => {
  const id = newId(),
    partner = newId(),
    otherBowler = newId(),
    token = newId();
  await owner.db.insert(fixtures).values({
    id,
    orgId,
    competitionId,
    homeTeamId: home,
    awayTeamId: away,
    fixtureNumber: "INS-LIVE",
    seq: 4,
    status: "published",
    kickoffAt: "2026-10-10T10:00",
    publishedAt: past,
    createdBy: actor,
  });
  await owner.db.insert(matches).values({
    fixtureId: id,
    orgId,
    competitionId,
    format: FORMAT_PRESETS.t20,
    awardVersion: "cricket-v1/t20",
    phase: "live",
    trustLevel: "verified",
    shareToken: token,
    startedAt: past,
    updatedAt: past,
  });
  const events: MatchEvent[] = [];
  const push = (type: MatchEvent["type"], payload: unknown) =>
    events.push({
      type,
      payload,
      seq: events.length + 1,
      eventId: newId(),
      attempt: 1,
      v: 1,
      targetEventId: null,
      actorPersonId: actor,
      clientSeq: events.length + 1,
      clientRecordedAt: past.toISOString(),
    } as MatchEvent);
  push("match_started", {
    format: FORMAT_PRESETS.t20,
    conditions: {},
    homeTeamId: home,
    awayTeamId: away,
  });
  push("lineup_confirmed", {
    teamId: home,
    battingOrder: [batter, partner],
    captainId: batter,
    keeperId: partner,
    substitutes: [],
  });
  push("lineup_confirmed", {
    teamId: away,
    battingOrder: [bowler, otherBowler],
    captainId: bowler,
    keeperId: otherBowler,
    substitutes: [],
  });
  push("toss", { winnerTeamId: home, decision: "bat" });
  push("innings_started", {
    inningsNo: 1,
    battingTeamId: home,
    strikerId: partner,
    nonStrikerId: batter,
    bowlerId: bowler,
  });
  for (let n = 0; n < 6; n += 1)
    push("ball", {
      strikerId: partner,
      nonStrikerId: batter,
      bowlerId: bowler,
      runsBat: 0,
      extras: {},
    });
  await writeLiveState(owner.db, {
    fixtureId: id,
    orgId,
    competitionId,
    kickoffAt: "2026-10-10T10:00",
    startedAt: past,
    state: replayMatch(events),
    now: past,
  });
  const read = () => publicLiveOverlay(id, { t: token }, now, owner.db);
  const original = required(await read());
  expect(original.overlay?.betweenOvers).toBe(true);
  expect(original.stat).toMatchObject({
    style: "Off-Break",
    rate: (90 * 6) / 61,
    sample: { balls: 61, matches: 3 },
  });
  const fact = required(
    (
      await owner.db
        .select()
        .from(ballFacts)
        .where(
          and(
            eq(ballFacts.fixtureId, required(fixtureIds[0])),
            eq(ballFacts.inningsNo, 1),
            eq(ballFacts.seq, 1),
          ),
        )
    )[0],
  );
  try {
    await owner.db
      .update(ballFacts)
      .set({ bowlerStyle: null })
      .where(
        and(
          eq(ballFacts.fixtureId, fact.fixtureId),
          eq(ballFacts.inningsNo, 1),
          eq(ballFacts.seq, 1),
        ),
      );
    expect((await read())?.stat?.sample.balls).toBe(60);
    const secondFact = required(
      (
        await owner.db
          .select()
          .from(ballFacts)
          .where(
            and(
              eq(ballFacts.fixtureId, fact.fixtureId),
              eq(ballFacts.inningsNo, 1),
              eq(ballFacts.seq, 2),
            ),
          )
      )[0],
    );
    try {
      await owner.db
        .update(ballFacts)
        .set({ bowlerStyle: null })
        .where(
          and(
            eq(ballFacts.fixtureId, fact.fixtureId),
            eq(ballFacts.inningsNo, 1),
            eq(ballFacts.seq, 2),
          ),
        );
      expect((await read())?.stat).toBeNull();
    } finally {
      await owner.db
        .update(ballFacts)
        .set({ bowlerStyle: secondFact.bowlerStyle })
        .where(
          and(
            eq(ballFacts.fixtureId, fact.fixtureId),
            eq(ballFacts.inningsNo, 1),
            eq(ballFacts.seq, 2),
          ),
        );
    }
  } finally {
    await owner.db
      .update(ballFacts)
      .set({ bowlerStyle: fact.bowlerStyle })
      .where(
        and(
          eq(ballFacts.fixtureId, fact.fixtureId),
          eq(ballFacts.inningsNo, 1),
          eq(ballFacts.seq, 1),
        ),
      );
  }
  await owner.db
    .update(matches)
    .set({ trustLevel: "flagged" })
    .where(eq(matches.fixtureId, required(fixtureIds[0])));
  try {
    const changed = required(await read());
    expect(changed.live.seq).toBe(original.live.seq);
    expect(changed.stat).toBeNull();
    expect(overlayRepresentationEtag(changed)).not.toBe(overlayRepresentationEtag(original));
  } finally {
    await owner.db
      .update(matches)
      .set({ trustLevel: "verified" })
      .where(eq(matches.fixtureId, required(fixtureIds[0])));
  }
  await owner.db
    .update(registrations)
    .set({ dateOfBirth: "2011-01-01" })
    .where(eq(registrations.id, batter));
  try {
    expect((await read())?.stat).toBeNull();
  } finally {
    await owner.db
      .update(registrations)
      .set({ dateOfBirth: null })
      .where(eq(registrations.id, batter));
  }
  await owner.db
    .update(competitions)
    .set({ visibility: "private" })
    .where(eq(competitions.id, competitionId));
  try {
    expect((await read())?.stat).toBeNull();
  } finally {
    await owner.db
      .update(competitions)
      .set({ visibility: "public" })
      .where(eq(competitions.id, competitionId));
  }
  const before = await batterInsights(
    owner.db,
    { kind: "public", personId: batterPerson, orgId },
    { excludeFixtureId: required(fixtureIds[0]) },
    now,
  );
  expect(before.sample.balls).toBe(41);
});

it("keeps entitled private briefs within the application tenant without granting public history", async () => {
  const fixtureId = required(fixtureIds[0]);
  await owner.db
    .insert(fixtureLineups)
    .values([
      { fixtureId, orgId, competitionId, teamId: home, registrationId: batter, recordedBy: actor },
      { fixtureId, orgId, competitionId, teamId: away, registrationId: bowler, recordedBy: actor },
    ])
    .onConflictDoNothing();
  await owner.db
    .update(competitions)
    .set({ tier: "pro", visibility: "private" })
    .where(eq(competitions.id, competitionId));
  try {
    const brief = await withTenantDb(briefApp, { personId: actor, orgId }, (db) =>
      captainBriefIn(db, actor, competitionId, fixtureId, now),
    );
    if (!brief || brief.locked) throw new Error("Missing private entitled brief");
    const player = required(brief.players.find((row) => row.id === batter));
    expect(player.batting.sample.balls).toBe(41);
    expect(player.matchup).toBeNull();
    expect(JSON.stringify(brief)).not.toContain(batterPerson);
    expect(JSON.stringify(brief)).not.toContain("@example.test");
    expect(
      await withTenantDb(briefApp, { personId: actor, orgId: newId() }, (db) =>
        captainBriefIn(db, actor, competitionId, fixtureId, now),
      ),
    ).toBeNull();
    expect(
      (await batterInsights(owner.db, { kind: "public", personId: batterPerson, orgId }, {}, now))
        .sample.balls,
    ).toBe(0);
  } finally {
    await owner.db
      .update(competitions)
      .set({ tier: "free", visibility: "public" })
      .where(eq(competitions.id, competitionId));
  }
});
