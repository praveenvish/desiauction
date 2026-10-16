import {
  franchises,
  competitions,
  createDb,
  fixtures,
  newId,
  organizations,
  people,
  registrations,
  teams,
  withTenantDb,
} from "@desiauction/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../../env";
import { purgeOrg } from "../test-support/purge-org";
import { orgsFor } from "../orgs/orgs";
import { publicCompetitionsDirectory } from "../competition/public";
import { organizationDirectory } from "../admin/views";
import { rolesOf } from "../roles/roles";
import { addScoringGuest } from "./guests";
import { startScoredMatch } from "./start";
import { appendScoringEvents, type ClientEvent } from "./append";
import { reviewMatchTrust } from "./trust-review";
import { updateMatchTrust } from "./trust";
import { replayMatch } from "@desiauction/core/scoring";
import { matchEvents, matches } from "@desiauction/db";
import { persistedMatchEvent } from "./persisted-event";
import { scoringSetup } from "./home";
import { ensurePersonalOrg, createQuickFixture, reuseQuickPlayer } from "./quick-match";

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing quick-match fixture value");
  return value;
}
const owner = createDb(env.DATABASE_URL),
  app = env.APP_DATABASE_URL ? createDb(env.APP_DATABASE_URL) : owner;
const actor = newId(),
  stranger = newId(),
  minted = newId();
let orgId: string;
let otherOrgId: string | undefined;
const input = {
  sport: "cricket",
  homeName: "Sunday Smashers",
  awayName: "Panthers",
  formatKey: "t10",
};
const within = <T>(fn: (db: typeof owner.db) => Promise<T>) =>
  withTenantDb(app, { personId: actor, orgId }, fn);
const create = (year = 2026, raw: unknown = input) =>
  within((db) =>
    createQuickFixture(db, orgId, actor, raw, new Date(`${String(year)}-10-10T10:00:00Z`)),
  );

beforeAll(async () => {
  await owner.db.insert(people).values([
    { id: actor, name: "Quick scorer", phone: `+9191${actor.slice(-8)}` },
    { id: stranger, name: "Other scorer", phone: `+9192${stranger.slice(-8)}` },
  ]);
  orgId = await withTenantDb(app, { personId: actor, orgId: minted }, (db) =>
    ensurePersonalOrg(db, actor, minted),
  );
});
afterAll(async () => {
  if (orgId) await purgeOrg(owner.db, orgId);
  if (otherOrgId) await purgeOrg(owner.db, otherOrgId);
  await owner.db.delete(people).where(eq(people.id, actor));
  await owner.db.delete(people).where(eq(people.id, stranger));
  if (app !== owner) await app.sql.end({ timeout: 5 });
  await owner.sql.end({ timeout: 5 });
});

