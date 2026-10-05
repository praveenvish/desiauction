// AN AUCTION HELD ELSEWHERE (0110), against real Postgres.
//
// A season marked `imported` copies another auction's results in on the Teams
// tab. Its public squad pages show each placed player as they are typed — not
// only the captain and icon — and publishing must not lose or double anyone,
// including a player placed without a price (who gets no lot).
import { DEFAULT_POINTS_AUCTION_CONFIG, registrationNumber } from "@desiauction/core";
import {
  auctionEvents as auctionEventsTable,
  auctions as auctionsTable,
  auditLog,
  competitions as competitionsTable,
  createDb,
  grants as grantsTable,
  lots as lotsTable,
  newId,
  organizations,
  orgMembers,
  paddles as paddlesTable,
  people,
  registrations as registrationsTable,
  teams as teamsTable,
  type DbHandle,
} from "@desiauction/db";
import { publishResultsByHand } from "@desiauction/auction";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { createOrg } from "../orgs/orgs";
import {
  auctionSourceLocked,
  createCompetition,
  createTeam,
  updateCompetitionDetails,
  type CompetitionSummary,
} from "./competitions";
import { publicTeam, teamSlugOf } from "./public";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);
const TEAM = `Import Kings ${RUN}`;

let owner = "";
let orgId = "";
let comp: CompetitionSummary = null as unknown as CompetitionSummary;
let teamId = "";
const personIds: string[] = [];
/** captain (pre-signed), placed at 700, placed with no price, never placed. */
const reg = { captain: "", priced: "", free: "", left: "" };

async function seed(
  suffix: string,
  name: string,
  fields: { teamId?: string; isCaptain?: boolean; offlinePrice?: number } = {},
): Promise<string> {
  const personId = newId();
  await db.insert(people).values({ id: personId, phone: `+9194${RUN}${suffix}`, name });
  personIds.push(personId);
  const id = newId();
  await db.insert(registrationsTable).values({
    id,
    orgId,
    competitionId: comp.id,
    personId,
    role: "batter",
    status: "approved",
    registrationNumber: registrationNumber(id),
    ...fields,
  });
  return id;
}

const squad = async () => {
  const team = await publicTeam(comp.slug, teamSlugOf(TEAM));
  if (team === null) throw new Error("team page missing");
  return team;
};

const details = (auctionSource: "app" | "imported") =>
  updateCompetitionDetails(db, comp, owner, {
    name: comp.name,
    location: comp.location,
    startsOn: comp.startsOn,
    endsOn: comp.endsOn,
    auctionSource,
  });

beforeAll(async () => {
  owner = newId();
  await db.insert(people).values({ id: owner, phone: `+9194${RUN}00`, name: "Organizer" });
  orgId = (await createOrg(db, owner, `Import Club ${RUN}`)).id;
  comp = await createCompetition(db, orgId, owner, {
    sport: "cricket",
    name: `Import Cup ${RUN}`,
    location: "Jodhpur",
    startsOn: "2026-10-01",
    endsOn: "2026-10-30",
  });
  await db
    .update(competitionsTable)
    .set({ visibility: "public" })
    .where(eq(competitionsTable.id, comp.id));
  const team = await createTeam(db, orgId, comp.id, owner, TEAM);
  if (!team.ok) throw new Error("team setup failed");
  teamId = team.team.id;
  reg.captain = await seed("01", "Captain Kalu", { teamId, isCaptain: true });
  reg.priced = await seed("02", "Priced Mukesh", { teamId, offlinePrice: 700 * 100 });
  reg.free = await seed("03", "Free Ramesh", { teamId });
  reg.left = await seed("04", "Left Suresh");
});

afterAll(async () => {
  if (orgId !== "") {
    await db.delete(auctionEventsTable).where(eq(auctionEventsTable.orgId, orgId));
    await db.delete(lotsTable).where(eq(lotsTable.orgId, orgId));
    await db.delete(paddlesTable).where(eq(paddlesTable.orgId, orgId));
    await db.delete(auctionsTable).where(eq(auctionsTable.orgId, orgId));
    await db.delete(registrationsTable).where(eq(registrationsTable.orgId, orgId));
    await db.delete(teamsTable).where(eq(teamsTable.orgId, orgId));
    await db.delete(competitionsTable).where(eq(competitionsTable.orgId, orgId));
    await db.delete(grantsTable).where(eq(grantsTable.scopeId, orgId));
    await db.delete(orgMembers).where(eq(orgMembers.orgId, orgId));
    await db.delete(auditLog).where(eq(auditLog.scopeId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
  }
  const everyone = [owner, ...personIds].filter((id) => id !== "");
  await db.delete(auditLog).where(inArray(auditLog.actor, everyone));
  await db.delete(people).where(inArray(people.id, everyone));
  await handle.sql.end();
});

describe("AN AUCTION HELD ELSEWHERE (0110)", () => {
  it("starts as an in-app season: only the pre-signed captain is public", async () => {
    expect(comp.auctionSource).toBe("app");
    const team = await squad();
    expect(team.auctionSource).toBe("app");
    expect(team.members.map((m) => m.registrationId)).toEqual([reg.captain]);
  });

  it("once imported, shows every placed player as typed, before any publish", async () => {
    const result = await details("imported");
    expect(result.ok).toBe(true);
    if (result.ok) comp = result.competition;
    const team = await squad();
    expect(team.auctionSource).toBe("imported");
    expect(team.members.map((m) => [m.registrationId, m.pricePaise, m.marks])).toEqual([
      [reg.captain, null, ["captain"]],
      [reg.priced, 70_000, []],
      [reg.free, null, []],
    ]);
    expect(team.spentPaise).toBe(70_000);
  });

  it("after publishing, lists each player once — the priceless one included", async () => {
    const published = await publishResultsByHand(db, comp, owner, {
      ...DEFAULT_POINTS_AUCTION_CONFIG,
      squadMin: 1,
      squadMax: 5,
    });
    expect(published.ok).toBe(true);
    const team = await squad();
    expect(team.members.map((m) => m.registrationId).sort()).toEqual(
      [reg.captain, reg.priced, reg.free].sort(),
    );
    expect(team.members.find((m) => m.registrationId === reg.priced)?.pricePaise).toBe(70_000);
    expect(team.spentPaise).toBe(70_000);
  });

  it("is fixed once the season has an auction", async () => {
    expect(await auctionSourceLocked(db, comp.id)).toBe(true);
    expect(await details("app")).toEqual({ ok: false, reason: "source_locked" });
  });
});
