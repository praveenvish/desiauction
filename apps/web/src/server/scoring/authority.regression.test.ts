import {
  auctions,
  auctionOwnerInvites,
  competitions,
  createDb,
  fixtureOfficials,
  fixtures,
  grants,
  newId,
  organizations,
  paddleGrants,
  people,
  teamManagers,
  teams,
  withTenantDb,
} from "@desiauction/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../../env";
import { purgeOrg } from "../test-support/purge-org";
import { rolesOf } from "../roles/roles";
import { authorityKind, mayScore } from "./authority";
import { captainBriefIn } from "../insights/brief";
import { syncAuctionOwnersToManagers } from "./managers";

const owner = createDb(env.DATABASE_URL);
const briefApp = createDb(env.APP_DATABASE_URL ?? env.DATABASE_URL);
const ids = Array.from({ length: 13 }, () => newId());
const [
  creator,
  staff,
  scorer,
  official,
  homeManager,
  awayManager,
  revoked,
  unrelated,
  inviteOwner,
  paddleOwner,
  blockedOwner,
  pendingOwner,
  practiceOwner,
] = ids as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const blockedAuctionOwner = newId();
const blockedEntryOwner = newId();
ids.push(blockedAuctionOwner, blockedEntryOwner);
const orgId = newId();
const competitionId = newId();
const fixtureId = newId();
const teamIds = [newId(), newId(), newId()];
const [homeTeamId, awayTeamId, otherTeamId] = teamIds as [string, string, string];
const auctionId = newId();
const practiceId = newId();
const fixture = { id: fixtureId, orgId, competitionId, homeTeamId, awayTeamId };
const within = <T>(personId: string, fn: (db: typeof owner.db) => Promise<T>) =>
  withTenantDb(owner, { personId, orgId }, fn);

