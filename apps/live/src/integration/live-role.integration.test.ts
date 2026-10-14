import {
  competitions,
  createDb,
  fixtures,
  matches,
  matchLiveState,
  newId,
  organizations,
  people,
  scoringPublicAccess,
  teams,
  type ScoringPublicProof,
} from "@desiauction/db";
import { FORMAT_PRESETS } from "@desiauction/core/scoring";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { integrationUrls } from "../env.js";
import { state } from "../test-state.js";

/**
 * F07: desiauction_live reads only through live_snapshot / live_history_entry
 * (0127). Their P-1 is SQL written a second time, so this proves it agrees with
 * `scoringPublicAccess` — the web tier's gate — on every combination that
 * gate distinguishes, and that the role can read nothing else.
 */
const { owner: ownerUrl, live: liveUrl } = integrationUrls();
const owner = createDb(ownerUrl, { max: 1 });
const live = createDb(liveUrl, { max: 1 });
const actor = newId(),
  orgId = newId(),
  otherOrg = newId(),
  competitionId = newId(),
  home = newId(),
  away = newId(),
  fixtureId = newId(),
  token = newId() + newId().slice(0, 6);
const slug = `role-${competitionId.toLowerCase()}`;

beforeAll(async () => {
  await owner.db.insert(people).values({ id: actor, name: "Role", email: `${actor}@example.test` });
  await owner.db.insert(organizations).values([
    { id: orgId, name: "Role club", slug: `role-${orgId.toLowerCase()}`, createdBy: actor },
    { id: otherOrg, name: "Other", slug: `role-${otherOrg.toLowerCase()}`, createdBy: actor },
  ]);
  await owner.db.insert(competitions).values({
    id: competitionId,
    orgId,
    name: "Role cup",
    slug,
    sport: "cricket",
    visibility: "public",
    createdBy: actor,
  });
  await owner.db
    .insert(teams)
    .values([home, away].map((id) => ({ id, orgId, competitionId, name: id, createdBy: actor })));
  await owner.db.insert(fixtures).values({
    id: fixtureId,
    orgId,
    competitionId,
    homeTeamId: home,
    awayTeamId: away,
    status: "published",
    fixtureNumber: "ROLE-1",
    seq: 1,
    createdBy: actor,
  });
  await owner.db.insert(matches).values({
    fixtureId,
    orgId,
    competitionId,
    format: FORMAT_PRESETS.t20,
    awardVersion: "cricket-v1/t20",
    shareToken: token,
    phase: "live",
  });
  const at = new Date().toISOString();
  await owner.db.insert(matchLiveState).values({
    fixtureId,
    orgId,
    competitionId,
    seq: 1,
    state: state(1, at),
    history: [{ updatedAt: at, state: state(1, at) }],
  });
});
afterAll(async () => {
  await owner.db.delete(matchLiveState).where(eq(matchLiveState.fixtureId, fixtureId));
  await owner.db.delete(matches).where(eq(matches.fixtureId, fixtureId));
  await owner.db.delete(fixtures).where(eq(fixtures.id, fixtureId));
  await owner.db.delete(teams).where(eq(teams.competitionId, competitionId));
  await owner.db.delete(competitions).where(eq(competitions.id, competitionId));
  await owner.db.delete(organizations).where(eq(organizations.id, orgId));
  await owner.db.delete(organizations).where(eq(organizations.id, otherOrg));
  await owner.db.delete(people).where(eq(people.id, actor));
  await live.sql.end();
  await owner.sql.end();
});

async function gate(proof: ScoringPublicProof): Promise<boolean> {
  const rows = await owner.db
    .select({ id: fixtures.id })
    .from(fixtures)
    .innerJoin(matches, eq(matches.fixtureId, fixtures.id))
    .innerJoin(competitions, eq(competitions.id, fixtures.competitionId))
    .innerJoin(
      matchLiveState,
      and(
        eq(matchLiveState.fixtureId, fixtures.id),
        eq(matchLiveState.orgId, fixtures.orgId),
        eq(matchLiveState.competitionId, fixtures.competitionId),
      ),
    )
    .where(scoringPublicAccess(fixtureId, proof));
  return rows.length === 1;
}
async function viaRole(proof: ScoringPublicProof): Promise<[boolean, boolean]> {
  const snapshot = await live.db.execute(
    sql`select 1 from live_snapshot(${fixtureId}, ${proof.s ?? null}, ${proof.t ?? null})`,
  );
  const [entry] = await live.db.execute<{ entry: unknown }>(
    sql`select live_history_entry(${fixtureId}, ${proof.s ?? null}, ${proof.t ?? null}, 0) as entry`,
  );
  return [snapshot.length === 1, entry?.entry != null];
}

it("agrees with scoringPublicAccess on every visibility, status, phase, org and proof", async () => {
  const proofs: ScoringPublicProof[] = [
    {},
    { s: slug },
    { s: "wrong-slug" },
    { t: token },
    { t: "wrong-token" },
    { s: slug, t: token },
    { s: "wrong-slug", t: token },
  ];
  let checked = 0;
  for (const visibility of ["public", "private"] as const)
    for (const status of ["draft", "published", "in_progress", "completed", "cancelled"] as const)
      for (const phase of ["live", "finished", "void"] as const)
        for (const competitionOrg of [orgId, otherOrg]) {
          await owner.db
            .update(competitions)
            .set({ visibility, orgId: competitionOrg })
            .where(eq(competitions.id, competitionId));
          await owner.db.update(fixtures).set({ status }).where(eq(fixtures.id, fixtureId));
          await owner.db.update(matches).set({ phase }).where(eq(matches.fixtureId, fixtureId));
          for (const proof of proofs) {
            const expected = await gate(proof);
            expect([
              visibility,
              status,
              phase,
              competitionOrg === orgId,
              proof,
              await viaRole(proof),
            ]).toEqual([
              visibility,
              status,
              phase,
              competitionOrg === orgId,
              proof,
              [expected, expected],
            ]);
            checked += 1;
          }
        }
  await owner.db
    .update(competitions)
    .set({ visibility: "public", orgId })
    .where(eq(competitions.id, competitionId));
  expect(checked).toBe(2 * 5 * 3 * 2 * 7);
});

it("reads no table directly", async () => {
  for (const table of [
    "matches",
    "match_live_state",
    "fixtures",
    "competitions",
    "people",
    "grants",
  ])
    await expect(live.sql.unsafe(`select 1 from ${table} limit 1`)).rejects.toThrow(
      /permission denied/,
    );
});
