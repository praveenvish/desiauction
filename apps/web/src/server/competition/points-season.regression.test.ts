// POINTS SEASONS (0091) — a season's auction counts in rupees or points. The
// unit rides on the season, lands in the auction's config at the right scale,
// and is FIXED once an auction exists: its purse was typed in it.
// Real Postgres; unique phones/orgs per run.
import { registrationNumber } from "@desiauction/core";
import {
  auctions as auctionsTable,
  auditLog,
  competitions as competitionsTable,
  createDb,
  grants as grantsTable,
  lots as lotsTable,
  newId,
  organizations,
  orgMembers,
  otpCodes,
  otpInbox,
  paddles as paddlesTable,
  people,
  registrations as registrationsTable,
  sessions,
  teams as teamsTable,
  auctionEvents as auctionEventsTable,
  type DbHandle,
} from "@desiauction/db";
import { createAuction } from "@desiauction/auction";
import { desc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { auctionReady } from "../auction/auction-ready";
import { parseAuctionSetup } from "../auction/auction-setup";
import { requestOtp, verifyOtp } from "../auth/otp";
import { DevInboxSender } from "../auth/otp-sender";
import { createOrg } from "../orgs/orgs";
import {
  advanceCompetition,
  auctionUnitLocked,
  createCompetition,
  createTeam,
  resolveCompetition,
  updateCompetitionDetails,
  type CompetitionSummary,
} from "./competitions";
import { seasonUnit } from "./season-unit";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const sender = new DevInboxSender(db);

const RUN = String(Date.now()).slice(-7);
const PHONE_OWNER = `+9197${RUN}3`;
const SEED_PHONE_PREFIX = `+91933${RUN}`;

let owner = "";
let org = { id: "", name: "", slug: "" };
let comp: CompetitionSummary = null as unknown as CompetitionSummary;
const seededPersonIds: string[] = [];

function must<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`expected ${label}`);
  }
  return value;
}

async function current(): Promise<CompetitionSummary> {
  return must(await resolveCompetition(db, owner, comp.slug), "competition");
}

const details = (unit: "inr" | "points") => ({
  name: comp.name,
  location: comp.location,
  startsOn: comp.startsOn,
  endsOn: comp.endsOn,
  auctionUnit: unit,
});

beforeAll(async () => {
  await requestOtp(db, sender, PHONE_OWNER);
  const [otp] = await db
    .select()
    .from(otpInbox)
    .where(eq(otpInbox.phone, PHONE_OWNER))
    .orderBy(desc(otpInbox.createdAt))
    .limit(1);
  const verified = await verifyOtp(db, PHONE_OWNER, otp?.code ?? "");
  if (!verified.ok) throw new Error("login failed");
  owner = verified.personId;
  org = await createOrg(db, owner, `Points Org ${RUN}`);
  comp = await createCompetition(db, org.id, owner, {
    sport: "cricket",
    name: `Points League ${RUN}`,
    location: "Malad",
    startsOn: "2026-08-01",
    endsOn: "2026-09-15",
    auctionUnit: "points",
  });
  for (const name of ["Andheri Arrows", "Bandra Blasters", "Colaba Kings"]) {
    const team = await createTeam(db, org.id, comp.id, owner, name);
    if (!team.ok) throw new Error("team setup failed");
  }
  for (const [index, name] of ["Asha", "Bilal", "Chetan"].entries()) {
    const personId = newId();
    await db
      .insert(people)
      .values({ id: personId, phone: `${SEED_PHONE_PREFIX}${String(index)}`, name });
    seededPersonIds.push(personId);
    const id = newId();
    await db.insert(registrationsTable).values({
      id,
      orgId: org.id,
      competitionId: comp.id,
      personId,
      role: "batter",
      status: "approved",
      registrationNumber: registrationNumber(id),
    });
  }
});

