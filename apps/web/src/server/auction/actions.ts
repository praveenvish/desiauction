"use server";

import {
  validateAuctionConfig,
  paise,
  type AuctionConfig,
  type Paise,
  AUCTION_MACHINE,
  BID_MACHINE,
  DEFAULT_AUCTION_CONFIG,
  LOT_MACHINE,
  extendOnBid,
  openLotTimer,
  type MachineEdge,
} from "@desiauction/core";
import { redirect } from "next/navigation";

import { withTenantDb, type Db } from "@desiauction/db";

import { currentSession } from "../auth/actions";
import { canCompetition, requireCompetitionCapability } from "../competition/authz";
import { resolveCompetition, type CompetitionSummary } from "../competition/competitions";
import { dbHandle, systemDb } from "../db";
import { auctionReadiness, createAuction, type AuctionRecord } from "@desiauction/auction";
import { auctionOf, auctionView, type AuctionView } from "@desiauction/auction";
import { auctionReady, type AuctionReadyProjection } from "./auction-ready";
import { rulesOf, type AuctionRules } from "./live-summary";
import { engineWsUrl, sendEngineCommand } from "./engine-client";
import { auctionOverview, type AuctionOverview } from "./auction-overview";

// Auction internal RPC (M-IP4-1, rewired M-IP4-3). One gate: session → tenant
// → auction.conduct. Creation is the aggregate's birth (no live state exists
// yet); EVERY subsequent conduct step is an engine COMMAND — the setup surface
// no longer writes through the aggregate (nothing bypasses the command path).

async function requireSession() {
  const session = await currentSession();
  if (session === null) {
    redirect("/login");
  }
  return session;
}

function inCompetitionOrg<T>(
  personId: string,
  competition: { orgId: string },
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  return withTenantDb(dbHandle, { personId, orgId: competition.orgId }, fn);
}

async function conductGate(
  slug: string,
): Promise<
  { ok: true; personId: string; competition: CompetitionSummary } | { ok: false; error: string }
> {
  const session = await requireSession();
  const competition = await resolveCompetition(systemDb, session.personId, slug);
  if (competition === null) {
    return { ok: false, error: "Not available." };
  }
  try {
    await inCompetitionOrg(session.personId, competition, (db) =>
      requireCompetitionCapability(
        db,
        session.personId,
        { orgId: competition.orgId, competitionId: competition.id },
        "auction.conduct",
      ),
    );
  } catch {
    return { ok: false, error: "You can't conduct auctions here." };
  }
  return { ok: true, personId: session.personId, competition };
}

async function requireAuction(db: Db, competitionId: string): Promise<AuctionRecord | null> {
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
  /** PX-6 lobby: the locked rules (doc 41), display-only. Null pre-creation. */
  rules: AuctionRules | null;
  /** PX-6 lobby: snapshot stream address for the connection check. */
  wsUrl: string | null;
  /** The operational dashboard: progress, block, burndown, queue, log. */
  overview: AuctionOverview | null;
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
  const competition = await resolveCompetition(systemDb, session.personId, slug);
  if (competition === null) {
    return null;
  }
  const scope = { orgId: competition.orgId, competitionId: competition.id };
  const { ready, view, canConduct, rules, wsUrl, overview } = await inCompetitionOrg(
    session.personId,
    competition,
    async (db) => {
      const [readyProjection, auction, conduct] = await Promise.all([
        auctionReady(db, competition),
        requireAuction(db, competition.id),
        canCompetition(db, session.personId, scope, "auction.conduct"),
      ]);
      return {
        ready: readyProjection,
        view: auction === null ? null : await auctionView(db, auction),
        canConduct: conduct,
        rules: auction === null ? null : rulesOf(auction.config),
        wsUrl: auction === null ? null : engineWsUrl(auction.id),
        overview: auction === null ? null : await auctionOverview(db, auction.id, auction.config),
      };
    },
  );
  return {
    competition,
    ready,
    view,
    machines: { auction: AUCTION_MACHINE, lot: LOT_MACHINE, bid: BID_MACHINE },
    timerDemo: timerDemo(),
    viewer: { canConduct },
    rules,
    wsUrl,
    overview,
  };
}

// --- Aggregate operations (thin, gated pass-throughs) ------------------------------

