import { DEFAULT_AUCTION_CONFIG, type AuctionConfig, type IncrementSlab } from "@desiauction/core";
import { lots, paddles, people, registrations, teams, type Db } from "@desiauction/db";
import { and, asc, eq, inArray } from "drizzle-orm";

// PX-6 live-experience reads (thin, additive, spectator-safe). The snapshot
// stream carries live state but only the LAST lot outcome — late joiners need
// the resolved history. It lives in the EXISTING lots table (soldToPaddleId,
// soldPrice); this read exposes exactly what the snapshot's lastOutcome
// already exposes per lot: lot number, the auctioned player's name and role,
// price, team. Never a bidder identity, never a phone.

export interface ResolvedLot {
  lotId: string;
  lotNumber: string;
  seq: number;
  playerName: string | null;
  role: string;
  status: "sold" | "unsold" | "withdrawn";
  soldPrice: number | null;
  teamId: string | null;
  teamName: string | null;
}

export async function resolvedLots(db: Db, auctionId: string): Promise<ResolvedLot[]> {
  const rows = await db
    .select({
      lotId: lots.id,
      lotNumber: lots.lotNumber,
      seq: lots.seq,
      playerName: people.name,
      role: registrations.role,
      status: lots.status,
      soldPrice: lots.soldPrice,
      teamId: paddles.teamId,
      teamName: teams.name,
    })
    .from(lots)
    .innerJoin(registrations, eq(registrations.id, lots.registrationId))
    .innerJoin(people, eq(people.id, registrations.personId))
    .leftJoin(paddles, eq(paddles.id, lots.soldToPaddleId))
    .leftJoin(teams, eq(teams.id, paddles.teamId))
    .where(
      and(eq(lots.auctionId, auctionId), inArray(lots.status, ["sold", "unsold", "withdrawn"])),
    )
    .orderBy(asc(lots.seq));
  return rows.map((row) => ({
    ...row,
    status: row.status as ResolvedLot["status"],
  }));
}

/** The display slice of the locked AuctionConfig (doc 41) — rules, verbatim. */
export interface AuctionRules {
  pursePerTeam: number;
  squadMin: number;
  squadMax: number;
  initialSeconds: number;
  extensionSeconds: number;
  slabs: readonly { upTo: number | null; step: number }[];
}

/** Parse the platform-written config jsonb; defaults guard partial rows. */
export function rulesOf(config: unknown): AuctionRules {
  const parsed = (config ?? {}) as Partial<AuctionConfig>;
  const slabs: readonly IncrementSlab[] = parsed.slabs ?? DEFAULT_AUCTION_CONFIG.slabs;
  const timer = parsed.timer ?? DEFAULT_AUCTION_CONFIG.timer;
  return {
    pursePerTeam: Number(parsed.pursePerTeam ?? DEFAULT_AUCTION_CONFIG.pursePerTeam),
    squadMin: parsed.squadMin ?? DEFAULT_AUCTION_CONFIG.squadMin,
    squadMax: parsed.squadMax ?? DEFAULT_AUCTION_CONFIG.squadMax,
    initialSeconds: timer.initialSeconds,
    extensionSeconds: timer.extensionSeconds,
    slabs: slabs.map((slab) => ({
      upTo: slab.upTo === null ? null : Number(slab.upTo),
      step: Number(slab.step),
    })),
  };
}
