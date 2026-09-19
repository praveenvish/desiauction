// THE CROSS-SEASON INDEXES against real Postgres: /players counts and filters
// what the desk would, /auctions folds progress and gates money moved, and
// /reports carries no rupee — not a zero, no KEY — without money sight.
import { DEFAULT_AUCTION_CONFIG, registrationNumber } from "@desiauction/core";
import {
  auctions,
  createDb,
  lots,
  newId,
  paddles,
  people,
  registrations,
  type DbHandle,
} from "@desiauction/db";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../env";
import { createOrg } from "../orgs/orgs";
import { purgeOrg } from "../test-support/purge-org";
import {
  createCompetition,
  createTeam,
  type CompetitionSummary,
} from "../competition/competitions";
import { auctionFactsIn } from "./auctions-index";
import { playersIn, type PlayerSeasonRef } from "./players-index";
import { seasonReportIn } from "./reports";

const handle: DbHandle = createDb(env.DATABASE_URL);
const db = handle.db;
const RUN = String(Date.now()).slice(-7);
const readUrl = (key: string) => `https://media.test/${key}`;

let organizer = "";
let orgId = "";
let season: CompetitionSummary;
let ref: PlayerSeasonRef;
let kings = "";
let tigers = "";
const people_: string[] = [];
const reg: Record<string, string> = {};

async function player(
  name: string,
  suffix: string,
  values: Partial<typeof registrations.$inferInsert> = {},
): Promise<string> {
  const personId = newId();
  await db.insert(people).values({ id: personId, phone: `+9196${RUN}${suffix}`, name });
  people_.push(personId);
  const id = newId();
  await db.insert(registrations).values({
    id,
    orgId,
    competitionId: season.id,
    personId,
    role: "batter",
    status: "approved",
    registrationNumber: registrationNumber(id),
    feeAmountPaise: 50_000,
    ...values,
  });
  reg[name] = id;
  return id;
}

beforeAll(async () => {
  organizer = newId();
  await db.insert(people).values({ id: organizer, phone: `+9196${RUN}00`, name: "Organizer" });
  orgId = (await createOrg(db, organizer, `Index Club ${RUN}`)).id;
  season = await createCompetition(db, orgId, organizer, {
    name: `Index Cup ${RUN}`,
    sport: "cricket",
    startsOn: "2099-10-01",
    endsOn: "2099-10-30",
  });
  ref = { id: season.id, slug: season.slug, name: season.name, sport: season.sport };
  const k = await createTeam(db, orgId, season.id, organizer, "Index Kings");
  const t = await createTeam(db, orgId, season.id, organizer, "Index Tigers");
  if (!k.ok || !t.ok) throw new Error("teams not created");
  kings = k.team.id;
  tigers = t.team.id;

  await player("Icon Ivan", "01", { isIcon: true, teamId: kings, feeStatus: "paid" });
  await player("Sold Sunil", "02", { teamId: tigers, feeStatus: "paid" });
  await player("Unsold Umar", "03");
  await player("New Nikhil", "04", { status: "submitted" });
  await player("Gone Gopal", "05", { status: "withdrawn" });

  const auctionId = newId();
  await db.insert(auctions).values({
    id: auctionId,
    orgId,
    competitionId: season.id,
    name: "Index Auction",
    status: "completed",
    config: DEFAULT_AUCTION_CONFIG,
    createdBy: organizer,
  });
  const paddleId = newId();
  await db.insert(paddles).values({
    id: paddleId,
    orgId,
    auctionId,
    teamId: tigers,
    personId: organizer,
    paddleNumber: "P01",
  });
  await db.insert(lots).values([
    {
      id: newId(),
      orgId,
      auctionId,
      registrationId: reg["Sold Sunil"] as string,
      lotNumber: "L001",
      seq: 1,
      basePrice: 1_000_000,
      status: "sold",
      soldToPaddleId: paddleId,
      soldPrice: 2_500_000,
    },
    {
      id: newId(),
      orgId,
      auctionId,
      registrationId: reg["Unsold Umar"] as string,
      lotNumber: "L002",
      seq: 2,
      basePrice: 1_000_000,
      status: "unsold",
    },
    // The icon's waiting lot, withdrawn when the pool settled: never a pool lot.
    {
      id: newId(),
      orgId,
      auctionId,
      registrationId: reg["Icon Ivan"] as string,
      lotNumber: "L003",
      seq: 3,
      basePrice: 1_000_000,
      status: "withdrawn",
    },
  ]);
});

