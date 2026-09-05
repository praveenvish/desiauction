import {
  DEFAULT_AUCTION_CONFIG,
  isMinor,
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
  /** Null in a sport whose pack declares no playing roles (Phase 2). */
  role: string | null;
  status: "sold" | "unsold" | "withdrawn";
  soldPrice: number | null;
  teamId: string | null;
  teamName: string | null;
  /**
   * Squad marks that survive the hammer.
   *
   * A captain bought in the room wore no badge anywhere: `isCaptain` reached
   * the live views through `preSignedPlayers` alone, which filters
   * `WHERE isIcon OR isRetained` — so a captain who is neither was in no
   * payload the client held. These come off the `registrations` join this read
   * ALREADY performs, so it is two columns on an existing select rather than a
   * new query. Spectator-safe by the same argument as `role`: who leads a side
   * is announced in the hall before the first lot opens.
   */
  isCaptain: boolean;
  isViceCaptain: boolean;
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
      isCaptain: registrations.isCaptain,
      isViceCaptain: registrations.isViceCaptain,
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

export interface LotMedia {
  /** Consent-gated (DPDP §5): null unless the player set `photo_consent_at`. */
  photoUrl: string | null;
  /** The REGISTRATION number — the identity the player already sees on their
   *  own public page — not the queue position the snapshot calls `lotNumber`.
   *  Text, not an integer: the column is `text` and carries formatting. */
  number: string | null;
}

/**
 * The face and the number for every lot in an auction, keyed by lot id.
 *
 * WHY THIS IS NOT ON THE SNAPSHOT. The engine hashes its snapshot and compares
 * the bytes across instances to prove the fold is deterministic. A media URL is
 * SIGNED AT READ and carries an expiry, so two honest engines folding the same
 * log would produce different bytes and halt the auction. The room still needs
 * a face on the block, so the media rides BESIDE the snapshot on the
 * server-rendered view and the client joins it on `lotId`.
 *
 * Spectator-safe by the same rule as `resolvedLots`: a photo the player agreed
 * to publish and the number already printed on their public page. Never a
 * phone, never a person id.
 *
 * The signer is injected rather than imported so this module stays free of the
 * storage adapter — the same reason `resolvedLots` takes a `Db`.
 */
export async function lotMediaOf(
  db: Db,
  auctionId: string,
  readUrl: (key: string) => string,
): Promise<Record<string, LotMedia>> {
  const rows = await db
    .select({
      lotId: lots.id,
      number: registrations.registrationNumber,
      photoKey: people.photoUrl,
      photoConsentAt: people.photoConsentAt,
      dateOfBirth: registrations.dateOfBirth,
    })
    .from(lots)
    .innerJoin(registrations, eq(registrations.id, lots.registrationId))
    .innerJoin(people, eq(people.id, registrations.personId))
    .where(eq(lots.auctionId, auctionId));
  const now = new Date();
  const media: Record<string, LotMedia> = {};
  for (const row of rows) {
    // PRR P0-2 (DPDP §9): a minor's face never rides the live surfaces. This
    // media powers the public, unauthenticated broadcast pages (/board,
    // /overlay, /spectate) exactly as `toShowcasePlayer` powers /c — so the same
    // age suppression applies here, or the child scrubbed from /c would still
    // appear on the auction block. The number and name still show.
    // Consent first, then signing: an unconsented photo is never signed, so a
    // URL for it cannot exist to leak.
    const consented = row.photoConsentAt !== null && row.photoKey !== null;
    const showPhoto = consented && row.photoKey !== null && !isMinor(row.dateOfBirth, now);
    media[row.lotId] = {
      photoUrl: showPhoto ? readUrl(row.photoKey as string) : null,
      number: row.number,
    };
  }
  return media;
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
  /** Null in a sport whose pack declares no playing roles (Phase 2). */
  role: string | null;
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
