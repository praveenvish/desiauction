// THE POOL SETTLES WHEN THE AUCTION OPENS, against real Postgres.
//
// Lots are drawn when the auction is created; the marks that decide the pool
// stay editable until it opens. A captain picked after creation must not go
// under the hammer, and must keep their team. Someone unmarked or approved
// since then must get a lot. The event log must still replay to the rows.
import { DEFAULT_AUCTION_CONFIG, registrationNumber, replayAuction } from "@desiauction/core";
import {
  auctionEvents as auctionEventsTable,
  auctions as auctionsTable,
  auditLog,
  bids as bidsTable,
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
import {
  auctionOf,
  createAuction,
  issuePaddle,
  loadEvents,
  placeBid,
  queueAllLots,
  recoverAuction,
  transitionAuction,
  transitionLot,
  type AuctionRecord,
} from "@desiauction/auction";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import {
  advanceCompetition,
  createCompetition,
  createTeam,
  resolveCompetition,
  type CompetitionSummary,
} from "../competition/competitions";
import { createOrg } from "../orgs/orgs";
import { auctionReady } from "./auction-ready";
import { resolvedLots } from "./live-summary";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);

let owner = "";
let orgId = "";
let comp: CompetitionSummary = null as unknown as CompetitionSummary;
let auction: AuctionRecord = null as unknown as AuctionRecord;
const teamIds: string[] = [];
const personIds: string[] = [];
const reg: Record<string, string> = {};

async function seed(name: string, suffix: string, marks: { isIcon?: boolean } = {}) {
  const personId = newId();
  await db.insert(people).values({ id: personId, phone: `+9193${RUN}${suffix}`, name });
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
    ...(marks.isIcon === true ? { isIcon: true, teamId: teamIds[0] } : {}),
  });
  reg[name] = id;
}

async function lotOf(name: string) {
  const rows = await db
    .select()
    .from(lotsTable)
    .where(and(eq(lotsTable.auctionId, auction.id), eq(lotsTable.registrationId, reg[name] ?? "")));
  return rows;
}

async function fresh(): Promise<AuctionRecord> {
  const record = await auctionOf(db, comp.id);
  if (record === null) throw new Error("no auction");
  return record;
}

beforeAll(async () => {
  owner = newId();
  await db.insert(people).values({ id: owner, phone: `+9193${RUN}00`, name: "Organizer" });
  orgId = (await createOrg(db, owner, `Settle Club ${RUN}`)).id;
  comp = await createCompetition(db, orgId, owner, {
    sport: "cricket",
    name: `Settle Cup ${RUN}`,
    location: "Pune",
    startsOn: "2026-10-01",
    endsOn: "2026-10-30",
  });
  for (const name of ["Settle Kings", "Settle Tigers"]) {
    const team = await createTeam(db, orgId, comp.id, owner, name);
    if (!team.ok) throw new Error("team setup failed");
    teamIds.push(team.team.id);
  }
  for (const stage of ["setup", "registration_open"] as const) {
    const current = await resolveCompetition(db, owner, comp.slug);
    if (current === null) throw new Error("competition missing");
    expect((await advanceCompetition(db, current, owner, stage)).ok).toBe(true);
  }
  await seed("Plain Player", "01");
  await seed("Later Captain", "02");
  await seed("Former Icon", "03", { isIcon: true });
  await seed("Walked Away", "04");
  const current = await resolveCompetition(db, owner, comp.slug);
  if (current === null) throw new Error("competition missing");
  expect((await advanceCompetition(db, current, owner, "registration_closed")).ok).toBe(true);
  comp = (await resolveCompetition(db, owner, comp.slug)) ?? comp;
});

