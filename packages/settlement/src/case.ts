/**
 * The SettlementCase aggregate (IP-5_ARCHITECTURE §11): one case per auction,
 * one stream, one reducer. Pure — no IO, no ambient time, no randomness.
 *
 * The machine is the organizer's exhale made explicit: a night is verified
 * against the frozen auction log, turned into obligations, discharged, settled
 * and closed. `closed` IS the "Reconciled" designation — the auction's own
 * stream never records it (that stream is frozen, and its watchdog would heal a
 * hand-mutated status right back).
 *
 * While a case is `discrepant`, money quiesces: no obligation, waiver or
 * adjustment folds. Exiting discrepancy is an override, and the exit RE-PINS
 * intake — which is what absorbs the one lawful way a completed auction's log
 * can still grow (an `AuctionRecovered` append) without stranding the case.
 */

import { addPaise, deductPaise, paise, type Paise } from "@desiauction/core";

import {
  arr,
  money,
  num,
  obj,
  str,
  type ReplayFailure,
  type SettlementEventEnvelope,
} from "./events";

export type CaseStatus =
  "opened" | "verified" | "discrepant" | "settling" | "settled" | "closed" | "voided";

export const CASE_STATUSES: readonly CaseStatus[] = [
  "opened",
  "verified",
  "discrepant",
  "settling",
  "settled",
  "closed",
  "voided",
];

export type CaseCommand = "verify" | "compute" | "settle" | "close" | "reopen" | "void";

/**
 * Command legality. The `verify` command has two lawful outcomes (verified /
 * discrepant) chosen by the intake fold, never by the caller — so the machine
 * is expressed as command legality plus event legality, and replay enforces the
 * second independently of any caller.
 */
const CASE_EDGES: Record<CaseStatus, ReadonlySet<CaseCommand>> = {
  opened: new Set(["verify", "void"]),
  verified: new Set(["compute", "void"]),
  discrepant: new Set(["verify", "void"]),
  settling: new Set(["settle"]),
  settled: new Set(["close", "reopen"]),
  closed: new Set(["reopen"]),
  voided: new Set([]),
};

export function caseCommandAllowed(status: CaseStatus, command: CaseCommand): boolean {
  return CASE_EDGES[status].has(command);
}

/** The override-gated commands (doc 28 ladder 4 — the highest-friction acts). */
export const OVERRIDE_COMMANDS: readonly CaseCommand[] = ["reopen", "void"];

export interface CaseMachineEdge {
  readonly from: CaseStatus;
  readonly command: CaseCommand;
  readonly to: readonly CaseStatus[];
}

/** The machine, rendered from the same descriptor the reducer enforces. */
export const CASE_MACHINE: readonly CaseMachineEdge[] = [
  { from: "opened", command: "verify", to: ["verified", "discrepant"] },
  { from: "opened", command: "void", to: ["voided"] },
  { from: "verified", command: "compute", to: ["settling"] },
  { from: "verified", command: "void", to: ["voided"] },
  { from: "discrepant", command: "verify", to: ["verified", "discrepant"] },
  { from: "discrepant", command: "void", to: ["voided"] },
  { from: "settling", command: "settle", to: ["settled"] },
  { from: "settled", command: "close", to: ["closed"] },
  { from: "settled", command: "reopen", to: ["settling"] },
  { from: "closed", command: "reopen", to: ["settling"] },
];

/** How a case's dues are derived from the frozen auction fold (§11). */
export type ObligationBasis = "committed" | "fixed" | "none";

export const OBLIGATION_BASES: readonly ObligationBasis[] = ["committed", "fixed", "none"];

export function isObligationBasis(value: string): value is ObligationBasis {
  return (OBLIGATION_BASES as readonly string[]).includes(value);
}

/**
 * One team's dues on one case. Every counter is NON-NEGATIVE money (invariant:
 * direction lives in the ledger's legs, never in a sign) — the outstanding
 * amount is DERIVED from them, never stored.
 */
