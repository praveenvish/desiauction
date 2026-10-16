import {
  FORMAT_PRESETS,
  replayMatch,
  type EventType,
  type MatchEvent,
  type PayloadOf,
  type PublicLiveState,
  type PublicScorecard,
  type PublicCharts,
} from "@desiauction/core/scoring";
import {
  competitions,
  createDb,
  fixtures,
  matches,
  matchLiveState,
  newId,
  organizations,
  people,
  registrations,
  grants,
  teamManagers,
  teams,
} from "@desiauction/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { previewModel } from "../../app/c/[slug]/m/[fixtureNumber]/live-preview";
import { GET } from "../../app/api/live/[fixtureId]/route";
import { POST } from "../../app/api/live/[fixtureId]/view/route";
import { env } from "../../env";
import { purgeOrg } from "../test-support/purge-org";
import { writeLiveState } from "./live-state";
import {
  flushPublicViewer,
  isMatchInsider,
  publicLive,
  publicLiveScorecard,
  publicLiveCharts,
  publicLiveResult,
  publicLiveOverlay,
  overlayRepresentationEtag,
  publicViewerIdentity,
} from "./public";
import { ViewerBuckets } from "./viewer-buckets";
import { overlayPageFacts } from "./overlay-page";
import { publicPage } from "./public-page";
import { publicName } from "./public-name";
import type { PublicResultDetails } from "./result-details";
import type { LiveHistoryEntry, StoredLiveState } from "./live-state";

/** The snapshot and its delay ring (0126) as one object, the way tests edit them. */
type StoredRow = StoredLiveState & { history: LiveHistoryEntry[] };
const storedOf = (row: { state: unknown; history: unknown }): StoredRow => ({
  ...(row.state as StoredLiveState),
  history: row.history as LiveHistoryEntry[],
});
const rowOf = ({ history, ...state }: StoredRow) => ({ state, history });

const owner = createDb(env.DATABASE_URL);
const app = env.APP_DATABASE_URL ? createDb(env.APP_DATABASE_URL) : owner;
const actor = newId(),
  orgId = newId(),
  otherOrg = newId(),
  competitionId = newId(),
  home = newId(),
  away = newId();
const playerIds = Array.from({ length: 4 }, () => newId()),
  regs = playerIds.map(() => newId());
const now = new Date(),
  old = new Date(now.getTime() - 120000),
  recent = new Date(now.getTime() - 5000);
