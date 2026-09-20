import { auctions, lots, registrations, settlementCases, teams, type Db } from "@desiauction/db";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { preSignedSql } from "../competition/pre-signed";

/**
 * /auctions — ONE CARD PER AUCTION NIGHT, across a person's clubs.
 *
 * Status, progress and (for money sight only) money moved, read inside ONE
 * org's boundary. Money is decided BEFORE it is copied: a season outside
 * `money` never carries the key, so a rival owner — a viewer-level member of
 * the very same club — cannot read the night's spend from the payload
 * (gate-the-data, DA-30).
 */

export type AuctionNightStatus = "none" | "scheduled" | "live" | "paused" | "completed" | "settled";

export interface AuctionFacts {
  auctionId: string | null;
  status: AuctionNightStatus;
  /** Lots the room has hammered as sold. */
  lotsSold: number;
  /** Lots that go (or went) to the block — pre-signed players never do. */
  lotsTotal: number;
  lotsUnsold: number;
  teams: number;
  /** Paise across every sold lot. ABSENT without money sight. */
  moneyMoved?: number;
}

const EMPTY: Omit<AuctionFacts, "teams"> = {
  auctionId: null,
  status: "none",
  lotsSold: 0,
  lotsTotal: 0,
  lotsUnsold: 0,
};

/** The auction's own word, folded with the books: a settled case reads "settled". */
export function nightStatus(
  auctionStatus: string | null,
  settlement: string | null,
): AuctionNightStatus {
  if (auctionStatus === null) return "none";
  if (auctionStatus === "reconciled") return "settled";
  if (auctionStatus === "completed") {
    return settlement === "settled" || settlement === "closed" ? "settled" : "completed";
  }
  if (auctionStatus === "live" || auctionStatus === "paused" || auctionStatus === "scheduled") {
    return auctionStatus;
  }
  return "none";
}

export async function auctionFactsIn(
  db: Db,
  seasonIds: readonly string[],
  money: ReadonlySet<string>,
): Promise<Map<string, AuctionFacts>> {
  const out = new Map<string, AuctionFacts>();
  if (seasonIds.length === 0) return out;
  const ids = [...seasonIds];
  const [auctionRows, teamRows, caseRows] = await Promise.all([
    db
      .select({
        id: auctions.id,
        competitionId: auctions.competitionId,
        status: auctions.status,
      })
      .from(auctions)
      .where(and(inArray(auctions.competitionId, ids), ne(auctions.status, "abandoned"))),
    db
      .select({ competitionId: teams.competitionId, count: sql<number>`count(*)::int` })
      .from(teams)
      .where(inArray(teams.competitionId, ids))
      .groupBy(teams.competitionId),
    // Status metadata only — no amounts ride this read.
    db
      .select({ competitionId: settlementCases.competitionId, status: settlementCases.status })
      .from(settlementCases)
      .where(
        and(inArray(settlementCases.competitionId, ids), ne(settlementCases.status, "voided")),
      ),
  ]);
  const auctionIds = auctionRows.map((row) => row.id);
  // Joined (lots ⋈ registrations), so drizzle qualifies every column below.
  const lotRows =
    auctionIds.length === 0
      ? []
      : await db
          .select({
            auctionId: lots.auctionId,
            sold: sql<number>`count(*) filter (where ${lots.status} = 'sold')::int`,
            unsold: sql<number>`count(*) filter (where ${lots.status} = 'unsold')::int`,
            total: sql<number>`count(*) filter (where not (${lots.status} = 'withdrawn' and ${preSignedSql}))::int`,
            spend: sql<number>`coalesce(sum(${lots.soldPrice}) filter (where ${lots.status} = 'sold'), 0)::double precision`,
          })
          .from(lots)
          .innerJoin(registrations, eq(registrations.id, lots.registrationId))
          .where(inArray(lots.auctionId, auctionIds))
          .groupBy(lots.auctionId);
  const lotsBy = new Map(lotRows.map((row) => [row.auctionId, row]));
  const teamsBy = new Map(teamRows.map((row) => [row.competitionId, row.count]));
  const caseBy = new Map<string, string>();
  for (const row of caseRows) {
    const held = caseBy.get(row.competitionId);
    // A terminal case wins over an open one for the same season.
    if (held === undefined || row.status === "settled" || row.status === "closed") {
      caseBy.set(row.competitionId, row.status);
    }
  }
  for (const id of ids) {
    const auction = auctionRows.find((row) => row.competitionId === id);
    const lotFacts = auction === undefined ? undefined : lotsBy.get(auction.id);
    const facts: AuctionFacts = {
      ...EMPTY,
      teams: teamsBy.get(id) ?? 0,
      ...(auction === undefined
        ? {}
        : {
            auctionId: auction.id,
            status: nightStatus(auction.status, caseBy.get(id) ?? null),
            lotsSold: lotFacts?.sold ?? 0,
            lotsTotal: lotFacts?.total ?? 0,
            lotsUnsold: lotFacts?.unsold ?? 0,
          }),
      ...(money.has(id) ? { moneyMoved: auction === undefined ? 0 : (lotFacts?.spend ?? 0) } : {}),
    };
    out.set(id, facts);
  }
  return out;
}

export interface AuctionLink {
  label: string;
  href: string;
  /** The one door this person most likely came for. */
  primary?: boolean;
}

export interface AuctionRole {
  manage: boolean;
  conduct: boolean;
  /** The team this person owns in the season, if any. */
  ownsTeam: string | null;
}

/**
 * The doors on a card, by role and by where the night is — offering only
 * places that will open for this person (cockpit, ledger and replay are
 * `auction.conduct`; setup is the organizer's hub). Pure, so it is tested
 * without a page.
 */
export function auctionLinks(
  slug: string,
  status: AuctionNightStatus,
  role: AuctionRole,
): AuctionLink[] {
  const base = `/seasons/${slug}/auction`;
  const running = status === "live" || status === "paused";
  const before = status === "none" || status === "scheduled";
  const done = status === "completed" || status === "settled";
  const links: AuctionLink[] = [];
  if (role.conduct && (running || status === "scheduled")) {
    links.push({ label: "Cockpit", href: `${base}/cockpit` });
  }
  if (role.manage && before) {
    links.push({ label: "Setup", href: base });
  }
  if (role.ownsTeam !== null && (running || status === "scheduled")) {
    links.push({ label: "Live room", href: `${base}/live` });
    links.push({ label: "My plan", href: `${base}/plan` });
  }
  if (!role.conduct && role.ownsTeam === null && running) {
    links.push({ label: "Watch live", href: `${base}/live` });
  }
  if (done) {
    links.push({ label: "Results", href: base });
    if (role.ownsTeam !== null) {
      links.push({ label: "My squad", href: `/seasons/${slug}/teams` });
    }
    if (role.conduct) {
      links.push({ label: "Replay", href: `${base}/replay` });
      links.push({ label: "Ledger", href: `${base}/ledger` });
    }
  }
  if (links.length === 0 && status !== "none") {
    links.push({ label: "Open", href: base });
  }
  return links.map((link, index) => (index === 0 ? { ...link, primary: true } : link));
}
