"use server";

import {
  AUCTION_MACHINE,
  BID_MACHINE,
  DEFAULT_AUCTION_CONFIG,
  LOT_MACHINE,
  extendOnBid,
  openLotTimer,
  type AuctionCommand,
  type LotCommand,
  type MachineEdge,
} from "@desiauction/core";
import { redirect } from "next/navigation";

import { currentSession } from "../auth/actions";
import { canCompetition, requireCompetitionCapability } from "../competition/authz";
import { resolveCompetition, type CompetitionSummary } from "../competition/competitions";
import { db } from "../db";
import {
  createAuction,
  issuePaddle,
  queueAllLots,
  recoverAuction,
  transitionAuction,
  transitionLot,
  type AuctionRecord,
  type RecoveryReport,
} from "@desiauction/auction";
import { auctionOf, auctionView, type AuctionView } from "@desiauction/auction";
import { auctionReady, type AuctionReadyProjection } from "./auction-ready";
import { notifyEngineReset } from "./engine-client";

// Auction internal RPC (M-IP4-1). One gate: session → tenant → auction.conduct
// → aggregate. NO bidding endpoint exists this milestone (stop condition): the
// bid aggregate is exercised by the regression suite only.

async function requireSession() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login");
  }
  return session;
}

async function conductGate(
  slug: string,
): Promise<
  { ok: true; personId: string; competition: CompetitionSummary } | { ok: false; error: string }
> {
  const session = await requireSession();
  const competition = await resolveCompetition(db, session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    await requireCompetitionCapability(
      db,
      session.personId,
      { orgId: competition.orgId, competitionId: competition.id },
      "auction.conduct",
    );
  } catch {
    return { ok: false, error: "You can't conduct auctions here." };
  }
  return { ok: true, personId: session.personId, competition };
}

async function requireAuction(competitionId: string): Promise<AuctionRecord | null> {
  return auctionOf(db, competitionId);
}

// --- Dashboard (the founder demonstration surface) --------------------------------

export interface TimerDemoStep {
  label: string;
  atSecond: number;
  endsAtSecond: number;
  extended: boolean;
}

export interface AuctionDashboard {
  competition: CompetitionSummary;
  ready: AuctionReadyProjection;
  view: AuctionView | null;
  machines: {
    auction: readonly MachineEdge<string, string>[];
    lot: readonly MachineEdge<string, string>[];
    bid: readonly MachineEdge<string, string>[];
  };
  timerDemo: { initialSeconds: number; extensionSeconds: number; steps: TimerDemoStep[] };
  viewer: { canConduct: boolean };
}

/** A deterministic worked example of the timer model — computed, not animated. */
function timerDemo(): AuctionDashboard["timerDemo"] {
  const policy = DEFAULT_AUCTION_CONFIG.timer;
  const t0 = 0;
  let timer = openLotTimer(t0, policy);
  const steps: TimerDemoStep[] = [
    { label: "Lot opens", atSecond: 0, endsAtSecond: timer.endsAtMs / 1000, extended: false },
  ];
  const bids: { at: number; label: string }[] = [
    { at: 10, label: "Bid at 10s (20s remain — no extension)" },
    { at: 28, label: "Bid at 28s (2s remain — anti-snipe extends)" },
    { at: 41, label: "Bid at 41s (2s remain — extends again)" },
  ];
  for (const bid of bids) {
    const result = extendOnBid(timer, t0 + bid.at * 1000, policy);
    timer = result.timer;
    steps.push({
      label: bid.label,
      atSecond: bid.at,
      endsAtSecond: timer.endsAtMs / 1000,
      extended: result.extended,
    });
  }
  return {
    initialSeconds: policy.initialSeconds,
    extensionSeconds: policy.extensionSeconds,
    steps,
  };
}

export async function auctionDashboard(slug: string): Promise<AuctionDashboard | null> {
  const session = await requireSession();
  const competition = await resolveCompetition(db, session.personId, slug);
  if (competition === null) {
    return null;
  }
  const scope = { orgId: competition.orgId, competitionId: competition.id };
  const [ready, auction, canConduct] = await Promise.all([
    auctionReady(db, competition),
    requireAuction(competition.id),
    canCompetition(db, session.personId, scope, "auction.conduct"),
  ]);
  const view = auction === null ? null : await auctionView(db, auction);
  return {
    competition,
    ready,
    view,
    machines: { auction: AUCTION_MACHINE, lot: LOT_MACHINE, bid: BID_MACHINE },
    timerDemo: timerDemo(),
    viewer: { canConduct },
  };
}