afterAll(async () => {
  if (orgId !== "") {
    await db.delete(auctionEventsTable).where(eq(auctionEventsTable.orgId, orgId));
    await db.delete(bidsTable).where(eq(bidsTable.orgId, orgId));
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

describe("THE POOL SETTLES WHEN THE AUCTION OPENS", () => {
  it("draws lots from the pool as it stood at creation — the icon has none", async () => {
    const ready = await auctionReady(db, comp);
    expect((await createAuction(db, comp, ready, owner, DEFAULT_AUCTION_CONFIG)).ok).toBe(true);
    auction = await fresh();
    for (const teamId of teamIds) {
      expect((await issuePaddle(db, auction, owner, teamId, owner)).ok).toBe(true);
    }
    expect(await queueAllLots(db, auction, owner)).toEqual({ applied: 3, skipped: 0 });
    expect(await lotOf("Former Icon")).toHaveLength(0);
  });

  it("then the pool drifts while the auction is scheduled", async () => {
    // A captain picked at the owners' meeting, after the auction was set up.
    await db
      .update(registrationsTable)
      .set({ isCaptain: true, teamId: teamIds[1] })
      .where(eq(registrationsTable.id, reg["Later Captain"] ?? ""));
    // The icon mark taken back: they belong in the auction now.
    await db
      .update(registrationsTable)
      .set({ isIcon: false, teamId: null })
      .where(eq(registrationsTable.id, reg["Former Icon"] ?? ""));
    // A player who pulled out.
    await db
      .update(registrationsTable)
      .set({ status: "withdrawn" })
      .where(eq(registrationsTable.id, reg["Walked Away"] ?? ""));
    // A player approved late.
    await seed("Late Approval", "05");
  });

  it("opening withdraws the captain's lot and keeps them on their team", async () => {
    expect((await transitionAuction(db, auction, owner, "open")).ok).toBe(true);
    auction = await fresh();
    const [captainLot] = await lotOf("Later Captain");
    expect(captainLot?.status).toBe("withdrawn");
    const [captain] = await db
      .select({ teamId: registrationsTable.teamId })
      .from(registrationsTable)
      .where(eq(registrationsTable.id, reg["Later Captain"] ?? ""));
    expect(captain?.teamId).toBe(teamIds[1]);
    // …so the conductor cannot put them on the block.
    expect((await transitionLot(db, auction, captainLot?.id ?? "", owner, "open")).ok).toBe(false);
  });

  it("the night's history does not list the captain as a withdrawn lot", async () => {
    const history = await resolvedLots(db, auction.id);
    expect(history.map((lot) => lot.registrationId)).not.toContain(reg["Later Captain"]);
    // A player who pulled out is still a withdrawal the room should see.
    expect(history.map((lot) => lot.registrationId)).toContain(reg["Walked Away"]);
  });

  it("withdraws a player who is no longer approved, and leaves an untouched lot alone", async () => {
    expect((await lotOf("Walked Away"))[0]?.status).toBe("withdrawn");
    expect((await lotOf("Plain Player"))[0]?.status).toBe("queued");
  });

  it("gives the unmarked icon and the late approval a queued lot at the end", async () => {
    const [formerIcon] = await lotOf("Former Icon");
    const [late] = await lotOf("Late Approval");
    expect(formerIcon?.status).toBe("queued");
    expect(late?.status).toBe("queued");
    expect([formerIcon?.seq, late?.seq].sort()).toEqual([4, 5]);
    expect([formerIcon?.lotNumber, late?.lotNumber].sort()).toEqual(["L004", "L005"]);
  });

  it("the event log still replays to exactly these rows", async () => {
    const replay = replayAuction(await loadEvents(db, auction.id));
    expect(replay.ok).toBe(true);
    // The room goes live with nothing called — not "Later Captain — withdrawn".
    expect(replay.ok && replay.projection.lastOutcome).toBeNull();
    const report = await recoverAuction(db, auction, owner);
    expect(report.ok).toBe(true);
    expect(report.divergences).toEqual([]);
    expect(report.healed).toBe(false);
  });

  it("the withdrawn captain still counts against their team's squad cap", async () => {
    // squadMax 2: the captain already fills one place on Tigers, so Tigers may
    // buy one more player and no second.
    await db
      .update(auctionsTable)
      .set({ config: { ...auction.config, squadMax: 2 } })
      .where(eq(auctionsTable.id, auction.id));
    auction = await fresh();
    const [tigers] = await db
      .select({ id: paddlesTable.id })
      .from(paddlesTable)
      .where(
        and(eq(paddlesTable.auctionId, auction.id), eq(paddlesTable.teamId, teamIds[1] ?? "")),
      );
    const first = (await lotOf("Plain Player"))[0];
    expect((await transitionLot(db, auction, first?.id ?? "", owner, "open")).ok).toBe(true);
    const base = first?.basePrice ?? 0;
    expect(
      (
        await placeBid(db, auction, owner, {
          lotId: first?.id ?? "",
          paddleId: tigers?.id ?? "",
          amountRaw: base,
          bidderAuthorized: true,
        })
      ).ok,
    ).toBe(true);
    expect((await transitionLot(db, auction, first?.id ?? "", owner, "sell")).ok).toBe(true);

    const second = (await lotOf("Late Approval"))[0];
    expect((await transitionLot(db, auction, second?.id ?? "", owner, "open")).ok).toBe(true);
    const refused = await placeBid(db, auction, owner, {
      lotId: second?.id ?? "",
      paddleId: tigers?.id ?? "",
      amountRaw: second?.basePrice ?? 0,
      bidderAuthorized: true,
    });
    expect(refused).toEqual({ ok: false, code: "SQUAD_FULL" });
  });
});