describe("personal quick matches", () => {
  it("creates one personal organization even for concurrent requests", async () => {
    const ids = await Promise.all(
      Array.from({ length: 4 }, () => {
        const id = newId();
        return withTenantDb(app, { personId: actor, orgId: id }, (db) =>
          ensurePersonalOrg(db, actor, id),
        );
      }),
    );
    expect(new Set(ids)).toEqual(new Set([orgId]));
    const rows = await owner.db
      .select()
      .from(organizations)
      .where(eq(organizations.createdBy, actor));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "personal",
      name: "Quick scorer's matches",
      slug: `p-${orgId.toLowerCase()}`,
    });
  });
  it("serializes annual teams, competition and fixture sequence", async () => {
    const matches = await Promise.all(Array.from({ length: 4 }, () => create()));
    expect(new Set(matches.map((match) => match.competitionId)).size).toBe(1);
    expect(new Set(matches.map((match) => match.homeTeamId)).size).toBe(1);
    expect(new Set(matches.map((match) => match.awayTeamId)).size).toBe(1);
    expect(new Set(matches.map((match) => match.fixtureId)).size).toBe(4);
    const rows = await owner.db
      .select()
      .from(fixtures)
      .where(eq(fixtures.competitionId, must(matches[0]).competitionId));
    expect(new Set(rows.map((row) => row.seq)).size).toBe(4);
  });
  it("keeps prior annual rows and fixtures unchanged on rollover", async () => {
    const old = await create();
    const before = await owner.db.select().from(teams).where(eq(teams.id, old.homeTeamId));
    const oldFixture = await owner.db.select().from(fixtures).where(eq(fixtures.id, old.fixtureId));
    const next = await create(2027);
    expect(next.competitionId).not.toBe(old.competitionId);
    expect(next.homeTeamId).not.toBe(old.homeTeamId);
    const newer = await owner.db.select().from(teams).where(eq(teams.id, next.homeTeamId));
    expect(newer[0]?.franchiseId).toBe(before[0]?.franchiseId);
    expect(await owner.db.select().from(teams).where(eq(teams.id, old.homeTeamId))).toEqual(before);
    expect(await owner.db.select().from(fixtures).where(eq(fixtures.id, old.fixtureId))).toEqual(
      oldFixture,
    );
  });
  it("separates same-name teams by sport", async () => {
    const cricket = await create();
    const box = await create(2026, { ...input, sport: "box_cricket", formatKey: "box_6" });
    const rows = await owner.db.select().from(teams).where(eq(teams.orgId, orgId));
    expect(rows.find((row) => row.id === cricket.homeTeamId)?.franchiseId).not.toBe(
      rows.find((row) => row.id === box.homeTeamId)?.franchiseId,
    );
  });
  it("refuses another person's space and conflicting names/formats", async () => {
    await expect(
      withTenantDb(app, { personId: stranger, orgId }, (db) =>
        createQuickFixture(db, orgId, stranger, input),
      ),
    ).rejects.toThrow("not yours");
    await expect(create(2026, { ...input, awayName: input.homeName })).rejects.toThrow("different");
    await expect(create(2026, { ...input, sport: "box_cricket" })).rejects.toThrow("format");
  });
  it("reuses a previous person in a new annual registration without rewriting the old one", async () => {
    const old = await create();
    const guest = await within((db) =>
      addScoringGuest(db, old.fixtureId, actor, {
        teamId: old.homeTeamId,
        name: "Returning player",
      }),
    );
    if (!guest.ok) throw new Error(guest.message);
    const [before] = await owner.db
      .select()
      .from(registrations)
      .where(eq(registrations.id, guest.registrationId));
    const next = await create(2027);
    const id = await within((db) =>
      reuseQuickPlayer(db, orgId, actor, next.competitionId, next.homeTeamId, guest.registrationId),
    );
    const [after] = await owner.db.select().from(registrations).where(eq(registrations.id, id));
    expect(id).not.toBe(guest.registrationId);
    expect(after?.personId).toBe(before?.personId);
    expect(
      await owner.db.select().from(registrations).where(eq(registrations.id, guest.registrationId)),
    ).toEqual([before]);
    expect(
      await within((db) =>
        reuseQuickPlayer(
          db,
          orgId,
          actor,
          next.competitionId,
          next.homeTeamId,
          guest.registrationId,
        ),
      ),
    ).toBe(id);
    await expect(
      within((db) =>
        reuseQuickPlayer(
          db,
          orgId,
          actor,
          next.competitionId,
          next.awayTeamId,
          guest.registrationId,
        ),
      ),
    ).rejects.toThrow("assigned elsewhere");
    const [still] = await owner.db.select().from(registrations).where(eq(registrations.id, id));
    expect(still).toEqual(after);
  });
  it("hides personal spaces from club navigation and separates admin counts", async () => {
    expect(await within((db) => orgsFor(db, actor))).toEqual([]);
    const directory = await organizationDirectory(owner.db, { query: orgId });
    expect(directory.rows).toEqual([]);
    expect(directory.personalTotal).toBeGreaterThan(0);
    const clubs = await owner.db.select().from(organizations).where(eq(organizations.kind, "club"));
    expect(directory.platformTotal).toBe(clubs.length);
    expect((await rolesOf(actor)).organizes).toEqual([]);
  });
  it("keeps the chosen format on this fixture without changing other annual matches", async () => {
    const first = await create();
    const second = await create(2026, { ...input, formatKey: "six_over" });
    expect((await within((db) => scoringSetup(db, first.fixtureId, actor)))?.format.key).toBe(
      "t10",
    );
    expect((await within((db) => scoringSetup(db, second.fixtureId, actor)))?.format.key).toBe(
      "six_over",
    );
    const seasons = await owner.db
      .select()
      .from(competitions)
      .where(and(eq(competitions.orgId, orgId), eq(competitions.sport, "cricket")));
    expect(seasons.every((season) => season.visibility === "private")).toBe(true);
  });
  it("persists the personal trust cap through real scoring and canonical trust refresh", async () => {
    const fixture = await create(2029, { ...input, sport: "box_cricket", formatKey: "box_6" });
    const rosters: string[][] = [];
    for (const [side, teamId] of [fixture.homeTeamId, fixture.awayTeamId].entries()) {
      const ids: string[] = [];
      for (let i = 0; i < 6; i++) {
        const guest = await within((db) =>
          addScoringGuest(db, fixture.fixtureId, actor, {
            teamId,
            name: `Personal ${String(side)} player ${String(i)}`,
          }),
        );
        if (!guest.ok) throw new Error(guest.message);
        ids.push(guest.registrationId);
      }
      rosters.push(ids);
    }
    const home = must(rosters[0]),
      away = must(rosters[1]),
      deviceId = "quick-cap";
    const started = await within((db) =>
      startScoredMatch(db, fixture.fixtureId, actor, {
        deviceId,
        formatKey: "box_6",
        conditions: {},
        lineups: [fixture.homeTeamId, fixture.awayTeamId].map((teamId, i) => ({
          teamId,
          battingOrder: must(rosters[i]),
          captainId: must(must(rosters[i])[0]),
          keeperId: must(must(rosters[i])[1]),
          substitutes: [],
        })),
      }),
    );
    expect(started.ok).toBe(true);
    const raw = [
      { type: "toss", payload: { winnerTeamId: fixture.homeTeamId, decision: "bat" } },
      {
        type: "innings_started",
        payload: {
          inningsNo: 1,
          battingTeamId: fixture.homeTeamId,
          strikerId: home[0],
          nonStrikerId: home[1],
          bowlerId: away[0],
        },
      },
      {
        type: "ball",
        payload: {
          strikerId: home[0],
          nonStrikerId: home[1],
          bowlerId: away[0],
          runsBat: 0,
          extras: {},
        },
      },
      { type: "innings_closed", payload: { reason: "forfeit" } },
      {
        type: "innings_started",
        payload: {
          inningsNo: 2,
          battingTeamId: fixture.awayTeamId,
          strikerId: away[0],
          nonStrikerId: away[1],
          bowlerId: home[0],
        },
      },
      {
        type: "ball",
        payload: {
          strikerId: away[0],
          nonStrikerId: away[1],
          bowlerId: home[0],
          runsBat: 1,
          extras: {},
        },
      },
      { type: "finish", payload: {} },
    ];
    const events = raw.map((event, i) => ({
      ...event,
      eventId: newId(),
      attempt: 1,
      v: 1,
      targetEventId: null,
      clientSeq: i + 1,
      clientRecordedAt: new Date().toISOString(),
    })) as ClientEvent[];
    const appended = await within((db) =>
      appendScoringEvents(db, fixture.fixtureId, actor, { deviceId, attempt: 1, events }),
    );
    expect(appended.ok).toBe(true);
    const [match] = await owner.db
      .select()
      .from(matches)
      .where(eq(matches.fixtureId, fixture.fixtureId));
    expect(match?.trustLevel).not.toBe("verified");
    const rows = await owner.db
      .select()
      .from(matchEvents)
      .where(eq(matchEvents.fixtureId, fixture.fixtureId))
      .orderBy(matchEvents.seq);
    const state = replayMatch(rows.map(persistedMatchEvent));
    const trust = await within((db) =>
      updateMatchTrust(db, fixture.fixtureId, state, new Date(), { refreshSnapshot: true }),
    );
    expect(trust.level).not.toBe("verified");
    const review = await within((db) =>
      reviewMatchTrust(db, {
        fixtureId: fixture.fixtureId,
        orgId,
        personId: actor,
        reason: "Verified the complete friendly",
        disposition: "verify",
        authority: "organizer",
        attempt: state.attempt,
        lastSeq: state.lastSeq,
      }),
    );
    expect(review.ok).toBe(true);
    if (review.ok) expect(review.trust).toBe("confirmed");
  });
  it("keeps same-name teams and previous registrations isolated between owners", async () => {
    const id = newId();
    otherOrgId = await withTenantDb(app, { personId: stranger, orgId: id }, (db) =>
      ensurePersonalOrg(db, stranger, id),
    );
    const otherId = otherOrgId;
    const foreign = await withTenantDb(app, { personId: stranger, orgId: otherId }, (db) =>
      createQuickFixture(db, otherId, stranger, input, new Date("2026-10-10T10:00:00Z")),
    );
    const own = await create();
    expect(foreign.competitionId).not.toBe(own.competitionId);
    const ownTeam = await owner.db.select().from(teams).where(eq(teams.id, own.homeTeamId));
    const foreignTeam = await owner.db.select().from(teams).where(eq(teams.id, foreign.homeTeamId));
    expect(foreignTeam[0]?.franchiseId).not.toBe(ownTeam[0]?.franchiseId);
    const [previous] = await owner.db
      .select()
      .from(registrations)
      .where(eq(registrations.orgId, orgId))
      .limit(1);
    if (!previous) throw new Error("Missing previous personal registration");
    await expect(
      withTenantDb(app, { personId: stranger, orgId: otherId }, (db) =>
        reuseQuickPlayer(
          db,
          otherId,
          stranger,
          foreign.competitionId,
          foreign.homeTeamId,
          previous.id,
        ),
      ),
    ).rejects.toThrow("previous players");
  });
  it("excludes personal competitions from public directories even if visibility is changed", async () => {
    const fixture = await create(2032);
    await owner.db
      .update(competitions)
      .set({ visibility: "public" })
      .where(eq(competitions.id, fixture.competitionId));
    try {
      const result = await publicCompetitionsDirectory({ q: "Friendlies 2032" });
      expect(JSON.stringify(result)).not.toContain(fixture.competitionId);
      expect(JSON.stringify(result)).not.toContain(`p-${fixture.competitionId.toLowerCase()}`);
    } finally {
      await owner.db
        .update(competitions)
        .set({ visibility: "private" })
        .where(eq(competitions.id, fixture.competitionId));
    }
  });
  it("refuses ambiguous franchise identities instead of choosing one", async () => {
    const other = await create(2033);
    const franchiseId = newId();
    await owner.db
      .insert(franchises)
      .values({ id: franchiseId, orgId, name: input.homeName, createdBy: actor });
    await owner.db.update(teams).set({ franchiseId }).where(eq(teams.id, other.homeTeamId));
    await expect(create(2026)).rejects.toThrow("more than one identity");
  });
});