afterAll(async () => {
  const personIds = [owner, ...seededPersonIds].filter((id) => id !== "");
  if (org.id !== "") {
    const orgIds = [org.id];
    await db.delete(auctionEventsTable).where(inArray(auctionEventsTable.orgId, orgIds));
    await db.delete(lotsTable).where(inArray(lotsTable.orgId, orgIds));
    await db.delete(paddlesTable).where(inArray(paddlesTable.orgId, orgIds));
    await db.delete(auctionsTable).where(inArray(auctionsTable.orgId, orgIds));
    await db.delete(registrationsTable).where(inArray(registrationsTable.orgId, orgIds));
    await db.delete(teamsTable).where(inArray(teamsTable.orgId, orgIds));
    await db.delete(competitionsTable).where(inArray(competitionsTable.orgId, orgIds));
    await db.delete(grantsTable).where(inArray(grantsTable.scopeId, orgIds));
    await db.delete(orgMembers).where(inArray(orgMembers.orgId, orgIds));
    await db.delete(auditLog).where(inArray(auditLog.scopeId, orgIds));
    await db.delete(organizations).where(inArray(organizations.id, orgIds));
  }
  if (personIds.length > 0) {
    await db.delete(sessions).where(inArray(sessions.personId, personIds));
    await db.delete(auditLog).where(inArray(auditLog.actor, personIds));
    await db.delete(people).where(inArray(people.id, personIds));
  }
  await db.delete(otpCodes).where(eq(otpCodes.phone, PHONE_OWNER));
  await db.delete(otpInbox).where(eq(otpInbox.phone, PHONE_OWNER));
  await handle.sql.end();
});

describe("POINTS SEASONS — the unit and its lock", () => {
  it("a season is created in points, and every reader sees it", async () => {
    expect(comp.auctionUnit).toBe("points");
    expect((await current()).auctionUnit).toBe("points");
    expect(await seasonUnit(comp.slug)).toBe("points");
  });

  it("the unit changes freely while there is no auction", async () => {
    expect(await auctionUnitLocked(db, comp.id)).toBe(false);
    const toRupees = await updateCompetitionDetails(db, await current(), owner, details("inr"));
    expect(toRupees.ok).toBe(true);
    expect((await current()).auctionUnit).toBe("inr");
    const back = await updateCompetitionDetails(db, await current(), owner, details("points"));
    expect(back.ok).toBe(true);
    expect((await current()).auctionUnit).toBe("points");
  });

  it("a points auction stores its purse ×100 and ladders from it", async () => {
    let season = await current();
    for (const next of ["setup", "registration_open", "registration_closed"] as const) {
      expect((await advanceCompetition(db, season, owner, next)).ok).toBe(true);
      season = await current();
    }
    const parsed = parseAuctionSetup(
      {
        pursePerTeam: "1000",
        squadMin: "1",
        squadMax: "5",
        timerSeconds: "30",
        extensionSeconds: "15",
        basePriceDefault: "10",
        bands: { A: "50" },
      },
      season.auctionUnit,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const ready = await auctionReady(db, season);
    expect(ready.ok).toBe(true);
    const created = await createAuction(db, season, ready, owner, parsed.config);
    expect(created.ok).toBe(true);
    const [row] = await db
      .select({ config: auctionsTable.config })
      .from(auctionsTable)
      .where(eq(auctionsTable.competitionId, comp.id));
    const config = must(row, "auction").config as { pursePerTeam: number; slabs: unknown[] };
    expect(config.pursePerTeam).toBe(100_000);
    expect(config.slabs[0]).toEqual({ upTo: 20_000, step: 500 });
  });

  it("once the auction exists the unit is fixed — a change is refused, not applied", async () => {
    expect(await auctionUnitLocked(db, comp.id)).toBe(true);
    const refused = await updateCompetitionDetails(db, await current(), owner, details("inr"));
    expect(refused).toEqual({ ok: false, reason: "unit_locked" });
    expect((await current()).auctionUnit).toBe("points");
    // Saving the other details with the SAME unit still works.
    const same = await updateCompetitionDetails(db, await current(), owner, {
      ...details("points"),
      location: "Goregaon",
    });
    expect(same.ok).toBe(true);
  });

  it("the database refuses a unit it does not know", async () => {
    await expect(
      db
        .update(competitionsTable)
        .set({ auctionUnit: "dollars" as "inr" })
        .where(eq(competitionsTable.id, comp.id)),
    ).rejects.toThrow();
  });
});
