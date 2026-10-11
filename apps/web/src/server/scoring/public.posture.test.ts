import { publicLiveState, replayMatch } from "@desiauction/core/scoring";
import {
  competitions,
  createDb,
  fixtures,
  matches,
  matchLiveState,
  newId,
  organizations,
  people,
  teams,
} from "@desiauction/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { env } from "../../env";
import { purgeOrg } from "../test-support/purge-org";
import { flushPublicViewer, publicLive, publicViewerIdentity } from "./public";
const owner = createDb(process.env["OWNER_DATABASE_URL"] ?? env.DATABASE_URL);
const actor = newId(),
  orgId = newId(),
  competitionId = newId(),
  fixtureId = newId(),
  home = newId(),
  away = newId();
const token = `share-${newId()}`;
beforeAll(async () => {
  await owner.db.insert(people).values({
    id: actor,
    name: "Public posture owner",
    email: `public-posture-${actor}@example.test`,
  });
  await owner.db.insert(organizations).values({
    id: orgId,
    name: "Public posture",
    slug: `public-posture-${orgId}`,
    createdBy: actor,
  });
  await owner.db.insert(competitions).values({
    id: competitionId,
    orgId,
    name: "Public posture cup",
    slug: `public-posture-${competitionId}`,
    sport: "cricket",
    visibility: "public",
    scoringRules: { publicDelaySeconds: 0 },
    createdBy: actor,
  });
  await owner.db.insert(teams).values(
    [home, away].map((id) => ({
      id,
      orgId,
      competitionId,
      name: `Public posture team ${id}`,
      createdBy: actor,
    })),
  );
  await owner.db.insert(fixtures).values({
    id: fixtureId,
    orgId,
    competitionId,
    homeTeamId: home,
    awayTeamId: away,
    fixtureNumber: "PUBLIC-POSTURE",
    seq: 1,
    status: "published",
    createdBy: actor,
  });
  await owner.db.insert(matches).values({
    fixtureId,
    orgId,
    competitionId,
    format: {},
    awardVersion: "cricket-v1/t20",
    shareToken: token,
  });
  const state = publicLiveState(replayMatch([]), { teams: {}, players: {} });
  await owner.db
    .insert(matchLiveState)
    .values({ fixtureId, orgId, competitionId, seq: 0, state: { ...state, history: [] } });
});
afterAll(async () => {
  await purgeOrg(owner.db, orgId);
  await owner.db.delete(people).where(eq(people.id, actor));
  await owner.sql.end();
});
it("reads only gated public projections on the least-privilege system pool", async () => {
  expect((await publicLive(fixtureId, {}))?.v).toBe(1);
  await owner.db
    .update(competitions)
    .set({ visibility: "private" })
    .where(eq(competitions.id, competitionId));
  expect(await publicLive(fixtureId, {})).toBeNull();
  expect((await publicLive(fixtureId, { t: token }))?.v).toBe(1);
});
it("flushes an anonymous metric on the app role without broadening system writes", async () => {
  const identity = await publicViewerIdentity(fixtureId, { t: token });
  if (!identity) throw new Error("Missing identity");
  expect(await flushPublicViewer(identity, [{ t: token }], 8)).toBe(true);
  expect(
    (await owner.db.select().from(matches).where(eq(matches.fixtureId, fixtureId)))[0]?.viewerPeak,
  ).toBe(8);
  expect(await flushPublicViewer({ ...identity, orgId: newId() }, [{ t: token }], 99)).toBe(false);
});