const slug = `public-live-${competitionId}`;
let sequence = 0;
const reg = (index: number) => {
  const id = regs[index];
  if (!id) throw new Error("Missing registration");
  return id;
};
beforeAll(async () => {
  await owner.db.insert(people).values(
    [actor, ...playerIds].map((id, index) => ({
      id,
      name: index === 1 ? "Adrian Young" : `Adult Player ${String(index)}`,
      email: `${id}@example.test`,
    })),
  );
  await owner.db.insert(organizations).values(
    [orgId, otherOrg].map((id) => ({
      id,
      name: "Public API club",
      slug: `public-api-${id}`,
      createdBy: actor,
    })),
  );
  await owner.db.insert(competitions).values({
    id: competitionId,
    orgId,
    name: "Public API cup",
    slug,
    sport: "cricket",
    visibility: "public",
    createdBy: actor,
  });
  await owner.db.insert(teams).values(
    [home, away].map((id, index) => ({
      id,
      orgId,
      competitionId,
      name: `Public side ${String(index)}`,
      createdBy: actor,
    })),
  );
  await owner.db.insert(registrations).values(
    playerIds.map((personId, index) => ({
      id: reg(index),
      orgId,
      competitionId,
      personId,
      teamId: index < 2 ? home : away,
      registrationNumber: `PUBLIC-${String(index)}`,
      status: "approved" as const,
      dateOfBirth: index === 0 ? "2011-10-10" : null,
      enteredPhotoKey: index === 0 ? "private/minor.jpg" : null,
      enteredPhotoConsentAt: index === 0 ? now : null,
    })),
  );
});
beforeEach(async () => {
  await owner.db
    .update(competitions)
    .set({ sport: "cricket", visibility: "public", scoringRules: { publicDelaySeconds: 60 } })
    .where(eq(competitions.id, competitionId));
});
afterAll(async () => {
  await purgeOrg(owner.db, orgId);
  await purgeOrg(owner.db, otherOrg);
  for (const id of [actor, ...playerIds]) await owner.db.delete(people).where(eq(people.id, id));
  if (app !== owner) await app.sql.end();
  await owner.sql.end();
});
async function seed(
  status: "published" | "draft" | "completed" = "published",
  latestBall?: PayloadOf<"ball">,
) {
  const id = newId(),
    token = `share-${newId()}`;
  sequence += 1;
  await owner.db.insert(fixtures).values({
    id,
    orgId,
    competitionId,
    homeTeamId: home,
    awayTeamId: away,
    status,
    fixtureNumber: `PUBLIC-${String(sequence)}`,
    seq: sequence,
    kickoffAt: "2026-10-09T19:00",
    createdBy: actor,
  });
  await owner.db.insert(matches).values({
    fixtureId: id,
    orgId,
    competitionId,
    format: FORMAT_PRESETS.t20,
    awardVersion: "cricket-v1/t20",
    shareToken: token,
    lastSeq: 6,
    phase: "live",
    startedAt: old,
    scorerPersonId: actor,
  });
  function event<T extends EventType>(type: T, payload: PayloadOf<T>, seq: number): MatchEvent<T> {
    return {
      type,
      payload,
      seq,
      eventId: newId(),
      attempt: 1,
      v: 1,
      targetEventId: null,
      actorPersonId: actor,
      clientSeq: seq,
      clientRecordedAt: old.toISOString(),
    };
  }
  const events: MatchEvent[] = [
    event(
      "match_started",
      { format: FORMAT_PRESETS.t20, conditions: {}, homeTeamId: home, awayTeamId: away },
      1,
    ),
    ...[home, away].map((teamId, i) =>
      event(
        "lineup_confirmed",
        {
          teamId,
          battingOrder: regs.slice(i * 2, i * 2 + 2),
          captainId: reg(i * 2),
          keeperId: reg(i * 2 + 1),
          substitutes: [],
        },
        i + 2,
      ),
    ),
    event("toss", { winnerTeamId: home, decision: "bat" }, 4),
    event(
      "innings_started",
      {
        inningsNo: 1,
        battingTeamId: home,
        strikerId: reg(0),
        nonStrikerId: reg(1),
        bowlerId: reg(2),
      },
      5,
    ),
  ];
  const input = {
    fixtureId: id,
    orgId,
    competitionId,
    kickoffAt: "2026-10-09T19:00",
    startedAt: old,
  };
  await writeLiveState(owner.db, { ...input, state: replayMatch(events), now: old });
  events.push(
    event(
      "ball",
      latestBall ?? {
        strikerId: reg(0),
        nonStrikerId: reg(1),
        bowlerId: reg(2),
        runsBat: 1,
        extras: {},
      },
      6,
    ),
  );
  await writeLiveState(owner.db, { ...input, state: replayMatch(events), now: recent });
  return { id, token, number: `PUBLIC-${String(sequence)}`, input, state: replayMatch(events) };
}
function get(id: string, query = "", etag?: string) {
  return GET(
    new Request(`http://localhost/api/live/${id}${query}`, {
      headers: etag ? { "If-None-Match": etag } : {},
    }),
    { params: Promise.resolve({ fixtureId: id }) },
  );
}
it("retains insertion order at exact delayed cutoffs and clamps legacy advanced clocks with a bounded ring", async () => {
  const { id, input, state } = await seed();
  const advanced = new Date(recent.getTime() + 1);
  await owner.db
    .update(matchLiveState)
    .set({ updatedAt: advanced })
    .where(eq(matchLiveState.fixtureId, id));
  for (let index = 0; index < 32; index += 1) {
    await writeLiveState(owner.db, {
      ...input,
      state: { ...state, lastSeq: 7 + index },
      now: index % 2 === 0 ? recent : old,
    });
  }
  const [row] = await owner.db
    .select()
    .from(matchLiveState)
    .where(eq(matchLiveState.fixtureId, id));
  if (!row) throw new Error("Missing live fixture");
  const stored = storedOf(row);
  expect(row.updatedAt).toEqual(advanced);
  expect(stored.history).toHaveLength(30);
  expect(stored.history.every((entry) => entry.updatedAt === advanced.toISOString())).toBe(true);
  expect(await publicLive(id, {}, new Date(advanced.getTime() + 59999), owner.db)).toBeNull();
  expect((await publicLive(id, {}, new Date(advanced.getTime() + 60000), owner.db))?.seq).toBe(38);
});
it("selects the last same-time award revision and subsequent correction without early disclosure", async () => {
  const { id } = await seed();
  const [row] = await owner.db
    .select()
    .from(matchLiveState)
    .where(eq(matchLiveState.fixtureId, id));
  if (!row) throw new Error("Missing live fixture");
  const stored = storedOf(row);
  const entry = stored.history.at(-1);
  if (!entry) throw new Error("Missing history");
  stored.history = ["override-one", "override-two", "correction"].map((revision, index) => ({
    updatedAt: recent.toISOString(),
    state: { ...entry.state, seq: index === 2 ? 7 : 6, phase: "finished", result: "Home won" },
    resultDetails: { v: 1, seq: index === 2 ? 7 : 6, revision, awards: [] },
  }));
  await owner.db.update(matchLiveState).set(rowOf(stored)).where(eq(matchLiveState.fixtureId, id));
  await owner.db.update(matches).set({ phase: "finished" }).where(eq(matches.fixtureId, id));
  expect(await publicLiveResult(id, {}, new Date(recent.getTime() + 59999), owner.db)).toBeNull();
  const correction = stored.history.pop();
  await owner.db.update(matchLiveState).set(rowOf(stored)).where(eq(matchLiveState.fixtureId, id));
  const second = await publicLiveResult(id, {}, new Date(recent.getTime() + 60000), owner.db);
  expect(second?.resultDetails?.revision).toBe("override-two");
  if (!correction) throw new Error("Missing correction");
  stored.history.push(correction);
  await owner.db.update(matchLiveState).set(rowOf(stored)).where(eq(matchLiveState.fixtureId, id));
  const corrected = await publicLiveResult(id, {}, new Date(recent.getTime() + 60000), owner.db);
  expect(corrected?.live.seq).toBe(7);
  expect(corrected?.resultDetails?.revision).toBe("correction");
});
it("keeps result awards paired with the eligible delayed revision, strips private keys and changes the award validator", async () => {
  const { id } = await seed();
  const [row] = await owner.db
    .select()
    .from(matchLiveState)
    .where(eq(matchLiveState.fixtureId, id));
  if (!row) throw new Error("Missing live fixture");
  const stored = storedOf(row);
  const details = (seq: number, revision: string, name: string): PublicResultDetails => ({
    v: 1,
    seq,
    revision,
    awards: [
      {
        kind: "player_of_match",
        name,
        initials: "AY",
        photoUrl: null,
        teamId: home,
        figures: "4 (1)",
        points: 5,
        source: "auto",
        computedName: name,
        lines: [{ code: "runs", label: "Runs", qty: 4, points: 4 }],
        shots: [{ angle: 90, runs: 4 }],
      },
    ],
  });
  for (const entry of stored.history) {
    entry.state.phase = "finished";
    entry.state.result = "Home won";
    entry.resultDetails = details(
      entry.state.seq,
      `award-${String(entry.state.seq)}`,
      entry.state.seq === 5 ? "AY" : "New winner",
    );
  }
  stored.phase = "finished";
  stored.result = "Home won";
  stored.resultDetails = Object.assign(details(6, "award-6", "New winner"), {
    email: "private@example.test",
  });
  await owner.db.update(matchLiveState).set(rowOf(stored)).where(eq(matchLiveState.fixtureId, id));
  await owner.db.update(matches).set({ phase: "finished" }).where(eq(matches.fixtureId, id));
  const delayed = await publicLiveResult(id, {}, now, owner.db);
  expect(delayed?.live.seq).toBe(5);
  expect(delayed?.resultDetails?.awards[0]?.name).toBe("AY");
  const eligible = await publicLiveResult(id, {}, new Date(now.getTime() + 61000), owner.db);
  expect(eligible?.live.seq).toBe(6);
  expect(eligible?.resultDetails?.awards[0]?.name).toBe("New winner");
  await owner.db.update(matches).set({ trustLevel: "verified" }).where(eq(matches.fixtureId, id));
  const first = await get(id, "?view=result");
  const firstTag = first.headers.get("etag");
  expect(firstTag).toBe('"result-6-award-6-verified"');
  expect(await first.json()).not.toHaveProperty("resultDetails.email");
  stored.resultDetails = details(6, "override-7", "AY");
  await owner.db.update(matchLiveState).set(rowOf(stored)).where(eq(matchLiveState.fixtureId, id));
  const changed = await get(id, "?view=result", firstTag ?? undefined);
  expect(changed.status).toBe(200);
  expect(changed.headers.get("etag")).toBe('"result-6-override-7-verified"');
  await owner.db.update(matches).set({ phase: "void" }).where(eq(matches.fixtureId, id));
  expect(await publicLiveResult(id, {}, now, owner.db)).toBeNull();
});
it("withdraws every public representation and SSR before validators when a delayed whole-match void is persisted", async () => {
  const { id, token, number } = await seed();
  const [row] = await owner.db
    .select()
    .from(matchLiveState)
    .where(eq(matchLiveState.fixtureId, id));
  if (!row) throw new Error("Missing live fixture");
  const stored = storedOf(row);
  for (const entry of stored.history) {
    entry.state.phase = "finished";
    entry.state.result = "Home won";
    entry.resultDetails = { v: 1, seq: entry.state.seq, revision: "historical-award", awards: [] };
  }
  const previousEntry = stored.history.at(-1);
  if (!previousEntry) throw new Error("Missing historical snapshot");
  stored.history.push({
    updatedAt: recent.toISOString(),
    state: { ...previousEntry.state, phase: "void", result: null },
  });
  await owner.db.update(matchLiveState).set(rowOf(stored)).where(eq(matchLiveState.fixtureId, id));
  const previous = await get(id, "?view=result");
  expect(previous.status).toBe(200);
  const tag = previous.headers.get("etag");
  if (!tag) throw new Error("Missing result validator");
  await owner.db.update(matches).set({ phase: "void" }).where(eq(matches.fixtureId, id));
  for (const query of [
    "",
    "?view=result",
    "?view=scorecard",
    "?view=charts",
    `?t=${token}&view=result`,
  ]) {
    const conditional = await get(id, query, "*");
    expect(conditional.status).toBe(404);
    const refused = await get(id, query, tag);
    expect(refused.status).toBe(404);
    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect(refused.headers.get("etag")).toBeNull();
    expect(await refused.json()).toEqual({ error: "not_found" });
  }
  expect(await publicLive(id, {}, now, owner.db)).toBeNull();
  expect(await publicLiveResult(id, {}, now, owner.db)).toBeNull();
  expect(await publicLiveScorecard(id, {}, now, owner.db)).toBeNull();
  expect(await publicLiveCharts(id, {}, now, owner.db)).toBeNull();
  expect(await publicPage({ slug, fixtureNumber: number }, owner.db, now)).toBeNull();
  expect(await publicPage({ token }, owner.db, now)).toBeNull();
  const [retained] = await owner.db
    .select()
    .from(matchLiveState)
    .where(eq(matchLiveState.fixtureId, id));
  expect(retained && storedOf(retained)).toEqual(stored);
});
it("does not substitute current awards for missing historical result details", async () => {
  const { id } = await seed();
  expect((await publicLiveResult(id, {}, now, owner.db))?.resultDetails).toBeNull();
});
it("pairs complete scorecard with the same delayed sequence and representation validator", async () => {
  const { id } = await seed();
  const paired = await publicLiveScorecard(id, {}, now, owner.db);
  expect(paired?.live.seq).toBe(5);
  expect(paired?.scorecard.seq).toBe(5);
  expect(paired?.scorecard.innings[0]?.batting[0]?.runs).toBe(0);
  const response = await get(id, "?view=scorecard");
  expect(response.status).toBe(200);
  expect(response.headers.get("etag")).toBe('"scorecard-5-self_scored"');
  const body = (await response.json()) as { live: PublicLiveState; scorecard: PublicScorecard };
  expect(body.live.seq).toBe(body.scorecard.seq);
  expect(JSON.stringify(body.scorecard)).not.toMatch(
    /dateOfBirth|photoUrl|phone|email|actorPersonId/,
  );
  expect((await get(id, "?view=scorecard", '"5"')).status).toBe(200);
  expect((await get(id, "?view=scorecard", 'W/"scorecard-5-self_scored"')).status).toBe(304);
  await owner.db
    .update(competitions)
    .set({ visibility: "private" })
    .where(eq(competitions.id, competitionId));
  const denied = await get(id, "?view=scorecard", '"scorecard-5-self_scored"');
  expect(denied.status).toBe(404);
  expect(denied.headers.get("etag")).toBeNull();
});
it("keeps newer sanitized dismissal participants outside the selected delayed scorecard", async () => {
  await owner.db
    .update(registrations)
    .set({ dateOfBirth: "2011-10-10" })
    .where(eq(registrations.id, reg(3)));
  const { id } = await seed("published", {
    strikerId: reg(0),
    nonStrikerId: reg(1),
    bowlerId: reg(2),
    runsBat: 0,
    extras: {},
    wicket: { kind: "caught", playerOutId: reg(0), fielderIds: [reg(3)] },
  });
  const delayed = await publicLiveScorecard(id, {}, now, owner.db);
  expect(delayed?.live.seq).toBe(5);
  expect(delayed?.scorecard.innings[0]?.batting[0]?.attribution).toBeUndefined();
  const eligible = await publicLiveScorecard(id, {}, new Date(now.getTime() + 61000), owner.db);
  const fielders = eligible?.scorecard.innings[0]?.batting[0]?.attribution?.fielders;
  expect(eligible?.live.seq).toBe(6);
  expect(fielders?.[0]?.id).toBe(reg(3));
  expect(fielders?.[0]?.name).toBe(fielders?.[0]?.initials);
  expect(JSON.stringify(eligible?.scorecard)).not.toMatch(
    /photoUrl|dateOfBirth|phone|email|actorPersonId/,
  );
  await owner.db
    .update(registrations)
    .set({ dateOfBirth: null })
    .where(eq(registrations.id, reg(3)));
});
it("SSR facts use the delayed score and keep approved squads distinct from announced XIs", async () => {
  const { id, token, number } = await seed();
  const page = await publicPage({ slug, fixtureNumber: number }, owner.db, now);
  expect(page?.fixtureId).toBe(id);
  expect(page?.initial?.seq).toBe(5);
  expect(page?.teams.flatMap((team) => team.players).every((player) => !player.announced)).toBe(
    true,
  );
  expect(JSON.stringify(page)).not.toMatch(/dateOfBirth|private\/minor|phone|@example/);
  expect(page?.teams[0]?.players.find((player) => player.id === reg(0))?.name).toBe("AY");
  expect((await publicPage({ token }, owner.db, now))?.initial?.seq).toBe(5);
  expect(await publicPage({ token: `${token}-wrong` }, owner.db, now)).toBeNull();
});
it("shows a gated waiting page before a match exists and conservative initials without a date", async () => {
  const { id, token, number } = await seed();
  await owner.db.delete(matches).where(eq(matches.fixtureId, id));
  await owner.db.update(fixtures).set({ kickoffAt: null }).where(eq(fixtures.id, id));
  const page = await publicPage({ slug, fixtureNumber: number }, owner.db, now);
  expect(page?.hasMatch).toBe(false);
  expect(page?.initial).toBeNull();
  expect(
    page?.teams.flatMap((team) => team.players).every((player) => player.name === player.initials),
  ).toBe(true);
  expect(await publicPage({ token }, owner.db, now)).toBeNull();
  expect(publicName({ name: "Adult Full Name" }, { dateOfBirth: null }, null)).toMatchObject({
    name: "AN",
    minor: true,
  });
  await owner.db.update(fixtures).set({ status: "draft" }).where(eq(fixtures.id, id));
  expect(await publicPage({ slug, fixtureNumber: number }, owner.db, now)).toBeNull();
});
it("does not replace an eligible snapshot's missing scorecard with a future sidecar", async () => {
  const { id } = await seed();
  const [row] = await owner.db
    .select()
    .from(matchLiveState)
    .where(eq(matchLiveState.fixtureId, id));
  if (!row) throw new Error("Missing snapshot");
  const stored = storedOf(row);
  for (const entry of stored.history) if (entry.state.seq === 5) delete entry.scorecard;
  await owner.db.update(matchLiveState).set(rowOf(stored)).where(eq(matchLiveState.fixtureId, id));
  const response = await get(id, "?view=scorecard", '"scorecard-5-self_scored"');
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("etag")).toBeNull();
  expect((await publicLive(id, {}, now, owner.db))?.seq).toBe(5);
});
it("gates private, public, exact tokens, slug hints and unpublished fixtures before validators", async () => {
  const { id, token } = await seed();
  expect((await get(id)).status).toBe(200);
  expect((await get(id, `?s=${slug}`)).status).toBe(200);
  expect((await get(id, "?s=another-season")).status).toBe(404);
  await owner.db
    .update(competitions)
    .set({ visibility: "private" })
    .where(eq(competitions.id, competitionId));
  for (const query of ["", `?t=${token}wrong`]) {
    const denied = await get(id, query, '"5"');
    expect(denied.status).toBe(404);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    expect(denied.headers.get("etag")).toBeNull();
  }
  expect((await get(id, `?t=${token}`)).status).toBe(200);
  expect((await get(newId(), `?t=${token}`)).status).toBe(404);
  await owner.db
    .update(competitions)
    .set({ visibility: "public" })
    .where(eq(competitions.id, competitionId));
  const draft = await seed("draft");
  expect((await get(draft.id)).status).toBe(404);
  expect((await get(draft.id, `?t=${draft.token}`)).status).toBe(200);
});
it("uses the eligible snapshot's ETag and honors weak/list validators only after access", async () => {
  const { id } = await seed();
  const response = await get(id);
  expect(response.headers.get("etag")).toBe('"5-self_scored"');
  expect(response.headers.get("cache-control")).toBe(
    "public, max-age=0, s-maxage=1, stale-while-revalidate=5",
  );
  expect(((await response.json()) as PublicLiveState).seq).toBe(5);
  for (const tag of [
    '"5-self_scored"',
    'W/"5-self_scored"',
    '"6-self_scored", "5-self_scored"',
    "*",
  ]) {
    const same = await get(id, "", tag);
    expect(same.status).toBe(304);
    expect(await same.text()).toBe("");
  }
  expect((await get(id, "", '"6"')).status).toBe(200);
});
it("delays every nonverified trust level, includes cutoff equality and releases verified live state", async () => {
  const { id } = await seed();
  for (const trustLevel of ["self_scored", "confirmed", "flagged"] as const) {
    await owner.db.update(matches).set({ trustLevel }).where(eq(matches.fixtureId, id));
    expect((await publicLive(id, {}, now, owner.db))?.seq).toBe(5);
    expect((await publicLive(id, {}, new Date(old.getTime() + 60000), owner.db))?.seq).toBe(5);
    expect(await publicLive(id, {}, new Date(old.getTime() + 59999), owner.db)).toBeNull();
  }
  await owner.db.update(matches).set({ trustLevel: "verified" }).where(eq(matches.fixtureId, id));
  expect((await publicLive(id, {}, now, owner.db))?.seq).toBe(6);
});
it("invalidates every same-sequence validator when current trust is downgraded", async () => {
  const { id } = await seed();
  const [season] = await owner.db
    .select({ rules: competitions.scoringRules })
    .from(competitions)
    .where(eq(competitions.id, competitionId));
  if (!season) throw new Error("Missing season");
  await owner.db
    .update(competitions)
    .set({ scoringRules: { ...(season.rules as object), publicDelaySeconds: 0 } })
    .where(eq(competitions.id, competitionId));
  try {
    await owner.db.update(matches).set({ trustLevel: "verified" }).where(eq(matches.fixtureId, id));
    const tags = new Map<string, string>();
    for (const query of ["", "?view=scorecard", "?view=charts"]) {
      const response = await get(id, query);
      expect(response.status).toBe(200);
      const tag = response.headers.get("etag");
      if (!tag) throw new Error("Missing validator");
      expect(tag).toContain("verified");
      tags.set(query, tag);
    }
    await owner.db.update(matches).set({ trustLevel: "flagged" }).where(eq(matches.fixtureId, id));
    for (const [query, tag] of tags) {
      const response = await get(id, query, tag);
      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toContain("flagged");
      const body = (await response.json()) as {
        seq?: number;
        trust?: string;
        live?: PublicLiveState;
      };
      const live = body.live ?? body;
      expect(live).toMatchObject({ seq: 6, trust: "flagged" });
    }
  } finally {
    await owner.db
      .update(competitions)
      .set({ scoringRules: season.rules })
      .where(eq(competitions.id, competitionId));
  }
});
it("fails closed without an eligible ring snapshot and never emits an ETag", async () => {
  const { id } = await seed();
  const [row] = await owner.db
    .select()
    .from(matchLiveState)
    .where(eq(matchLiveState.fixtureId, id));
  if (!row) throw new Error("Missing projection");
  for (const history of [[], [{ updatedAt: recent.toISOString(), state: row.state }]]) {
    await owner.db.update(matchLiveState).set({ history }).where(eq(matchLiveState.fixtureId, id));
    const response = await get(id, "", "*");
    expect(response.status).toBe(404);
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
});
it("returns only closed public fields and historical minor initials with no photo even with consent", async () => {
  const { id } = await seed();
  await owner.db.update(matches).set({ trustLevel: "verified" }).where(eq(matches.fixtureId, id));
  const [row] = await owner.db
    .select()
    .from(matchLiveState)
    .where(eq(matchLiveState.fixtureId, id));
  if (!row) throw new Error("Missing projection");
  await owner.db
    .update(matchLiveState)
    .set({
      state: {
        ...(row.state as object),
        phone: "private",
        email: "private",
        date_of_birth: "private",
        club_org_id: orgId,
        registrationStatus: "approved",
      },
    })
    .where(eq(matchLiveState.fixtureId, id));
  const state = (await (await get(id)).json()) as PublicLiveState;
  function keys(value: unknown): string[] {
    return value && typeof value === "object"
      ? Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)])
      : [];
  }
  expect(
    keys(state).filter((key) =>
      /phone|email|birth|club.?org|registration.?status|history/i.test(key),
    ),
  ).toEqual([]);
  expect(JSON.stringify(state)).not.toContain("Adrian Young");
  expect(state.batters.find((batter: { id: string }) => batter.id === reg(0))).toMatchObject({
    name: "AY",
    initials: "AY",
    photoUrl: null,
  });
});
it("gates anonymous view pings and app-role metrics without human writes", async () => {
  const { id } = await seed();
  const request = () =>
    new Request(`http://localhost/api/live/${id}/view`, { method: "POST", body: "{}" });
  expect((await POST(request(), { params: Promise.resolve({ fixtureId: id }) })).status).toBe(204);
  const identity = await publicViewerIdentity(id, {}, owner.db);
  if (!identity) throw new Error("Missing viewer identity");
  expect(await flushPublicViewer(identity, [{}], 12, app)).toBe(true);
  const [match] = await owner.db.select().from(matches).where(eq(matches.fixtureId, id));
  expect(match).toMatchObject({ viewerPeak: 12, scorerPersonId: actor, lastSeq: 6 });
  expect(await flushPublicViewer({ fixtureId: id, orgId: otherOrg }, [{}], 99, app)).toBe(false);
  await owner.db
    .update(competitions)
    .set({ visibility: "private" })
    .where(eq(competitions.id, competitionId));
  expect((await POST(request(), { params: Promise.resolve({ fixtureId: id }) })).status).toBe(404);
  expect(await flushPublicViewer(identity, [{}], 99, app)).toBe(false);
});
it("rechecks bearer revocation and preserves concurrent greatest updates", async () => {
  const { id, token } = await seed();
  const identity = { fixtureId: id, orgId };
  await Promise.all([
    flushPublicViewer(identity, [{}], 20, app),
    flushPublicViewer(identity, [{}], 7, app),
  ]);
  expect(
    (await owner.db.select().from(matches).where(eq(matches.fixtureId, id)))[0]?.viewerPeak,
  ).toBe(20);
  await owner.db
    .update(competitions)
    .set({ visibility: "private" })
    .where(eq(competitions.id, competitionId));
  expect(await flushPublicViewer(identity, [{ t: token }], 21, app)).toBe(true);
  await owner.db
    .update(matches)
    .set({ shareToken: `new-${newId()}` })
    .where(eq(matches.fixtureId, id));
  expect(await flushPublicViewer(identity, [{ t: token }], 99, app)).toBe(false);
  expect(
    (await owner.db.select().from(matches).where(eq(matches.fixtureId, id)))[0]?.viewerPeak,
  ).toBe(21);
});
it("retries a failed minute flush with the original count and never overlaps flushes", async () => {
  const { id } = await seed();
  let attempts = 0;
  const identity = { fixtureId: id, orgId };
  const buckets = new ViewerBuckets(async (who, proofs, count) => {
    attempts += 1;
    if (attempts === 1) throw new Error("Transient database failure");
    return flushPublicViewer(who, proofs, count, app);
  }, false);
  for (let i = 0; i < 4; i++) buckets.record(identity, {}, 1000, `viewer-${String(i)}`);
  await Promise.all([buckets.flush(61000), buckets.flush(61000)]);
  expect(attempts).toBe(1);
  await buckets.flush(121000);
  expect(attempts).toBe(2);
  expect(
    (await owner.db.select().from(matches).where(eq(matches.fixtureId, id)))[0]?.viewerPeak,
  ).toBe(4);
  await buckets.flush(181000);
  expect(attempts).toBe(2);
});