afterAll(async () => {
  if (orgId !== "") await purgeOrg(db, orgId);
  await db.delete(people).where(inArray(people.id, [organizer, ...people_]));
  await handle.sql.end();
});

describe("/players — the cross-season player index", () => {
  it("counts the scope the way the desk does, ignoring the filters", async () => {
    const slice = await playersIn(db, [ref], { page: 1, limit: 25, status: "submitted" }, readUrl);
    expect(slice.stats).toEqual({ total: 5, approved: 3, sold: 1, preSigned: 1 });
    expect(slice.total).toBe(1);
    expect(slice.rows.map((row) => row.name)).toEqual(["New Nikhil"]);
  });

  it("says how each signed player reached their team", async () => {
    const slice = await playersIn(db, [ref], { page: 1, limit: 25 }, readUrl);
    const route = new Map(slice.rows.map((row) => [row.name, row.squadRoute]));
    expect(route.get("Sold Sunil")).toBe("auction");
    expect(route.get("Icon Ivan")).toBe("icon");
    expect(route.get("Unsold Umar")).toBeNull();
    expect(slice.rows.find((row) => row.name === "Sold Sunil")?.teamName).toBe("Index Tigers");
    expect(slice.rows[0]?.role).toBe("Batter");
  });

  it("filters by the two squad routes and by a literal search term", async () => {
    const sold = await playersIn(db, [ref], { page: 1, limit: 25, mark: "sold" }, readUrl);
    expect(sold.rows.map((row) => row.name)).toEqual(["Sold Sunil"]);
    const signed = await playersIn(db, [ref], { page: 1, limit: 25, mark: "presigned" }, readUrl);
    expect(signed.rows.map((row) => row.name)).toEqual(["Icon Ivan"]);
    const search = await playersIn(db, [ref], { page: 1, limit: 25, search: "umar" }, readUrl);
    expect(search.rows.map((row) => row.name)).toEqual(["Unsold Umar"]);
    // `%` is a letter here, not "match everything".
    const literal = await playersIn(db, [ref], { page: 1, limit: 25, search: "%" }, readUrl);
    expect(literal.total).toBe(0);
  });

  it("an empty scope reads nothing", async () => {
    expect((await playersIn(db, [], { page: 1, limit: 25 }, readUrl)).total).toBe(0);
  });
});

describe("/auctions — progress, and money moved only with sight", () => {
  it("folds the night: one sold, one unsold, the icon's withdrawn lot not in the pool", async () => {
    const facts = (await auctionFactsIn(db, [season.id], new Set([season.id]))).get(season.id);
    expect(facts).toMatchObject({
      status: "completed",
      lotsSold: 1,
      lotsUnsold: 1,
      lotsTotal: 2,
      teams: 2,
      moneyMoved: 2_500_000,
    });
  });

  it("without sight the key is ABSENT, not zero", async () => {
    const facts = (await auctionFactsIn(db, [season.id], new Set())).get(season.id);
    expect(facts).toBeDefined();
    expect(Object.keys(facts ?? {})).not.toContain("moneyMoved");
  });
});

describe("/reports — one season, gated before the read", () => {
  it("with money sight: fees, spend, purse and the dearest buy", async () => {
    const report = await seasonReportIn(db, season, { money: true, readUrl });
    expect(report.registrations).toMatchObject({ total: 5, approved: 3, submitted: 1 });
    expect(report.fees).toMatchObject({ paid: 2, collectedPaise: 100_000, duePaise: 100_000 });
    expect(report.auction).toMatchObject({ sold: 1, unsold: 1, moneyMoved: 2_500_000 });
    const tigersRow = report.teams.find((team) => team.name === "Index Tigers");
    expect(tigersRow).toMatchObject({
      spend: 2_500_000,
      purse: DEFAULT_AUCTION_CONFIG.pursePerTeam,
    });
    expect(report.topBuys?.map((buy) => [buy.playerName, buy.price, buy.role])).toEqual([
      ["Sold Sunil", 2_500_000, "Batter"],
    ]);
  });

  it("without money sight: head counts only — no rupee key anywhere in the payload", async () => {
    const report = await seasonReportIn(db, season, { money: false, readUrl });
    expect(report.registrations.total).toBe(5);
    expect(report.fees.paid).toBe(2);
    const wire = JSON.stringify(report);
    for (const key of [
      "collectedPaise",
      "duePaise",
      "moneyMoved",
      "pursePct",
      "spend",
      "purse",
      "squadMax",
      "topBuys",
      "price",
    ]) {
      expect(wire, `money key "${key}" reached a reader without sight`).not.toContain(`"${key}"`);
    }
  });
});