export interface ObligationProjection {
  readonly teamId: string;
  amount: number; // the originally computed due
  increased: number; // override adjustments upward
  reduced: number; // override adjustments downward
  discharged: number; // collected (payment policy — M-IP5-2)
  waived: number; // audited forgiveness
  reinstated: number; // refund reversal (payment policy — M-IP5-2)
}

/** Upholds: outstanding is a fold, never a column (§9.2 / §17.4). */
export function outstandingOf(obligation: ObligationProjection): Paise {
  const owed = addPaise(
    addPaise(paise(obligation.amount), paise(obligation.increased)),
    paise(obligation.reinstated),
  );
  const settled = addPaise(
    addPaise(paise(obligation.reduced), paise(obligation.discharged)),
    paise(obligation.waived),
  );
  const remaining = deductPaise(owed, settled);
  // Unreachable through the reducer (every reducing event is bounded by the
  // outstanding amount before it applies) — kept as a total function, never a throw.
  return remaining.ok ? remaining.value : paise(0);
}

export interface CaseProjection {
  status: CaseStatus;
  caseId: string;
  /** Who opened it — an event fact, so the row is fully healable from the log. */
  openedBy: string;
  auctionId: string;
  competitionId: string;
  basis: ObligationBasis;
  /** The intake PIN: what the frozen auction log looked like when trusted. */
  sourceEventCount: number;
  sourceDigest: string;
  /** The fold digest recorded by the most recent verification (null until then). */
  foldDigest: string | null;
  obligations: Record<string, ObligationProjection>;
  recoveries: number;
  reopenings: number;
  /** The immutable evidence package of the most recent closure (§7, M-IP5-3). */
  closureEvidence: Readonly<Record<string, unknown>> | null;
  /** The seq of the most recent CaseClosed — the overlay's closure anchor. */
  closedAtSeq: number | null;
  /** How many times this case has been closed (re-close after reopen). */
  closures: number;
  lastSeq: number;
  eventCount: number;
}

export type CaseReplayResult = { ok: true; projection: CaseProjection } | ReplayFailure;

const OBLIGATION_EVENTS = new Set([
  "ObligationDischarged",
  "ObligationWaived",
  "ObligationReinstated",
  "ObligationAdjusted",
]);

/**
 * Fold the case stream. Deterministic (same events → same projection) and
 * fail-closed: a gap, an unknown type, an illegal transition, a malformed
 * payload, an unknown team or an over-discharge stops the fold at the offending
 * seq. Money that cannot be folded is never guessed at.
 */