it("pairs charts with the delayed score and gates representation validators", async () => {
  const { id } = await seed();
  const paired = await publicLiveCharts(id, {}, now, owner.db);
  expect(paired?.live.seq).toBe(5);
  expect(paired?.charts.seq).toBe(5);
  expect(paired?.charts.innings[0]?.runs).toBe(0);
  const response = await get(id, "?view=charts");
  expect(response.status).toBe(200);
  expect(response.headers.get("etag")).toBe('"charts-5-self_scored"');
  const body = (await response.json()) as { live: PublicLiveState; charts: PublicCharts };
  expect(body.live.seq).toBe(body.charts.seq);
  expect(JSON.stringify(body.charts)).not.toMatch(
    /dateOfBirth|photoUrl|phone|email|actorPersonId|Adrian Young/,
  );
  expect((await get(id, "?view=charts", '"5"')).status).toBe(200);
  expect((await get(id, "?view=charts", 'W/"charts-5-self_scored"')).status).toBe(304);
  await owner.db
    .update(competitions)
    .set({ visibility: "private" })
    .where(eq(competitions.id, competitionId));
  const denied = await get(id, "?view=charts", '"charts-5-self_scored"');
  expect(denied.status).toBe(404);
  expect(denied.headers.get("etag")).toBeNull();
});
it("does not substitute a newer chart sidecar for a missing delayed chart", async () => {
  const { id } = await seed();
  const [row] = await owner.db
    .select()
    .from(matchLiveState)
    .where(eq(matchLiveState.fixtureId, id));
  if (!row) throw new Error("Missing snapshot");
  const stored = storedOf(row);
  for (const entry of stored.history) if (entry.state.seq === 5) delete entry.charts;
  await owner.db.update(matchLiveState).set(rowOf(stored)).where(eq(matchLiveState.fixtureId, id));
  const response = await get(id, "?view=charts", '"charts-5-self_scored"');
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("etag")).toBeNull();
  expect((await publicLive(id, {}, now, owner.db))?.seq).toBe(5);
});

