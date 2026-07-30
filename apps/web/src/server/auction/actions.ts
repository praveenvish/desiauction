"use server";

import {
  validateAuctionConfig,
  type AuctionConfig,
  type AuctionStatus,
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
import { auctionOf, auctionView, type AuctionView, type PaddleView } from "@desiauction/auction";
import { auctionReady, type AuctionReadyProjection } from "./auction-ready";
import {
  parseAuctionSetup,
  squadFeasibility,
  SHORT_SQUAD_OVERRIDE_HINT,
  type AuctionSetupFieldErrors,
  type AuctionSetupInput,
  type SquadFeasibility,
} from "./auction-setup";
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

/**
 * DA-30, the second copy. The burndown read (`auctionOverview`) was gated and
 * that fix held — but `auctionView` was never touched, and it carries the same
 * secret in different words: `committed` IS a team's spend, and the locked
 * config's `pursePerTeam` sits beside it, so remaining purse is one subtraction
 * away. Measured on the served payload for an org member with zero grants.
 *
 * The keys are OMITTED rather than nulled: a null is still an answer, and the
 * value must never leave the server for a viewer who may not have it. The
 * lifecycle card and the rules card render the purse only when it is present.
 */
export type GatedPaddleView = Omit<PaddleView, "committed"> & { committed?: number };
export type GatedAuctionConfig = Omit<AuctionConfig, "pursePerTeam"> & { pursePerTeam?: number };
export type GatedAuctionRules = Omit<AuctionRules, "pursePerTeam"> & { pursePerTeam?: number };

export interface GatedAuctionView extends Omit<AuctionView, "auction" | "paddles"> {
  auction: { id: string; name: string; status: AuctionStatus; config: GatedAuctionConfig };
  paddles: readonly GatedPaddleView[];
}

/**
 * Rebuilt key by key rather than spread-and-delete: the money-blind payload is
 * a WHITELIST, so a field added to the config or the paddle view later cannot
 * leak by default — it has to be let through here on purpose.
 */
function gateAuctionView(view: AuctionView, money: boolean): GatedAuctionView {
  if (money) {
    return view;
  }
  const config = view.auction.config;
  return {
    ...view,
    auction: {
      id: view.auction.id,
      name: view.auction.name,
      status: view.auction.status,
      config: {
        squadMin: config.squadMin,
        squadMax: config.squadMax,
        slabs: config.slabs,
        timer: config.timer,
        unsoldPolicy: config.unsoldPolicy,
        basePriceBands: config.basePriceBands,
        basePriceDefault: config.basePriceDefault,
        roleQuotas: config.roleQuotas,
      },
    },
    paddles: view.paddles.map((paddle) => ({
      id: paddle.id,
      paddleNumber: paddle.paddleNumber,
      teamId: paddle.teamId,
      teamName: paddle.teamName,
      holderName: paddle.holderName,
      squadSize: paddle.squadSize,
    })),
  };
}

function gateRules(rules: AuctionRules, money: boolean): GatedAuctionRules {
  return money
    ? rules
    : {
        squadMin: rules.squadMin,
        squadMax: rules.squadMax,
        initialSeconds: rules.initialSeconds,
        extensionSeconds: rules.extensionSeconds,
        slabs: rules.slabs,
      };
}

export interface AuctionDashboard {
  competition: CompetitionSummary;
  ready: AuctionReadyProjection;
  view: GatedAuctionView | null;
  machines: {
    auction: readonly MachineEdge<string, string>[];
    lot: readonly MachineEdge<string, string>[];
    bid: readonly MachineEdge<string, string>[];
  };
  timerDemo: { initialSeconds: number; extensionSeconds: number; steps: TimerDemoStep[] };
  viewer: { canConduct: boolean };
  /** PX-6 lobby: the locked rules (doc 41), display-only. Null pre-creation. */
  rules: GatedAuctionRules | null;
  /**
   * Can this room work at all? Pool against teams × squadMin, under the config
   * that is (or would be) locked in. Deliberately NOT one of `ready.checks`:
   * the checks decide whether creation is allowed, and this is a shortfall an
   * organizer may knowingly accept.
   */
  feasibility: SquadFeasibility;
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

/** The shortfall sum, from the projection and whichever config applies. */
function feasibilityOf(
  ready: AuctionReadyProjection,
  config: { squadMin: number; squadMax: number },
): SquadFeasibility {
  return squadFeasibility({
    // Only players still to be placed can fill a seat: anyone already on a
    // team sheet is counted on the other side of the sum, never twice.
    poolSize: ready.pool.filter((entry) => entry.teamId === null).length,
    squadSizes: ready.squadSizes,
    squadMin: config.squadMin,
    squadMax: config.squadMax,
  });
}

export async function auctionDashboard(slug: string): Promise<AuctionDashboard | null> {
  const session = await requireSession();
  const competition = await resolveCompetition(systemDb, session.personId, slug);
  if (competition === null) {
    return null;
  }
  const scope = { orgId: competition.orgId, competitionId: competition.id };
  const { ready, view, canConduct, rules, wsUrl, overview, feasibility } = await inCompetitionOrg(
    session.personId,
    competition,
    async (db) => {
      const [readyProjection, auction, conduct, manage] = await Promise.all([
        auctionReady(db, competition),
        requireAuction(db, competition.id),
        canCompetition(db, session.personId, scope, "auction.conduct"),
        canCompetition(db, session.personId, scope, "competition.manage"),
      ]);
      // DA-30: running the night, or running the season. Nothing else sees a
      // rival's remaining purse — least of all a team owner, whom
      // `acceptOwnerJoin` made a member of this very org.
      const money = conduct || manage;
      const config = auction?.config ?? DEFAULT_AUCTION_CONFIG;
      return {
        ready: readyProjection,
        view: auction === null ? null : gateAuctionView(await auctionView(db, auction), money),
        canConduct: conduct,
        rules: auction === null ? null : gateRules(rulesOf(auction.config), money),
        feasibility: feasibilityOf(readyProjection, config),
        wsUrl: auction === null ? null : engineWsUrl(auction.id),
        overview:
          auction === null
            ? null
            : await auctionOverview(db, auction.id, auction.config, { money }),
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
    feasibility,
    wsUrl,
    overview,
  };
}

// --- Aggregate operations (thin, gated pass-throughs) ------------------------------

/**
 * The numbers a league negotiates (DA-05), now as the organizer typed them.
 * Parsing and refusal live in `auction-setup.ts` so the form shows the exact
 * message the server would produce, and the server trusts none of it.
 */
export type AuctionSetup = AuctionSetupInput;

export interface CreateAuctionResult {
  ok: boolean;
  error?: string;
  /** Field name → message, rendered under the input that owns it. */
  fieldErrors?: AuctionSetupFieldErrors;
  /** True when the only thing in the way is a shortfall the organizer can accept. */
  shortSquads?: boolean;
}

export async function createAuctionAction(
  slug: string,
  setup?: AuctionSetup,
): Promise<CreateAuctionResult> {
  const gate = await conductGate(slug);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  let config: AuctionConfig;
  if (setup === undefined) {
    config = DEFAULT_AUCTION_CONFIG;
  } else {
    const parsed = parseAuctionSetup(setup);
    if (!parsed.ok) {
      return {
        ok: false,
        error: "Check the highlighted fields — nothing was created.",
        fieldErrors: parsed.fieldErrors,
      };
    }
    config = parsed.config;
  }
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
    // The arithmetic, before the room exists. An organizer may still proceed —
    // a league that genuinely has 14 players for 3 teams is allowed to run —
    // but never by accident, and never without being told where the exit is.
    const feasibility = feasibilityOf(ready, config);
    if (!feasibility.ok && setup?.acceptShortSquads !== true) {
      return { refusal: feasibility.headline } as const;
    }
    return createAuction(db, gate.competition, ready, gate.personId, config);
  });
  if ("refusal" in result) {
    return {
      ok: false,
      error: result.refusal,
      shortSquads: true,
      fieldErrors: {
        squadMin: `${result.refusal} Lower the squad minimum, add players to the pool, or accept the shortfall below. ${SHORT_SQUAD_OVERRIDE_HINT}`,
      },
    };
  }
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

/**
 * Hand the paddle back. Until now `IssuePaddle` was one-way: it hardcodes the
 * clicking organizer as the holder, there was no release, and one browser can
 * only claim one paddle — so an organizer who issued twice ended up holding
 * both, with no way out but aborting the auction. `ReleasePaddle` is an
 * existing engine command (`conduct` releases any team's paddle), so this is a
 * wire-up, not a new rule: release, then invite the owner or issue again.
 */
export async function releasePaddleAction(
  slug: string,
  teamId: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await conductCommand(slug, "ReleasePaddle", { teamId });
  if (!result.ok) {
    const message: Record<string, string> = {
      no_active_paddle: "That team has no paddle to release.",
      not_authorized: "You can't release that paddle.",
      terminal_auction: "This auction has ended.",
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

/** The same sum as creation, re-run against the config that actually locked. */
async function openFeasibility(slug: string): Promise<SquadFeasibility | null> {
  const gate = await conductGate(slug);
  if (!gate.ok) {
    return null;
  }
  return inCompetitionOrg(gate.personId, gate.competition, async (db) => {
    const auction = await requireAuction(db, gate.competition.id);
    if (auction === null) {
      return null;
    }
    return feasibilityOf(await auctionReady(db, gate.competition), auction.config);
  });
}

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
  options?: { acceptShortSquads?: boolean },
): Promise<{ ok: boolean; error?: string; shortSquads?: boolean }> {
  const type = AUCTION_COMMAND_OF[command];
  if (type === undefined) {
    return { ok: false, error: "Unknown auction command." };
  }
  // The second place the arithmetic has to hold: the door to the room. An
  // auction opened short can be conducted but not closed without the
  // conductor's override, so say so here rather than at 11pm.
  if (command === "open" && options?.acceptShortSquads !== true) {
    const feasibility = await openFeasibility(slug);
    if (feasibility !== null && !feasibility.ok) {
      return {
        ok: false,
        shortSquads: true,
        error: `${feasibility.headline} Opening is still possible — accept the shortfall to go ahead. ${SHORT_SQUAD_OVERRIDE_HINT}`,
      };
    }
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
      // DA-25 again: the refusal that never named its own exit.
      squad_below_minimum: `Some teams are still below the minimum squad size. ${SHORT_SQUAD_OVERRIDE_HINT}`,
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
