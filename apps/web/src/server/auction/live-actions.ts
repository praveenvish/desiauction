"use server";

import { auctionOf, type AuctionRecord } from "@desiauction/auction";
import { isAuctionCommandType, type CommandAck } from "@desiauction/core";
import { paddleGrants, paddles, teams, withTenantDb, type Db } from "@desiauction/db";
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
}

export async function liveGate(slug: string): Promise<LiveGate | null> {
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
      const [canConduct, canOverride] = await Promise.all([
        canCompetition(db, session.personId, scope, "auction.conduct"),
        canCompetition(db, session.personId, scope, "auction.override"),
      ]);
      return { personId: session.personId, competition, auction, canConduct, canOverride };
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
  viewer: { personId: string; canConduct: boolean };
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
  const [teamRows, mine, grantRows, resolved, preSigned] = await withTenantDb(
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
  return {
    competition: { name: gate.competition.name, slug: gate.competition.slug },
    auctionId: gate.auction.id,
    wsUrl: engineWsUrl(gate.auction.id),
    teams: teamRows,
    myPaddle: mine[0] ?? null,
    myPaddles: mine,
    myGrantTeamIds: grantRows.map((row) => row.teamId),
    viewer: { personId: gate.personId, canConduct: gate.canConduct },
    rules: rulesOf(gate.auction.config),
    resolved,
    preSigned,
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