it("keeps link preview score and sanitized striker on the eligible delayed snapshot", async () => {
  const { id } = await seed("published", {
    strikerId: reg(0),
    nonStrikerId: reg(1),
    bowlerId: reg(2),
    runsBat: 4,
    boundary: 4,
    extras: {},
  });
  const [fixture] = await owner.db
    .select({ number: fixtures.fixtureNumber })
    .from(fixtures)
    .where(eq(fixtures.id, id));
  if (!fixture?.number) throw new Error("Expected synthetic fixture number");
  const delayed = await publicPage({ slug, fixtureNumber: fixture.number }, owner.db, now);
  expect(delayed?.initial?.seq).toBe(5);
  expect(previewModel(delayed)).toMatchObject({
    score: "0/0",
    overs: "0",
    striker: { name: "AY", initials: "AY", runs: 0, balls: 0 },
  });
  await owner.db.update(matches).set({ trustLevel: "verified" }).where(eq(matches.fixtureId, id));
  const current = await publicPage({ slug, fixtureNumber: fixture.number }, owner.db, now);
  expect(current?.initial?.seq).toBe(6);
  expect(previewModel(current)).toMatchObject({
    score: "4/0",
    overs: "0.1",
    striker: { name: "AY", initials: "AY", runs: 4, balls: 1 },
  });
  await owner.db
    .update(competitions)
    .set({ visibility: "private" })
    .where(eq(competitions.id, competitionId));
  expect(
    previewModel(await publicPage({ slug, fixtureNumber: fixture.number }, owner.db, now)),
  ).toBeNull();
});

