"use server";

import { auctionOf, type AuctionRecord } from "@desiauction/auction";
import { isAuctionCommandType, isTransportCommandId, type CommandAck } from "@desiauction/core";
import {
  auctionOwnerInvites,
  paddleGrants,
  paddles,
  teams,
  withTenantDb,
  type Db,
} from "@desiauction/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { canCompetition } from "../competition/authz";
import { resolveCompetition, type CompetitionSummary } from "../competition/competitions";
import { dbHandle, systemDb } from "../db";
import { engineWsUrl, sendEngineCommand } from "./engine-client";
import {
  preSignedPlayers,
  resolvedLots,
  rulesOf,
  type AuctionRules,
  type PreSignedPlayer,
  type ResolvedLot,
} from "./live-summary";

// Live auction actions (M-IP4-2, extended M-IP4-3). The web tier
// authenticates, resolves the tenant and capabilities, then SUBMITS A COMMAND
// — the engine decides. Claims require an explicit paddle grant (the
// production owner model); conduct commands require auction.conduct; the
// compensating undo additionally requires auction.override.

async function requireSession() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login");
  }
  return session;
}

interface LiveGate {
  personId: string;
  competition: CompetitionSummary;
  auction: AuctionRecord;
  canConduct: boolean;
  canOverride: boolean;
  /**
   * The teams this person is actually IN this auction for — an accepted owner
   * invitation, a live paddle grant, or a paddle already in hand. Empty for a
   * plain org member, which is now the difference between being in the room and
   * not being in it.
   */
  myTeamIds: string[];
}

/**
 * Which teams a person is a participant of in THIS auction.
 *
 * Three routes in, all of them explicit acts by an organizer: they accepted an
 * owner invitation for the team, they hold a live paddle grant for it, or they
 * already hold its paddle. Mere org membership is not one of them — which is
 * the whole point of this function existing.
 */
async function participantTeamIds(dbc: Db, auctionId: string, personId: string): Promise<string[]> {
  const [ownedRows, grantRows, paddleRows] = await Promise.all([
    dbc
      .select({ teamId: auctionOwnerInvites.teamId })
      .from(auctionOwnerInvites)
      .where(
        and(
          eq(auctionOwnerInvites.auctionId, auctionId),
          eq(auctionOwnerInvites.acceptedBy, personId),
          isNull(auctionOwnerInvites.revokedAt),
        ),
      ),
    dbc
      .select({ teamId: paddleGrants.teamId })
      .from(paddleGrants)
      .where(
        and(
          eq(paddleGrants.auctionId, auctionId),
          eq(paddleGrants.personId, personId),
          isNull(paddleGrants.revokedAt),
        ),
      ),
    dbc
      .select({ teamId: paddles.teamId })
      .from(paddles)
      .where(
        and(
          eq(paddles.auctionId, auctionId),
          eq(paddles.personId, personId),
          isNull(paddles.releasedAt),
        ),
      ),
  ]);
  return [...new Set([...ownedRows, ...grantRows, ...paddleRows].map((row) => row.teamId))];
}

/**
 * THE LIVE-ROOM GATE.
 *
 * This used to be membership and nothing else: `resolveCompetition` joins
 * `org_members` on the person, and a non-null answer opened the entire room.
 * `acceptOwnerJoin` writes an `org_members` row — correctly commented "grants-
 * not-roles means membership alone confers NO capabilities", which is true
 * about capabilities and was false about DATA. A freshly-accepted owner with
 * zero grants, and equally anyone who had ever accepted any invite link to the
 * club, was served the whole live read model: every rival's paddle numbers,
 * remaining purse, committed spend and squad.
 *
 * The room is now for the people who are IN it: whoever conducts the auction,
 * and whoever an organizer has deliberately put on a team. Everyone else in the
 * club gets `null` — the same 404 `/seasons/…/money` has always correctly
 * given them, and /spectate remains the door for watching.
 */
export async function liveGate(slug: string): Promise<LiveGate | null> {
  const gate = await auctionMemberGate(slug);
  if (gate === null) {
    return null;
  }
  return !gate.canConduct && gate.myTeamIds.length === 0 ? null : gate;
}

/**
 * The MEMBERSHIP gate — resolution only, no participation requirement.
 *
 * This is the old `liveGate` behaviour, kept for exactly one caller:
 * `spectatorView`, the member-only fallback for an UNPUBLISHED auction. A
 * spectator payload is spectator-safe by construction (names and numbers, no
 * owner data, no diagnostics), so membership is the right gate for watching a
 * private season. It is NOT the right gate for the room where money is spent,
 * which is what `liveGate` above now says.
 */
