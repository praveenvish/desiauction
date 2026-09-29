// WHO MAY PICK A LINEUP (founder, 2026-09-29), against real Postgres. The
// contract: the organizer picks both sides; a team's owner — holding its
// paddle, or having accepted its owner invite — picks THAT team's side and no
// other; a released paddle or a revoked invite grants nothing; a plain member
// picks nothing. And an owner opening a match is shown their own side only.
import { DEFAULT_AUCTION_CONFIG } from "@desiauction/core";
import {
  auctionOwnerInvites,
  auctions,
  auditLog,
  createDb,
  newId,
  orgMembers,
  paddles,
  people,
  type DbHandle,
} from "@desiauction/db";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { createOrg } from "../orgs/orgs";
import { purgeOrg } from "../test-support/purge-org";
import { createCompetition, createTeam, type CompetitionSummary } from "./competitions";
import { lineupSidesFor, mayPickLineup } from "./lineup-access";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

let orgId = "";
let comp: CompetitionSummary = null as unknown as CompetitionSummary;
let teamA = "";
let teamB = "";
const person = {
  organizer: newId(),
  paddleOwner: newId(), // holds team A's paddle
  inviteOwner: newId(), // accepted team B's owner invite
  released: newId(), // held team B's paddle, released it
  revoked: newId(), // accepted an invite for team A, since revoked
  member: newId(), // a club member, owns nothing
};

beforeAll(async () => {
  await db.insert(people).values(
    Object.values(person).map((id, index) => ({
      id,
      phone: `+9194${RUN}${String(index)}`,
      name: `Lineup Access ${String(index)}`,
    })),
  );
  const org = await createOrg(db, person.organizer, `Lineup Access ${RUN}`);
  orgId = org.id;
  comp = await createCompetition(db, orgId, person.organizer, {
    name: `Lineup Access League ${RUN}`,
    sport: "cricket",
    location: "Thane",
    startsOn: "2026-10-01",
    endsOn: "2026-11-30",
  });
  for (const [name, set] of [
    ["Alpha", (id: string) => (teamA = id)],
    ["Bravo", (id: string) => (teamB = id)],
  ] as const) {
    const made = await createTeam(db, orgId, comp.id, person.organizer, name);
    if (!made.ok) throw new Error("team");
    set(made.team.id);
  }
  await db
    .insert(orgMembers)
    .values(
      [person.paddleOwner, person.inviteOwner, person.released, person.revoked, person.member].map(
        (personId) => ({ orgId, personId }),
      ),
    );
  const auctionId = newId();
  await db.insert(auctions).values({
    id: auctionId,
    orgId,
    competitionId: comp.id,
    name: "Lineup Access Auction",
    status: "completed",
    config: DEFAULT_AUCTION_CONFIG,
    createdBy: person.organizer,
  });
  await db.insert(paddles).values([
    {
      id: newId(),
      orgId,
      auctionId,
      teamId: teamA,
      personId: person.paddleOwner,
      paddleNumber: "P01",
    },
    {
      id: newId(),
      orgId,
      auctionId,
      teamId: teamB,
      personId: person.released,
      paddleNumber: "P02",
      releasedAt: new Date(),
    },
  ]);
  const invite = (teamId: string, acceptedBy: string, revoked: boolean) => ({
    id: newId(),
    orgId,
    auctionId,
    teamId,
    tokenHash: `lineup-access-${RUN}-${newId()}`,
    createdBy: person.organizer,
    expiresAt: new Date(Date.now() + 86_400_000),
    acceptedBy,
    acceptedAt: new Date(),
    ...(revoked ? { revokedAt: new Date() } : {}),
  });
  await db
    .insert(auctionOwnerInvites)
    .values([invite(teamB, person.inviteOwner, false), invite(teamA, person.revoked, true)]);
});

afterAll(async () => {
  if (orgId !== "") await purgeOrg(db, orgId);
  const ids = Object.values(person);
  await db.delete(auditLog).where(inArray(auditLog.actor, ids));
  await db.delete(people).where(inArray(people.id, ids));
  await handle.sql.end();
});

describe("mayPickLineup", () => {
  const may = (personId: string, teamId: string) => mayPickLineup(db, personId, comp, teamId);

  it("lets the organizer pick both sides", async () => {
    expect(await may(person.organizer, teamA)).toBe(true);
    expect(await may(person.organizer, teamB)).toBe(true);
  });

  it("lets a paddle holder pick their own team only", async () => {
    expect(await may(person.paddleOwner, teamA)).toBe(true);
    expect(await may(person.paddleOwner, teamB)).toBe(false);
  });

  it("lets an accepted owner invite pick its team only", async () => {
    expect(await may(person.inviteOwner, teamB)).toBe(true);
    expect(await may(person.inviteOwner, teamA)).toBe(false);
  });

  it("grants nothing for a released paddle or a revoked invite", async () => {
    expect(await may(person.released, teamB)).toBe(false);
    expect(await may(person.revoked, teamA)).toBe(false);
  });

  it("refuses a club member who owns no team", async () => {
    expect(await may(person.member, teamA)).toBe(false);
    expect(await may(person.member, teamB)).toBe(false);
  });
});

describe("lineupSidesFor", () => {
  const sides = [{ teamId: "home" }, { teamId: "away" }];

  it("shows the organizer both sides", () => {
    expect(lineupSidesFor(sides, { canManage: true, ownedTeams: [] })).toEqual(sides);
  });

  it("shows an owner their own side, never the rival's squad", () => {
    expect(lineupSidesFor(sides, { canManage: false, ownedTeams: ["away"] })).toEqual([
      { teamId: "away" },
    ]);
  });

  it("shows nobody else a side", () => {
    expect(lineupSidesFor(sides, { canManage: false, ownedTeams: [] })).toEqual([]);
    expect(lineupSidesFor(sides, { canManage: false, ownedTeams: ["elsewhere"] })).toEqual([]);
  });
});
