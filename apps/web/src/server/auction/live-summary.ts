import {
  DEFAULT_AUCTION_CONFIG,
  minPossiblePrice,
  type AuctionConfig,
  type IncrementSlab,
} from "@desiauction/core";
import { lots, paddles, people, registrations, teams, type Db } from "@desiauction/db";
import { and, asc, eq, inArray, or } from "drizzle-orm";

// PX-6 live-experience reads (thin, additive, spectator-safe). The snapshot
// stream carries live state but only the LAST lot outcome — late joiners need
// the resolved history. It lives in the EXISTING lots table (soldToPaddleId,
// soldPrice); this read exposes exactly what the snapshot's lastOutcome
// already exposes per lot: lot number, the auctioned player's name and role,
// price, team. Never a bidder identity, never a phone.

export interface ResolvedLot {
  lotId: string;
  /**
   * The registration behind the lot — the exact key for de-duping a squad.
   * Null on rows the client synthesises from the snapshot's `lastOutcome`
   * mid-auction: that payload is spectator-safe and carries no registration.
   * Those rows reconcile to the server's on the next read.
   */
  registrationId: string | null;
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
      registrationId: lots.registrationId,
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

/**
 * Players who are on a squad WITHOUT ever going under the hammer: icons
 * (marquee, pre-signed) and retained players (kept from a prior season). The
 * auction pool projection filters both out (auction-ready.ts), so they appear
 * in no lot, no bid and no resolved-lot row — which meant every live surface
 * showed a franchise's squad as smaller than it actually is.
 *
 * Spectator-safe by the same rule as ResolvedLot: the player's name, role and
 * squad markers. Never a phone, never a person id.
 */
export interface PreSignedPlayer {
  registrationId: string;
  playerName: string | null;
  role: string;
  teamId: string;
  isIcon: boolean;
  isRetained: boolean;
  isCaptain: boolean;
  isViceCaptain: boolean;
}

export async function preSignedPlayers(db: Db, competitionId: string): Promise<PreSignedPlayer[]> {
  const rows = await db
    .select({
      registrationId: registrations.id,
      playerName: people.name,
      role: registrations.role,
      teamId: registrations.teamId,
      isIcon: registrations.isIcon,
      isRetained: registrations.isRetained,
      isCaptain: registrations.isCaptain,
      isViceCaptain: registrations.isViceCaptain,
    })
    .from(registrations)
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(
      and(
        eq(registrations.competitionId, competitionId),
        eq(registrations.status, "approved"),
        // teamId is the pre-signed assignment for these two, per the schema note.
        or(eq(registrations.isIcon, true), eq(registrations.isRetained, true)),
      ),
    )
    .orderBy(asc(people.name));
  return rows.flatMap((row) =>
    // A pre-signed marker without a team is an organizer mid-edit, not a squad
    // member: drop it rather than invent a franchise for them.
    row.teamId === null ? [] : [{ ...row, teamId: row.teamId }],
  );
}

/** The display slice of the locked AuctionConfig (doc 41) — rules, verbatim. */
export interface AuctionRules {
  pursePerTeam: number;
  squadMin: number;
  squadMax: number;
  /**
   * The reserve-rule floor — the cheapest any remaining lot can open at.
   * Carried to the client so the bidder's own control can work out the ceiling
   * the engine will enforce, instead of offering rungs above it.
   */
  minPossiblePrice: number;
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
    minPossiblePrice: Number(
      minPossiblePrice({
        ...DEFAULT_AUCTION_CONFIG,
        ...parsed,
        slabs,
        timer,
      }),
    ),
    initialSeconds: timer.initialSeconds,
    extensionSeconds: timer.extensionSeconds,
    slabs: slabs.map((slab) => ({
      upTo: slab.upTo === null ? null : Number(slab.upTo),
      step: Number(slab.step),
    })),
  };
}