beforeAll(async () => {
  await owner.db
    .insert(people)
    .values(
      ids.map((id) => ({ id, name: "Scoring authority", email: `authority-${id}@example.test` })),
    );
  await owner.db
    .insert(organizations)
    .values({ id: orgId, name: "Authority club", slug: `auth-${orgId}`, createdBy: creator });
  await owner.db.insert(competitions).values({
    id: competitionId,
    orgId,
    name: "Authority cup",
    slug: `auth-${competitionId}`,
    sport: "cricket",
    createdBy: creator,
  });
  await owner.db.insert(teams).values(
    teamIds.map((id, index) => ({
      id,
      orgId,
      competitionId,
      name: `Side ${String(index)}`,
      createdBy: creator,
    })),
  );
  await owner.db
    .insert(fixtures)
    .values({ ...fixture, fixtureNumber: "AUTH-F001", seq: 1, createdBy: creator });
  await owner.db.insert(grants).values([
    {
      id: newId(),
      personId: creator,
      scopeType: "org",
      scopeId: orgId,
      capabilitySet: "org:owner",
      grantedBy: creator,
    },
    {
      id: newId(),
      personId: staff,
      scopeType: "org",
      scopeId: orgId,
      capabilitySet: "org:staff",
      grantedBy: creator,
    },
    {
      id: newId(),
      personId: scorer,
      scopeType: "tournament",
      scopeId: competitionId,
      capabilitySet: "fixture:scorer",
      grantedBy: creator,
    },
    {
      id: newId(),
      personId: revoked,
      scopeType: "tournament",
      scopeId: competitionId,
      capabilitySet: "fixture:scorer",
      grantedBy: creator,
      revokedAt: new Date(),
    },
  ]);
  await owner.db.insert(fixtureOfficials).values([
    {
      id: newId(),
      orgId,
      competitionId,
      fixtureId,
      personId: official,
      role: "scorer",
      displayName: "Scorer",
      createdBy: creator,
    },
    {
      id: newId(),
      orgId,
      competitionId,
      fixtureId,
      personId: unrelated,
      role: "umpire",
      displayName: "Umpire",
      createdBy: creator,
    },
    {
      id: newId(),
      orgId,
      competitionId,
      fixtureId,
      personId: revoked,
      role: "scorer",
      displayName: "Removed",
      createdBy: creator,
      removedAt: new Date(),
    },
  ]);
  await owner.db.insert(teamManagers).values([
    {
      id: newId(),
      orgId,
      competitionId,
      teamId: homeTeamId,
      personId: homeManager,
      role: "captain",
      source: "organizer",
      createdBy: creator,
    },
    {
      id: newId(),
      orgId,
      competitionId,
      teamId: awayTeamId,
      personId: awayManager,
      role: "manager",
      source: "team_entry",
      createdBy: creator,
    },
    {
      id: newId(),
      orgId,
      competitionId,
      teamId: homeTeamId,
      personId: revoked,
      role: "manager",
      source: "organizer",
      createdBy: creator,
      revokedAt: new Date(),
    },
    {
      id: newId(),
      orgId,
      competitionId,
      teamId: otherTeamId,
      personId: unrelated,
      role: "manager",
      source: "organizer",
      createdBy: creator,
    },
    {
      id: newId(),
      orgId,
      competitionId,
      teamId: homeTeamId,
      personId: blockedOwner,
      role: "captain",
      source: "organizer",
      createdBy: creator,
      revokedAt: new Date(),
    },
  ]);
  await owner.db.insert(teamManagers).values([
    {
      id: newId(),
      orgId,
      competitionId,
      teamId: homeTeamId,
      personId: blockedAuctionOwner,
      role: "manager",
      source: "auction_owner",
      createdBy: creator,
      revokedAt: new Date(),
    },
    {
      id: newId(),
      orgId,
      competitionId,
      teamId: homeTeamId,
      personId: blockedEntryOwner,
      role: "manager",
      source: "team_entry",
      createdBy: creator,
      revokedAt: new Date(),
    },
    {
      id: newId(),
      orgId,
      competitionId,
      teamId: otherTeamId,
      personId: inviteOwner,
      role: "manager",
      source: "organizer",
      createdBy: creator,
      revokedAt: new Date(),
    },
  ]);
  await owner.db.insert(auctions).values([
    {
      id: auctionId,
      orgId,
      competitionId,
      name: "Real auction",
      status: "completed",
      config: {},
      createdBy: creator,
    },
    {
      id: practiceId,
      orgId,
      competitionId,
      name: "Practice",
      status: "completed",
      kind: "practice",
      config: {},
      createdBy: creator,
    },
  ]);
  await owner.db.insert(auctionOwnerInvites).values([
    {
      id: newId(),
      orgId,
      auctionId,
      teamId: homeTeamId,
      tokenHash: newId(),
      createdBy: creator,
      expiresAt: new Date(),
      acceptedBy: inviteOwner,
      acceptedAt: new Date(),
    },
    {
      id: newId(),
      orgId,
      auctionId,
      teamId: homeTeamId,
      tokenHash: newId(),
      createdBy: creator,
      expiresAt: new Date(),
      acceptedBy: blockedOwner,
      acceptedAt: new Date(),
    },
    {
      id: newId(),
      orgId,
      auctionId,
      teamId: homeTeamId,
      tokenHash: newId(),
      createdBy: creator,
      expiresAt: new Date(),
      acceptedBy: pendingOwner,
    },
    {
      id: newId(),
      orgId,
      auctionId: practiceId,
      teamId: homeTeamId,
      tokenHash: newId(),
      createdBy: creator,
      expiresAt: new Date(),
      acceptedBy: practiceOwner,
      acceptedAt: new Date(),
    },
  ]);
  await owner.db.insert(auctionOwnerInvites).values(
    [blockedAuctionOwner, blockedEntryOwner].map((personId) => ({
      id: newId(),
      orgId,
      auctionId,
      teamId: homeTeamId,
      tokenHash: newId(),
      createdBy: creator,
      expiresAt: new Date(),
      acceptedBy: personId,
      acceptedAt: new Date(),
    })),
  );
  await owner.db.insert(paddleGrants).values([
    {
      id: newId(),
      orgId,
      auctionId,
      teamId: homeTeamId,
      personId: inviteOwner,
      grantedBy: creator,
    },
    {
      id: newId(),
      orgId,
      auctionId,
      teamId: awayTeamId,
      personId: paddleOwner,
      grantedBy: creator,
    },
    {
      id: newId(),
      orgId,
      auctionId,
      teamId: awayTeamId,
      personId: revoked,
      grantedBy: creator,
      revokedAt: new Date(),
    },
  ]);
});
afterAll(async () => {
  await purgeOrg(owner.db, orgId);
  for (const id of ids) await owner.db.delete(people).where(eq(people.id, id));
  await briefApp.sql.end({ timeout: 5 });
  await owner.sql.end();
});