/**
 * The numbers a league negotiates (DA-05). `AuctionConfig` and
 * `validateAuctionConfig` have been first-class since M-IP4-1; only the input
 * was missing, so every auction ever created took ₹2 Cr purses, 8–15 squads
 * and three fixed price bands. Every field is optional and falls back to the
 * default, so an organiser who does not care still clicks one button.
 */
export interface AuctionSetup {
  pursePerTeamRupees?: number;
  squadMin?: number;
  squadMax?: number;
  timerSeconds?: number;
  extensionSeconds?: number;
  /** Band label → base price in RUPEES, e.g. { A: 50000, B: 25000 }. */
  bands?: Record<string, number>;
  basePriceDefaultRupees?: number;
}

function configFrom(setup: AuctionSetup | undefined): AuctionConfig {
  if (setup === undefined) {
    return DEFAULT_AUCTION_CONFIG;
  }
  const rupees = (value: number | undefined, fallback: Paise): Paise =>
    value === undefined || !Number.isFinite(value) ? fallback : paise(Math.round(value * 100));
  const bands =
    setup.bands === undefined || Object.keys(setup.bands).length === 0
      ? DEFAULT_AUCTION_CONFIG.basePriceBands
      : Object.fromEntries(
          Object.entries(setup.bands).map(([label, amount]) => [
            label.trim().toUpperCase(),
            paise(Math.round(amount * 100)),
          ]),
        );
  return {
    ...DEFAULT_AUCTION_CONFIG,
    pursePerTeam: rupees(setup.pursePerTeamRupees, DEFAULT_AUCTION_CONFIG.pursePerTeam),
    squadMin: setup.squadMin ?? DEFAULT_AUCTION_CONFIG.squadMin,
    squadMax: setup.squadMax ?? DEFAULT_AUCTION_CONFIG.squadMax,
    timer: {
      initialSeconds: setup.timerSeconds ?? DEFAULT_AUCTION_CONFIG.timer.initialSeconds,
      extensionSeconds: setup.extensionSeconds ?? DEFAULT_AUCTION_CONFIG.timer.extensionSeconds,
    },
    basePriceBands: bands,
    basePriceDefault: rupees(setup.basePriceDefaultRupees, DEFAULT_AUCTION_CONFIG.basePriceDefault),
  };
}