export async function auctionMemberGate(slug: string): Promise<LiveGate | null> {
  const session = await requireSession();
  const competition = await resolveCompetition(systemDb, session.personId, slug);
  if (competition === null) {
    return null;
  }
  return withTenantDb(
    dbHandle,
    { personId: session.personId, orgId: competition.orgId },
    async (db) => {
      const auction = await auctionOf(db, competition.id);
      if (auction === null) {
        return null;
      }
      const scope = { orgId: competition.orgId, competitionId: competition.id };
      const [canConduct, canOverride, myTeamIds] = await Promise.all([
        canCompetition(db, session.personId, scope, "auction.conduct"),
        canCompetition(db, session.personId, scope, "auction.override"),
        participantTeamIds(db, auction.id, session.personId),
      ]);
      return {
        personId: session.personId,
        competition,
        auction,
        canConduct,
        canOverride,
        myTeamIds,
      };
    },
  );
}

export interface LiveAuctionView {
  competition: { name: string; slug: string };
  auctionId: string;
  wsUrl: string;
  teams: { id: string; name: string; shortName: string | null; primaryColor: string | null }[];
  /** The default paddle (first issued); the room may switch within myPaddles. */
  myPaddle: { paddleId: string; paddleNumber: string; teamId: string; teamName: string } | null;
  /** Every paddle this person holds — one per team they were issued for. */
  myPaddles: { paddleId: string; paddleNumber: string; teamId: string; teamName: string }[];
  /** Teams THIS person holds an active paddle grant for (claim eligibility). */
  myGrantTeamIds: string[];
  /** Every team this person is in the room FOR (owner, grant or paddle). */
  myTeamIds: string[];
  viewer: {
    personId: string;
    canConduct: boolean;
    /**
     * May this viewer read every team's remaining purse and committed spend?
     *
     * FALSE by default for a bidder — that is the change. A sealed-purse
     * auction is the ordinary case and rivals' money is exactly what it seals.
     * Conductors keep the whole board: running the night requires it.
     *
     * TODO(founder): some auctions deliberately PROJECT every purse — it is
     * half the theatre, and /spectate already publishes purses for a public
     * competition. If open purses become a per-auction choice, this is the flag
     * that reads it (`auction.config`), not a new gate. Until that decision is
     * made the default is private, because private is the answer that cannot
     * leak. NOT decided here.
     */
    canSeeAllPurses: boolean;
    /** Whether every squad is readable, or only the viewer's own. Same rule. */
    canSeeAllSquads: boolean;
  };
  // PX-6: the locked rules (display) and the resolved history (late joiners).
  rules: AuctionRules;
  resolved: ResolvedLot[];
  /** Icons and retained players: on a squad, never in the pool. */
  preSigned: PreSignedPlayer[];
}

/**
 * EVERY paddle this person holds, in issue order (DA-02).
 *
 * This used to return the first one and stop. A conductor running the night
 * from one laptop — the small-club case, and what our own seed does — holds
 * several, and the live room silently bound them to P01 with no way to switch
 * and no way to hand one back. Three of four teams simply could not bid, and
 * Abort was the only exit. The room now picks from this list.
 */
async function myPaddles(dbc: Db, auctionId: string, personId: string) {
  const rows = await dbc
    .select({
      paddleId: paddles.id,
      paddleNumber: paddles.paddleNumber,
      teamId: paddles.teamId,
      teamName: teams.name,
    })
    .from(paddles)
    .leftJoin(teams, eq(teams.id, paddles.teamId))
    .where(
      and(
        eq(paddles.auctionId, auctionId),
        eq(paddles.personId, personId),
        isNull(paddles.releasedAt),
      ),
    )
    .orderBy(asc(paddles.paddleNumber));
  return rows.map((row) => ({ ...row, teamName: row.teamName ?? "Unknown" }));
}