export function replayCase(events: readonly SettlementEventEnvelope[]): CaseReplayResult {
  let projection: CaseProjection | null = null;

  for (const event of events) {
    const fail = (reason: ReplayFailure["reason"]): CaseReplayResult => ({
      ok: false,
      atSeq: event.seq,
      reason,
    });

    if (projection === null) {
      // Nothing exists before the case is opened — not even a recovery.
      if (event.seq !== 1) {
        return fail("sequence_gap");
      }
      if (event.type !== "CaseOpened") {
        return fail("unknown_case");
      }
      const caseId = str(event.payload, "caseId");
      const auctionId = str(event.payload, "auctionId");
      const competitionId = str(event.payload, "competitionId");
      const basisRaw = str(event.payload, "basis");
      const sourceEventCount = num(event.payload, "sourceEventCount");
      const sourceDigest = str(event.payload, "sourceDigest");
      if (
        caseId === null ||
        auctionId === null ||
        competitionId === null ||
        basisRaw === null ||
        !isObligationBasis(basisRaw) ||
        sourceEventCount === null ||
        !Number.isSafeInteger(sourceEventCount) ||
        sourceEventCount < 0 ||
        sourceDigest === null
      ) {
        return fail("malformed_case");
      }
      projection = {
        status: "opened",
        caseId,
        openedBy: event.actor,
        auctionId,
        competitionId,
        basis: basisRaw,
        sourceEventCount,
        sourceDigest,
        foldDigest: null,
        obligations: {},
        recoveries: 0,
        reopenings: 0,
        closureEvidence: null,
        closedAtSeq: null,
        closures: 0,
        lastSeq: 1,
        eventCount: 1,
      };
      continue;
    }

    if (event.seq !== projection.lastSeq + 1) {
      return fail("sequence_gap");
    }
    const state = projection;

    // Obligation movements are legal only while settling — the frozen-money
    // posture: a discrepant, settled, closed or voided case never moves money.
    if (OBLIGATION_EVENTS.has(event.type) && state.status !== "settling") {
      return fail("illegal_replayed_transition");
    }

    switch (event.type) {
      case "CaseOpened":
        return fail("illegal_replayed_transition");

      case "CaseVerified": {
        if (state.status !== "opened" && state.status !== "discrepant") {
          return fail("illegal_replayed_transition");
        }
        const foldDigest = str(event.payload, "foldDigest");
        const sourceEventCount = num(event.payload, "sourceEventCount");
        const sourceDigest = str(event.payload, "sourceDigest");
        if (
          foldDigest === null ||
          sourceDigest === null ||
          sourceEventCount === null ||
          !Number.isSafeInteger(sourceEventCount) ||
          sourceEventCount < 0
        ) {
          return fail("malformed_case");
        }
        // Every verification records the pin it stands on, and RE-PINS intake:
        // an AuctionRecovered append on the frozen source grows the count without
        // changing the fold, and the override re-verification adopts it (§11).
        state.sourceEventCount = sourceEventCount;
        state.sourceDigest = sourceDigest;
        state.foldDigest = foldDigest;
        state.status = "verified";
        break;
      }

      case "CaseDiscrepant": {
        if (state.status !== "opened" && state.status !== "discrepant") {
          return fail("illegal_replayed_transition");
        }
        if (str(event.payload, "reasonCode") === null) {
          return fail("malformed_case");
        }
        state.status = "discrepant";
        break;
      }

      case "ObligationsComputed": {
        if (state.status !== "verified") {
          return fail("illegal_replayed_transition");
        }
        const items = arr(event.payload, "items");
        if (items === null) {
          return fail("malformed_obligation");
        }
        for (const raw of items) {
          const item = obj(raw);
          const teamId = item === null ? null : str(item, "teamId");
          const amount = item === null ? null : money(item, "amount");
          if (teamId === null || amount === null) {
            return fail("malformed_obligation");
          }
          if (state.obligations[teamId] !== undefined) {
            return fail("malformed_obligation");
          }
          state.obligations[teamId] = {
            teamId,
            amount,
            increased: 0,
            reduced: 0,
            discharged: 0,
            waived: 0,
            reinstated: 0,
          };
        }
        state.status = "settling";
        break;
      }

      case "ObligationDischarged":
      case "ObligationWaived": {
        const teamId = str(event.payload, "teamId");
        const amount = money(event.payload, "amount");
        if (teamId === null || amount === null) {
          return fail("malformed_obligation");
        }
        const obligation = state.obligations[teamId];
        if (obligation === undefined) {
          return fail("unknown_team");
        }
        // Bounded by construction: nothing may discharge or forgive more than is
        // owed. A forged over-discharge does not fold — it halts.
        if (!deductPaise(outstandingOf(obligation), paise(amount)).ok) {
          return fail("obligation_overdischarged");
        }
        if (event.type === "ObligationDischarged") {
          obligation.discharged = addPaise(paise(obligation.discharged), paise(amount));
        } else {
          obligation.waived = addPaise(paise(obligation.waived), paise(amount));
        }
        break;
      }

      case "ObligationReinstated": {
        const teamId = str(event.payload, "teamId");
        const amount = money(event.payload, "amount");
        const compensates = num(event.payload, "compensates");
        if (teamId === null || amount === null || compensates === null) {
          return fail("malformed_obligation");
        }
        const obligation = state.obligations[teamId];
        if (obligation === undefined) {
          return fail("unknown_team");
        }
        obligation.reinstated = addPaise(paise(obligation.reinstated), paise(amount));
        break;
      }

      case "ObligationAdjusted": {
        const teamId = str(event.payload, "teamId");
        const amount = money(event.payload, "amount");
        const kind = str(event.payload, "kind");
        const reason = str(event.payload, "reason");
        if (
          teamId === null ||
          amount === null ||
          reason === null ||
          (kind !== "increase" && kind !== "reduce")
        ) {
          return fail("malformed_obligation");
        }
        const obligation = state.obligations[teamId];
        if (obligation === undefined) {
          return fail("unknown_team");
        }
        if (kind === "increase") {
          obligation.increased = addPaise(paise(obligation.increased), paise(amount));
        } else {
          if (!deductPaise(outstandingOf(obligation), paise(amount)).ok) {
            return fail("obligation_overdischarged");
          }
          obligation.reduced = addPaise(paise(obligation.reduced), paise(amount));
        }
        break;
      }

      case "CaseSettled": {
        if (state.status !== "settling") {
          return fail("illegal_replayed_transition");
        }
        // The settle guard is re-proven by REPLAY, not merely by the command:
        // a case with an outstanding rupee cannot fold to settled, ever.
        for (const obligation of Object.values(state.obligations)) {
          if (outstandingOf(obligation) !== 0) {
            return fail("illegal_replayed_transition");
          }
        }
        state.status = "settled";
        break;
      }

      case "CaseClosed": {
        if (state.status !== "settled") {
          return fail("illegal_replayed_transition");
        }
        if (str(event.payload, "publishedDigest") === null) {
          return fail("malformed_case");
        }
        state.status = "closed";
        // The evidence package (M-IP5-3) rides the CLOSED event — immutable by
        // append, reproducible by replay. Older closures (M-IP5-1) carry none;
        // the field is therefore optional and simply absent for them.
        const evidence = obj(event.payload["evidence"]);
        state.closureEvidence = evidence === null ? null : { ...evidence };
        state.closedAtSeq = event.seq;
        state.closures += 1;
        break;
      }

      case "CaseReopened": {
        if (state.status !== "settled" && state.status !== "closed") {
          return fail("illegal_replayed_transition");
        }
        if (str(event.payload, "reason") === null || num(event.payload, "compensates") === null) {
          return fail("malformed_case");
        }
        state.status = "settling";
        state.reopenings += 1;
        // A reopened case is no longer closed: the overlay must not render it as
        // reconciled. The prior closure's evidence survives in the LOG (the
        // CaseClosed event is never rewritten); only the live anchor clears.
        state.closedAtSeq = null;
        state.closureEvidence = null;
        break;
      }

      case "CaseVoided": {
        if (
          state.status !== "opened" &&
          state.status !== "verified" &&
          state.status !== "discrepant"
        ) {
          return fail("illegal_replayed_transition");
        }
        if (str(event.payload, "reason") === null) {
          return fail("malformed_case");
        }
        state.status = "voided";
        break;
      }

      case "CaseRecovered": {
        state.recoveries += 1;
        break;
      }

      default:
        return fail("unknown_event_type");
    }

    state.lastSeq = event.seq;
    state.eventCount += 1;
  }

  if (projection === null) {
    return { ok: false, atSeq: 0, reason: "unknown_case" };
  }
  return { ok: true, projection };
}

/** The settle guard, shared by the command handler and (independently) replay. */
export function caseFullyDischarged(projection: CaseProjection): boolean {
  return Object.values(projection.obligations).every(
    (obligation) => outstandingOf(obligation) === 0,
  );
}

/** Total dues recognised on the case — the case-control account's mirror. */
export function totalObligations(projection: CaseProjection): Paise {
  return Object.values(projection.obligations).reduce<Paise>(
    (sum, obligation) =>
      addPaise(sum, addPaise(paise(obligation.amount), paise(obligation.increased))),
    paise(0),
  );
}