it("pairs overlay markers with the delayed ring and never exposes a no-ball boundary early", async () => {
  const { id } = await seed("published", {
    strikerId: reg(0),
    nonStrikerId: reg(1),
    bowlerId: reg(2),
    runsBat: 4,
    boundary: 4,
    extras: { noBall: true },
  });
  const before = await publicLiveOverlay(id, {}, new Date(recent.getTime() + 59999), owner.db);
  expect(before?.live.seq).toBe(5);
  expect(before?.overlay?.lastDelivery).toBeNull();
  const after = await publicLiveOverlay(id, {}, new Date(recent.getTime() + 60000), owner.db);
  expect(after?.live.seq).toBe(6);
  expect(after?.overlay).toMatchObject({
    seq: 6,
    lastDelivery: { seq: 6, boundary: 4, dismissal: false, sting: "four" },
  });
  expect(after?.stat).toBeNull();
});
it("leaves historical missing markers unavailable and gates overlay before conditional requests", async () => {
  const { id, token } = await seed();
  await owner.db.update(matches).set({ trustLevel: "verified" }).where(eq(matches.fixtureId, id));
  const first = await get(id, `?t=${token}&view=overlay`);
  expect(first.status).toBe(200);
  const tag = first.headers.get("etag");
  if (!tag) throw new Error("Missing overlay validator");
  expect((await get(id, `?t=${token}&view=overlay`, tag)).status).toBe(304);
  const [row] = await owner.db
    .select()
    .from(matchLiveState)
    .where(eq(matchLiveState.fixtureId, id));
  if (!row) throw new Error("Missing live state");
  const stored = storedOf(row);
  delete stored.overlay;
  for (const entry of stored.history) delete entry.overlay;
  await owner.db.update(matchLiveState).set(rowOf(stored)).where(eq(matchLiveState.fixtureId, id));
  const historical = await publicLiveOverlay(id, {}, now, owner.db);
  expect(historical?.overlay).toBeNull();
  expect(historical?.stat).toBeNull();
  await owner.db
    .update(competitions)
    .set({ visibility: "private" })
    .where(eq(competitions.id, competitionId));
  await owner.db
    .update(matches)
    .set({ shareToken: `replacement-${newId()}` })
    .where(eq(matches.fixtureId, id));
  expect((await get(id, `?t=${token}&view=overlay`, tag)).status).toBe(404);
});
it("changes the complete overlay validator when only the trusted statistic changes", async () => {
  const { id } = await seed();
  const body = await publicLiveOverlay(id, {}, now, owner.db);
  if (!body) throw new Error("Missing overlay");
  const stat = { subject: "Player", style: "Off spin", rate: 5, sample: { balls: 60, matches: 2 } };
  expect(overlayRepresentationEtag(body)).not.toBe(overlayRepresentationEtag({ ...body, stat }));
  expect(overlayRepresentationEtag({ ...body, stat })).not.toBe(
    overlayRepresentationEtag({ ...body, stat: { ...stat, rate: 6 } }),
  );
});

