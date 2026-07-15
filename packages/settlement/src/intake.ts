/**
 * Intake (IP-5_ARCHITECTURE §11/§14): how a frozen auction night becomes a
 * settlement case's opening truth.
 *
 * Settlement NEVER re-implements auction replay — it folds the immutable
 * `auction_events` log with the FROZEN core reducer and pins what it saw. The
 * pin (event count + digest over the canonical event bytes) is what makes
 * verification reproducible at any later date: re-fold, re-digest, compare.
 *
 * Obligations are a pure function of (fold, basis). The basis is the
 * organizer's DECLARED policy, pinned at CaseOpened — the platform never
 * invents a debt.
 */

import {
  addPaise,
  canonicalJson,
  paise,
  replayAuction,
  type AuctionEventEnvelope,
  type AuctionProjection,
  type Paise,
} from "@desiauction/core";

import type { ObligationBasis } from "./case";
import type { DigestFn } from "./ports";

/** What the frozen source looked like when settlement chose to trust it. */
export interface IntakePin {
  readonly sourceEventCount: number;
  readonly sourceDigest: string;
}

export interface SourceFold {
  readonly pin: IntakePin;
  readonly fold: AuctionProjection;
  readonly foldDigest: string;
  readonly teamCount: number;
  readonly totalCommitted: number;
}

export type SourceFoldResult =
  { ok: true; source: SourceFold } | { ok: false; reason: string; atSeq: number };

/**
 * The canonical bytes of the source log — the digest input. Only the fields the
 * frozen envelope defines participate, so the digest is stable against storage
 * details (row ids, created_at) and identical on any machine.
 */
export function canonicalSourceBytes(events: readonly AuctionEventEnvelope[]): string {
  return canonicalJson(
    events.map((event) => ({
      seq: event.seq,
      type: event.type,
      atMs: event.atMs,
      actor: event.actor,
      correlationId: event.correlationId,
      payload: event.payload,
    })),
  );
}

/** Fold the frozen auction log and pin it. A log that will not fold is not intake. */
export function foldSource(
  events: readonly AuctionEventEnvelope[],
  digest: DigestFn,
): SourceFoldResult {
  const replay = replayAuction(events);
  if (!replay.ok) {
    return { ok: false, reason: replay.reason, atSeq: replay.atSeq };
  }
  const committed = committedByTeam(replay.projection);
  const totalCommitted = Object.values(committed).reduce<Paise>(
    (sum, amount) => addPaise(sum, amount),
    paise(0),
  );
  return {
    ok: true,
    source: {
      pin: {
        sourceEventCount: events.length,
        sourceDigest: digest(canonicalSourceBytes(events)),
      },
      fold: replay.projection,
      foldDigest: digest(canonicalJson(replay.projection)),
      teamCount: Object.keys(committed).length,
      totalCommitted,
    },
  };
}

export type VerifyReason = "fold_failed" | "digest_mismatch" | "count_mismatch";

export type VerifyOutcome =
  { ok: true; source: SourceFold } | { ok: false; reasonCode: VerifyReason; detail: string };

/**
 * Verify the source against the case's pin. Any disagreement — an unfoldable
 * log, a different digest, a different event count — is a DISCREPANCY, and a
 * discrepancy freezes money until a human with override authority looks at it.
 *
 * The lawful cause of a count/digest change on a completed auction is an
 * `AuctionRecovered` append (the one command legal on any auction), which grows
 * the log without changing a rupee. That is precisely why the exit from
 * discrepancy re-pins rather than re-writes: the case's own stream keeps the old
 * pin forever, and the new one is adopted under an audited override (§11).
 */
export function verifySource(
  events: readonly AuctionEventEnvelope[],
  pin: IntakePin,
  digest: DigestFn,
): VerifyOutcome {
  const folded = foldSource(events, digest);
  if (!folded.ok) {
    return {
      ok: false,
      reasonCode: "fold_failed",
      detail: `${folded.reason} at seq ${String(folded.atSeq)}`,
    };
  }
  if (folded.source.pin.sourceEventCount !== pin.sourceEventCount) {
    return {
      ok: false,
      reasonCode: "count_mismatch",
      detail: `pinned=${String(pin.sourceEventCount)} source=${String(folded.source.pin.sourceEventCount)}`,
    };
  }
  if (folded.source.pin.sourceDigest !== pin.sourceDigest) {
    return {
      ok: false,
      reasonCode: "digest_mismatch",
      detail: `pinned=${pin.sourceDigest} source=${folded.source.pin.sourceDigest}`,
    };
  }
  return { ok: true, source: folded.source };
}

/**
 * Committed money per TEAM (doc 41: purses are per team, and a team may hold
 * several paddles across claims — released paddles included, because the money
 * followed the team, not the paddle). Derived from the frozen fold; settlement
 * never adds a second way to compute what a team spent.
 */
export function committedByTeam(fold: AuctionProjection): Record<string, Paise> {
  const byTeam: Record<string, Paise> = {};
  for (const paddle of Object.values(fold.paddles)) {
    const current = byTeam[paddle.teamId] ?? paise(0);
    byTeam[paddle.teamId] = addPaise(current, paise(paddle.committed));
  }
  return byTeam;
}

export interface ObligationItem {
  readonly teamId: string;
  readonly amount: number;
}

export type ObligationsResult =
  | { ok: true; items: readonly ObligationItem[] }
  | { ok: false; reason: "unknown_team" | "invalid_amount" };

/**
 * The obligation computation — pure, deterministic, and re-runnable forever:
 * folding the same frozen log under the same basis reproduces the same items,
 * to the paisa, in the same order (§17.9).
 */
export function computeObligations(
  fold: AuctionProjection,
  basis: ObligationBasis,
  fixed: Readonly<Record<string, number>>,
): ObligationsResult {
  if (basis === "none") {
    return { ok: true, items: [] };
  }
  const committed = committedByTeam(fold);
  if (basis === "committed") {
    const items = Object.entries(committed)
      // A team that bought nothing owes nothing — no zero-rupee debts exist.
      .filter(([, amount]) => amount > 0)
      .map(([teamId, amount]) => ({ teamId, amount: amount }));
    return { ok: true, items: sortItems(items) };
  }
  // basis === "fixed": the organizer's declared per-team amounts, pinned at open.
  const items: ObligationItem[] = [];
  for (const [teamId, amount] of Object.entries(fixed)) {
    if (committed[teamId] === undefined) {
      return { ok: false, reason: "unknown_team" };
    }
    if (!Number.isSafeInteger(amount) || amount < 0) {
      return { ok: false, reason: "invalid_amount" };
    }
    if (amount > 0) {
      items.push({ teamId, amount });
    }
  }
  return { ok: true, items: sortItems(items) };
}

function sortItems(items: readonly ObligationItem[]): readonly ObligationItem[] {
  return [...items].sort((a, b) => (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0));
}