export async function liveAuctionView(slug: string): Promise<LiveAuctionView | null> {
  const gate = await liveGate(slug);
  if (gate === null) {
    return null;
  }
  const [teamRows, paddleRows, grantRows, resolved, preSigned] = await withTenantDb(
    dbHandle,
    { personId: gate.personId, orgId: gate.competition.orgId },
    (db) =>
      Promise.all([
        db
          // shortName/primaryColor are franchise IDENTITY, not decoration: the
          // owner room tells four purses apart by colour at a glance, which is
          // the whole point of a paddle board.
          .select({
            id: teams.id,
            name: teams.name,
            shortName: teams.shortName,
            primaryColor: teams.primaryColor,
          })
          .from(teams)
          .where(eq(teams.competitionId, gate.competition.id))
          .orderBy(asc(teams.name)),
        myPaddles(db, gate.auction.id, gate.personId),
        db
          .select({ teamId: paddleGrants.teamId })
          .from(paddleGrants)
          .where(
            and(
              eq(paddleGrants.auctionId, gate.auction.id),
              eq(paddleGrants.personId, gate.personId),
              isNull(paddleGrants.revokedAt),
            ),
          ),
        resolvedLots(db, gate.auction.id),
        preSignedPlayers(db, gate.competition.id),
      ]),
  );
  // THE PARTITION. Everything below the gate is decided HERE, before the read
  // leaves the server — the payload gate that /seasons/…/money has always had
  // and this room never did. Hiding a rival's squad in the markup does not hide
  // it: it is in the RSC payload, in view-source, in the network tab.
  const canSeeAll = gate.canConduct;
  const mine = new Set(gate.myTeamIds);
  return {
    competition: { name: gate.competition.name, slug: gate.competition.slug },
    auctionId: gate.auction.id,
    // The seal, enforced at the source: a conductor's socket carries every
    // purse, a bidder's carries only their own teams' (P1-6).
    wsUrl: engineWsUrl(gate.auction.id, canSeeAll ? null : gate.myTeamIds),
    teams: teamRows,
    myPaddle: paddleRows[0] ?? null,
    myPaddles: paddleRows,
    myGrantTeamIds: grantRows.map((row) => row.teamId),
    myTeamIds: gate.myTeamIds,
    viewer: {
      personId: gate.personId,
      canConduct: gate.canConduct,
      canSeeAllPurses: canSeeAll,
      canSeeAllSquads: canSeeAll,
    },
    rules: rulesOf(gate.auction.config),
    // A sold lot's price and buyer are the room's own public record — the
    // auctioneer calls them out and /spectate publishes them. An UNSOLD or
    // WITHDRAWN lot is the same. So the resolved history stays whole; what a
    // bidder must not receive is the pre-signed roster, which is nowhere
    // announced, and the aggregated purse figures (see the client).
    resolved,
    preSigned: canSeeAll ? preSigned : preSigned.filter((player) => mine.has(player.teamId)),
  };
}

const CONDUCT_ONLY = new Set([
  "QueueLots",
  "OpenLot",
  "CloseLot",
  "PauseAuction",
  "ResumeAuction",
  "CompleteAuction",
  "AbortAuction",
  "RecoverAuction",
  // M-IP4-3: the full conduct surface.
  "OpenAuction",
  "IssuePaddle",
  "WithdrawLot",
  "HoldLot",
  "RequeueLot",
  "GrantPaddle",
  "UndoLastAction",
]);

// Token-flow commands never travel the generic gateway: invitations mint
// secrets (dedicated action returns the URL) and acceptance must present the
// TOKEN, not an invite id (owner-actions.ts owns both).
const GATEWAY_BLOCKED = new Set(["InviteOwner", "AcceptOwnerInvite"]);

/**
 * The single command gateway. `commandId` comes from the CLIENT so retries
 * (double-click, network replay) are idempotent end to end — the engine
 * returns the original ack for a repeated id.
 */
export async function submitAuctionCommand(
  slug: string,
  commandId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<CommandAck> {
  // The id is the idempotency key and it comes from the browser, so its SHAPE
  // is part of the trust boundary: the engine keys its cache on it, and its own
  // timer commands live in the same map (P0-2). The engine pins this too — this
  // is the near end of the same fence, and it answers before a round trip.
  if (!isTransportCommandId(commandId)) {
    return { commandId, accepted: false, reason: "invalid_command_id", version: 0 };
  }
  const gate = await liveGate(slug);
  if (gate === null) {
    return { commandId, accepted: false, reason: "unknown_auction", version: 0 };
  }
  if (!isAuctionCommandType(type) || GATEWAY_BLOCKED.has(type)) {
    return { commandId, accepted: false, reason: "unknown_command", version: 0 };
  }
  if (CONDUCT_ONLY.has(type) && !gate.canConduct) {
    return { commandId, accepted: false, reason: "not_authorized", version: 0 };
  }
  // The highest-friction action: undo demands the override capability too.
  if (type === "UndoLastAction" && !gate.canOverride) {
    return { commandId, accepted: false, reason: "not_authorized", version: 0 };
  }
  return sendEngineCommand({
    commandId,
    auctionId: gate.auction.id,
    type,
    actor: gate.personId,
    conduct: gate.canConduct,
    override: gate.canOverride,
    payload,
  });
}