it("withholds a canonical wicket marker until the selected delayed snapshot is eligible", async () => {
  const { id } = await seed("published", {
    strikerId: reg(0),
    nonStrikerId: reg(1),
    bowlerId: reg(2),
    runsBat: 0,
    extras: {},
    wicket: { kind: "bowled", playerOutId: reg(0), fielderIds: [] },
  });
  expect(
    (await publicLiveOverlay(id, {}, new Date(recent.getTime() + 59999), owner.db))?.overlay
      ?.lastDelivery,
  ).toBeNull();
  expect(
    (await publicLiveOverlay(id, {}, new Date(recent.getTime() + 60000), owner.db))?.overlay
      ?.lastDelivery,
  ).toEqual({ seq: 6, boundary: null, dismissal: true, sting: "wicket" });
});

it("keeps private overlay and board bearer access tied to the exact route", async () => {
  const { id, token, number } = await seed();
  await owner.db
    .update(competitions)
    .set({ visibility: "private" })
    .where(eq(competitions.id, competitionId));
  const address = { slug, fixtureNumber: encodeURIComponent(number) };
  expect(await overlayPageFacts(address, undefined, owner.db)).toBeNull();
  expect((await overlayPageFacts(address, token, owner.db))?.fixtureId).toBe(id);
  expect(
    await overlayPageFacts({ ...address, fixtureNumber: "another" }, token, owner.db),
  ).toBeNull();
  expect(await overlayPageFacts({ ...address, slug: "another" }, token, owner.db)).toBeNull();
  expect(await overlayPageFacts(address, [token], owner.db)).toBeNull();
  expect(await overlayPageFacts({ ...address, fixtureNumber: "%FF" }, token, owner.db)).toBeNull();
});