export async function createAuctionAction(
  slug: string,
  setup?: AuctionSetup,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await conductGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const config = configFrom(setup);
  // Surface the validator's own verdict rather than a generic refusal — it
  // already names which rule failed.
  const valid = validateAuctionConfig(config);
  if (!valid.ok) {
    const detail: Record<string, string> = {
      "squad bounds": "Squad minimum must be at least 1 and no more than the maximum.",
      "increment slabs": "The bid increment steps are invalid.",
      "timer policy": "The lot timer and anti-snipe extension must both be positive.",
      "unsold rounds": "Unsold players must be re-offered at least once.",
      "base price vs purse": "The purse must cover at least one player at the default base price.",
    };
    return { ok: false, error: detail[valid.reason] ?? "The auction configuration is invalid." };
  }
  const result = await inCompetitionOrg(gate.personId, gate.competition, async (db) => {
    const ready = await auctionReady(db, gate.competition);
    return createAuction(db, gate.competition, ready, gate.personId, config);
  });
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

/** Conduct step → engine command (M-IP4-3: nothing bypasses the command path). */
async function conductCommand(
  slug: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string; version?: number; error?: string }> {
  const gate = await conductGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const auction = await inCompetitionOrg(gate.personId, gate.competition, (db) =>
    requireAuction(db, gate.competition.id),
  );
  if (auction === null) {
    return { ok: false, error: "Create the auction first." };
  }
  const ack = await sendEngineCommand({
    auctionId: auction.id,
    type: type as never,
    actor: gate.personId,
    conduct: true,
    payload,
  });
  if (!ack.accepted) {
    return { ok: false, reason: ack.reason ?? "", error: ack.reason ?? "Refused." };
  }
  return { ok: true, reason: ack.reason ?? "", version: ack.version };
}

export async function issuePaddleAction(
  slug: string,
  teamId: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await conductGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  // Manual mode: the conductor holds the paddle — an EXPLICIT organizer act
  // (the grant-then-claim self-service path lives on the cockpit).
  const result = await conductCommand(slug, "IssuePaddle", {
    teamId,
    personId: gate.personId,
  });
  if (!result.ok) {
    const message: Record<string, string> = {
      terminal_auction: "This auction has ended.",
      unknown_team: "Pick a team from this competition.",
      already_issued: "That team already has its paddle — paddles are never reissued.",
      engine_unreachable: "The auction engine is offline.",
    };
    return { ok: false, error: message[result.reason ?? ""] ?? result.error ?? "Refused." };
  }
  return { ok: true };
}

const AUCTION_COMMAND_OF: Record<string, string> = {
  open: "OpenAuction",
  pause: "PauseAuction",
  resume: "ResumeAuction",
  complete: "CompleteAuction",
  abort: "AbortAuction",
};

/** Name the gate that is red, rather than listing every gate there is. */
async function guardFailureDetail(slug: string, command: string): Promise<string> {
  const gate = await conductGate(slug);
  if (!gate.ok) {
    return "The auction isn't ready for that yet.";
  }
  const auction = await auctionOf(systemDb, gate.competition.id);
  if (auction === null) {
    return "The auction isn't ready for that yet.";
  }
  const readiness = await auctionReadiness(systemDb, auction.id, auction);
  if (command === "open") {
    if (readiness.paddleCount < 2) {
      return `Only ${String(readiness.paddleCount)} paddle(s) issued — an auction needs at least two teams ready to bid.`;
    }
    if (readiness.queuedLots < 1) {
      return "No lots are queued yet — queue the prepared lots first.";
    }
  }
  if (command === "complete" && readiness.unresolvedLots > 0) {
    return `${String(readiness.unresolvedLots)} lot(s) are still on the block or frozen — resolve them first.`;
  }
  return "The auction isn't ready for that yet.";
}

export async function auctionLifecycleAction(
  slug: string,
  command: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const type = AUCTION_COMMAND_OF[command];
  if (type === undefined) {
    return { ok: false, error: "Unknown auction command." };
  }
  const result = await conductCommand(slug, type, reason === undefined ? {} : { reason });
  if (!result.ok) {
    // DA-25: "check paddles, the queue, and unresolved lots" named all three
    // possibilities and none of the actual cause. The readiness numbers are
    // already loaded, so the refusal can say which gate is red.
    if (result.reason === "guard_failed") {
      return { ok: false, error: await guardFailureDetail(slug, command) };
    }
    const message: Record<string, string> = {
      illegal_transition: "That step isn't available from this state.",
      squad_below_minimum: "Some teams are still below the minimum squad size.",
      engine_unreachable: "The auction engine is offline.",
      engine_halted: "The engine halted fail-closed — run recovery from the cockpit.",
    };
    return { ok: false, error: message[result.reason ?? ""] ?? "Refused." };
  }
  return { ok: true };
}

export async function queueAllLotsAction(
  slug: string,
): Promise<{ ok: boolean; applied?: number; error?: string }> {
  const result = await conductCommand(slug, "QueueLots", {});
  if (!result.ok) {
    return { ok: false, error: result.error ?? "Refused." };
  }
  const applied = Number.parseInt((result.reason ?? "").replace("queued:", ""), 10);
  return { ok: true, applied: Number.isFinite(applied) ? applied : 0 };
}

export interface ReplayVerifyReport {
  ok: boolean;
  eventCount: number;
  divergences: number;
  reason?: string;
}

/** Replay & verify via the engine's RecoverAuction — the same audited path. */
export async function verifyReplayAction(
  slug: string,
): Promise<{ ok: boolean; report?: ReplayVerifyReport; error?: string }> {
  const result = await conductCommand(slug, "RecoverAuction", {});
  if (!result.ok) {
    return {
      ok: true,
      report: { ok: false, eventCount: 0, divergences: 0, reason: result.reason ?? "" },
    };
  }
  const healed = (result.reason ?? "").startsWith("healed:")
    ? Number.parseInt((result.reason ?? "").replace("healed:", ""), 10)
    : 0;
  return {
    ok: true,
    report: {
      // The ack's version IS the last event seq — the count of the fold.
      ok: true,
      eventCount: result.version ?? 0,
      divergences: Number.isFinite(healed) ? healed : 0,
    },
  };
}