// --- Aggregate operations (thin, gated pass-throughs) ------------------------------

export async function createAuctionAction(slug: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await conductGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const ready = await auctionReady(db, gate.competition);
  const result = await createAuction(
    db,
    gate.competition,
    ready,
    gate.personId,
    DEFAULT_AUCTION_CONFIG,
  );
  if (!result.ok) {
    const message = {
      not_ready: "The competition isn't auction-ready yet — see the checklist.",
      invalid_config: "The auction configuration is invalid.",
      auction_exists: "An auction already exists for this competition.",
    }[result.reason];
    return { ok: false, error: message };
  }
  return { ok: true };
}

export async function issuePaddleAction(
  slug: string,
  teamId: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await conductGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const auction = await requireAuction(gate.competition.id);
  if (auction === null) {
    return { ok: false, error: "Create the auction first." };
  }
  // M-IP4-1: the conductor holds the paddle (owner invitations arrive later).
  const result = await issuePaddle(db, auction, gate.personId, teamId, gate.personId);
  if (!result.ok) {
    const message = {
      terminal_auction: "This auction has ended.",
      unknown_team: "Pick a team from this competition.",
      already_issued: "That team already has its paddle — paddles are never reissued.",
    }[result.reason];
    return { ok: false, error: message };
  }
  return { ok: true };
}

const AUCTION_COMMANDS = new Set<Exclude<AuctionCommand, "reconcile">>([
  "open",
  "pause",
  "resume",
  "complete",
  "abort",
]);

export async function auctionLifecycleAction(
  slug: string,
  command: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await conductGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  if (!AUCTION_COMMANDS.has(command as Exclude<AuctionCommand, "reconcile">)) {
    return { ok: false, error: "Unknown auction command." };
  }
  const auction = await requireAuction(gate.competition.id);
  if (auction === null) {
    return { ok: false, error: "Create the auction first." };
  }
  const result = await transitionAuction(
    db,
    auction,
    gate.personId,
    command as Exclude<AuctionCommand, "reconcile">,
    reason,
  );
  if (result.ok) {
    await notifyEngineReset(auction.id);
  }
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "guard_failed"
          ? "The guard refused: check paddles, the queue, and unresolved lots."
          : "That step isn't available from this state.",
    };
  }
  return { ok: true };
}

const LOT_COMMANDS = new Set<Exclude<LotCommand, "closing" | "extend">>([
  "queue",
  "open",
  "hold",
  "sell",
  "pass",
  "requeue",
  "withdraw",
]);

export async function lotLifecycleAction(
  slug: string,
  lotId: string,
  command: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await conductGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  if (!LOT_COMMANDS.has(command as Exclude<LotCommand, "closing" | "extend">)) {
    return { ok: false, error: "Unknown lot command." };
  }
  const auction = await requireAuction(gate.competition.id);
  if (auction === null) {
    return { ok: false, error: "Create the auction first." };
  }
  const result = await transitionLot(
    db,
    auction,
    lotId,
    gate.personId,
    command as Exclude<LotCommand, "closing" | "extend">,
    reason,
  );
  if (!result.ok) {
    const message: Record<string, string> = {
      not_found: "That lot is not available.",
      illegal_transition: "That step isn't available for this lot.",
      guard_failed: "The guard refused (leading bid / requeue policy).",
      auction_not_live: "Open the auction first.",
      another_lot_open: "Another lot is already on the block.",
    };
    return { ok: false, error: message[result.reason] ?? "Refused." };
  }
  return { ok: true };
}

export async function queueAllLotsAction(
  slug: string,
): Promise<{ ok: boolean; applied?: number; skipped?: number; error?: string }> {
  const gate = await conductGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const auction = await requireAuction(gate.competition.id);
  if (auction === null) {
    return { ok: false, error: "Create the auction first." };
  }
  const result = await queueAllLots(db, auction, gate.personId);
  return { ok: true, ...result };
}

export async function verifyReplayAction(
  slug: string,
): Promise<{ ok: boolean; report?: RecoveryReport; error?: string }> {
  const gate = await conductGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const auction = await requireAuction(gate.competition.id);
  if (auction === null) {
    return { ok: false, error: "Create the auction first." };
  }
  const report = await recoverAuction(db, auction, gate.personId);
  return { ok: true, report };
}