it("C47 HTTP normalizes only the selected legacy delivery entry and strips untrusted panel fields", async () => {
  const { id } = await seed();
  const [row] = await owner.db
    .select()
    .from(matchLiveState)
    .where(eq(matchLiveState.fixtureId, id));
  if (!row) throw new Error("Missing snapshot");
  const stored = storedOf(row);
  const oldEntry = stored.history[0];
  if (!oldEntry) throw new Error("Missing delayed entry");
  const legacy = { ...oldEntry.state } as Partial<PublicLiveState>;
  delete legacy.family;
  delete legacy.panel;
  await owner.db
    .update(matchLiveState)
    .set({ history: [{ ...oldEntry, state: legacy }] })
    .where(eq(matchLiveState.fixtureId, id));
  const delayed = await publicLive(id, {}, now);
  expect(delayed).toMatchObject({
    family: "delivery",
    panel: { v: 1 },
    seq: oldEntry.state.seq,
    updatedAt: oldEntry.state.updatedAt,
  });
  expect(delayed?.seq).not.toBe(stored.seq);
  await owner.db.update(matches).set({ trustLevel: "verified" }).where(eq(matches.fixtureId, id));
  await owner.db
    .update(matchLiveState)
    .set({
      state: {
        ...rowOf(stored).state,
        panel: { v: 1, phone: "private", email: "private@example.test", history: ["private"] },
      },
    })
    .where(eq(matchLiveState.fixtureId, id));
  const response = await get(id);
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain("private");
  expect(JSON.parse(text)).toMatchObject({ family: "delivery", panel: { v: 1 }, seq: stored.seq });
  for (const invalid of [
    { family: "rally", panel: { v: 1 } },
    { family: "delivery", panel: { v: 2 } },
    { family: "delivery", panel: null },
  ]) {
    await owner.db
      .update(matchLiveState)
      .set({ state: { ...rowOf(stored).state, ...invalid } })
      .where(eq(matchLiveState.fixtureId, id));
    expect(await publicLive(id, {}, now)).toBeNull();
    expect((await get(id)).status).toBe(404);
  }
  await owner.db.update(matchLiveState).set(rowOf(stored)).where(eq(matchLiveState.fixtureId, id));
  await owner.db
    .update(competitions)
    .set({ sport: "badminton" })
    .where(eq(competitions.id, competitionId));
  expect(await publicLive(id, {}, now)).toBeNull();
});