describe("AUTH-1 scoring authority", () => {
  it("recognizes owners and staff before weaker arms", async () => {
    for (const personId of [creator, staff])
      expect(await within(personId, (db) => authorityKind(db, personId, fixture))).toBe("a");
  });
  it("recognizes only the season's active scorer grant", async () => {
    expect(await within(scorer, (db) => authorityKind(db, scorer, fixture))).toBe("b");
    expect(
      await within(scorer, (db) => mayScore(db, scorer, { ...fixture, competitionId: newId() })),
    ).toBe(false);
  });
  it("recognizes active scorer officials and either side's managers", async () => {
    for (const [personId, arm] of [
      [official, "c"],
      [homeManager, "d"],
      [awayManager, "d"],
    ] as const)
      expect(await within(personId, (db) => authorityKind(db, personId, fixture))).toBe(arm);
  });
  it("refuses revoked grants, removed officials, revoked and unrelated managers", async () => {
    for (const personId of [revoked, unrelated, pendingOwner])
      expect(await within(personId, (db) => mayScore(db, personId, fixture))).toBe(false);
  });
  it("syncs accepted real-auction owners idempotently without reviving revocations", async () => {
    await within(creator, (db) => syncAuctionOwnersToManagers(db, competitionId, creator));
    await within(creator, (db) => syncAuctionOwnersToManagers(db, competitionId, creator));
    const rows = await owner.db
      .select()
      .from(teamManagers)
      .where(
        and(
          eq(teamManagers.competitionId, competitionId),
          eq(teamManagers.source, "auction_owner"),
          isNull(teamManagers.revokedAt),
        ),
      );
    expect(rows.map((row) => row.personId).sort()).toEqual([inviteOwner, paddleOwner].sort());
    for (const personId of [inviteOwner, paddleOwner])
      expect(await within(personId, (db) => authorityKind(db, personId, fixture))).toBe("d");
    expect(await within(blockedOwner, (db) => mayScore(db, blockedOwner, fixture))).toBe(false);
  });
  it("honors all historical revocation sources but allows an explicit later regrant", async () => {
    for (const personId of [blockedOwner, blockedAuctionOwner, blockedEntryOwner])
      expect(await within(personId, (db) => mayScore(db, personId, fixture))).toBe(false);
    await within(creator, async (db) => {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`ls1-manager:${orgId}:${competitionId}:${homeTeamId}:${blockedOwner}`}, 0))`,
      );
      await db.insert(teamManagers).values({
        id: newId(),
        orgId,
        competitionId,
        teamId: homeTeamId,
        personId: blockedOwner,
        role: "manager",
        source: "organizer",
        createdBy: creator,
      });
    });
    expect(await within(blockedOwner, (db) => authorityKind(db, blockedOwner, fixture))).toBe("d");
  });
  it("projects unique scoring seasons from grants, officials and active managers", async () => {
    for (const personId of [scorer, official, homeManager, awayManager])
      expect((await rolesOf(personId)).scores.map((row) => row.competitionId)).toEqual([
        competitionId,
      ]);
    expect((await rolesOf(revoked)).scores).toEqual([]);
  });
});

it("authorizes captain briefs before evaluating the tier and isolates opposing sides", async () => {
  const briefWithin = <T>(personId: string, fn: (db: typeof owner.db) => Promise<T>) =>
    withTenantDb(briefApp, { personId, orgId }, fn);
  await owner.db
    .update(competitions)
    .set({ tier: "free" })
    .where(eq(competitions.id, competitionId));
  for (const personId of [creator, homeManager, awayManager]) {
    expect(
      await briefWithin(personId, (db) => captainBriefIn(db, personId, competitionId, fixtureId)),
    ).toEqual({ locked: true });
  }
  for (const personId of [unrelated, revoked, scorer, official]) {
    expect(
      await briefWithin(personId, (db) => captainBriefIn(db, personId, competitionId, fixtureId)),
    ).toBeNull();
  }
  for (const tier of ["pro", "association"] as const) {
    await owner.db.update(competitions).set({ tier }).where(eq(competitions.id, competitionId));
    const homeBrief = await briefWithin(homeManager, (db) =>
      captainBriefIn(db, homeManager, competitionId, fixtureId),
    );
    expect(homeBrief?.locked).toBe(false);
    if (!homeBrief || homeBrief.locked) throw new Error("Missing entitled brief");
    expect(homeBrief.teams.map((team) => team.id)).toEqual([awayTeamId]);
    expect(homeBrief.players).toEqual([]);
    const organizer = await briefWithin(creator, (db) =>
      captainBriefIn(db, creator, competitionId, fixtureId),
    );
    if (!organizer || organizer.locked) throw new Error("Missing organizer brief");
    expect(organizer.teams.map((team) => team.id).sort()).toEqual([homeTeamId, awayTeamId].sort());
    expect(
      await briefWithin(unrelated, (db) => captainBriefIn(db, unrelated, competitionId, fixtureId)),
    ).toBeNull();
    expect(
      await briefWithin(creator, (db) => captainBriefIn(db, creator, newId(), fixtureId)),
    ).toBeNull();
  }
});
