"use server";

import { auctionOf, type AuctionRecord } from "@desiauction/auction";
import { isAuctionCommandType, type CommandAck } from "@desiauction/core";
import { paddles, teams, type Db } from "@desiauction/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { canCompetition } from "../competition/authz";
import { resolveCompetition, type CompetitionSummary } from "../competition/competitions";
import { db } from "../db";
import { engineWsUrl, sendEngineCommand } from "./engine-client";

// Live auction actions (M-IP4-2). The web tier authenticates, resolves the
// tenant and capability, then SUBMITS A COMMAND — the engine decides. Any org
// member may claim a paddle and bid (owner grants arrive with team invitations
// in a later milestone); conduct commands require auction.conduct.

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
}

async function liveGate(slug: string): Promise<LiveGate | null> {
  const session = await requireSession();
  const competition = await resolveCompetition(db, session.personId, slug);
  if (competition === null) {
    return null;
  }
  const auction = await auctionOf(db, competition.id);
  if (auction === null) {
    return null;
  }
  const canConduct = await canCompetition(
    db,
    session.personId,
    { orgId: competition.orgId, competitionId: competition.id },
    "auction.conduct",
  );
  return { personId: session.personId, competition, auction, canConduct };
}

export interface LiveAuctionView {
  competition: { name: string; slug: string };
  auctionId: string;
  wsUrl: string;
  teams: { id: string; name: string }[];
  myPaddle: { paddleId: string; paddleNumber: string; teamId: string; teamName: string } | null;
  viewer: { personId: string; canConduct: boolean };
}

async function myActivePaddle(dbc: Db, auctionId: string, personId: string) {
  const [row] = await dbc
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
    .limit(1);
  return row === undefined ? null : { ...row, teamName: row.teamName ?? "Unknown" };
}

export async function liveAuctionView(slug: string): Promise<LiveAuctionView | null> {
  const gate = await liveGate(slug);
  if (gate === null) {
    return null;
  }
  const [teamRows, mine] = await Promise.all([
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.competitionId, gate.competition.id))
      .orderBy(asc(teams.name)),
    myActivePaddle(db, gate.auction.id, gate.personId),
  ]);
  return {
    competition: { name: gate.competition.name, slug: gate.competition.slug },
    auctionId: gate.auction.id,
    wsUrl: engineWsUrl(gate.auction.id),
    teams: teamRows,
    myPaddle: mine,
    viewer: { personId: gate.personId, canConduct: gate.canConduct },
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
]);

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
  if (!isAuctionCommandType(type)) {
    return { commandId, accepted: false, reason: "unknown_command", version: 0 };
  }
  if (CONDUCT_ONLY.has(type) && !gate.canConduct) {
    return { commandId, accepted: false, reason: "not_authorized", version: 0 };
  }
  return sendEngineCommand({
    commandId,
    auctionId: gate.auction.id,
    type,
    actor: gate.personId,
    conduct: gate.canConduct,
    payload,
  });
}