it("does not count the scorer holding the match or either side's managers as viewers", async () => {
  const { id } = await seed();
  const manager = playerIds[0] ?? actor;
  const stranger = playerIds[1] ?? actor;
  expect(await isMatchInsider(id, actor, owner.db)).toBe(true);
  expect(await isMatchInsider(id, manager, owner.db)).toBe(false);
  const managerRow = newId();
  const seasonScorerGrant = newId();
  await owner.db.insert(teamManagers).values({
    id: managerRow,
    teamId: away,
    personId: manager,
    orgId,
    competitionId,
    role: "manager",
    source: "organizer",
    createdBy: actor,
  });
  try {
    expect(await isMatchInsider(id, manager, owner.db)).toBe(true);
    expect(await isMatchInsider(id, stranger, owner.db)).toBe(false);
    // A season scorer may score this match too (AUTH-1 arm b).
    await owner.db.insert(grants).values({
      id: seasonScorerGrant,
      personId: stranger,
      scopeType: "tournament",
      scopeId: competitionId,
      capabilitySet: "fixture:scorer",
      grantedBy: actor,
    });
    expect(await isMatchInsider(id, stranger, owner.db)).toBe(true);
  } finally {
    await owner.db.delete(teamManagers).where(eq(teamManagers.id, managerRow));
    await owner.db.delete(grants).where(eq(grants.id, seasonScorerGrant));
  }
});
