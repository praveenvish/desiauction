/**
 * Verified fold checkpoints (IP-5_ARCHITECTURE §13a).
 *
 * The journal is the one stream that grows without bound across seasons, and
 * the D-2/D-3 rule says the writer must verify every row it reads to decide.
 * Those two facts collide unless verification cost stops depending on journal
 * length — which is what a checkpoint buys.
 *
 * A checkpoint is the journal reducer's canonical fold state at a seq, plus its
 * digest. It is NEVER truth:
 *
 *   • the GENESIS fold is the definition of the journal (§14);
 *   • a checkpoint is trusted only after a background pass proves it
 *     BYTE-IDENTICAL to the genesis fold at that seq;
 *   • the command path folds from the latest VERIFIED checkpoint plus the tail;
 *   • tamper it, and it stops matching genesis — detected exactly like a
 *     tampered projection row, and re-derived by recovery.
 *
 * Disposable acceleration, with no independent authority. Truncate every
 * checkpoint and the system re-derives them from the stream.
 */

import { canonicalJson } from "@desiauction/core";

import type { SettlementEventEnvelope } from "./events";
import {
  emptyJournal,
  foldJournalEvents,
  isPostingTemplate,
  type AccountBalance,
  type JournalProjection,
  type JournalReplayResult,
  type PostingLeg,
  type PostingRecord,
  type ReceiptRecord,
} from "./journal";

/** Every 1,000 journal events. Bounds command-path verification to ~2 cadences. */
export const CHECKPOINT_CADENCE = 1000;

export interface JournalCheckpoint {
  readonly seq: number;
  readonly bytes: string;
  readonly digest: string;
}

export function checkpointDue(seq: number, cadence: number): boolean {
  return cadence > 0 && seq > 0 && seq % cadence === 0;
}

/** The canonical bytes of a fold — sorted keys, exact integers, no clock. */
export function canonicalJournalBytes(projection: JournalProjection): string {
  return canonicalJson(projection);
}

export function checkpointOf(
  projection: JournalProjection,
  digest: (bytes: string) => string,
): JournalCheckpoint {
  const bytes = canonicalJournalBytes(projection);
  return { seq: projection.lastSeq, bytes, digest: digest(bytes) };
}

/**
 * Derive the canonical checkpoint chain from the genesis fold. This is the
 * single definition used by creation, verification AND recovery — so "what the
 * checkpoint should be" is never a second opinion.
 */
export type CheckpointChainResult =
  | { ok: true; checkpoints: readonly JournalCheckpoint[]; projection: JournalProjection }
  | { ok: false; atSeq: number; reason: string };

export function deriveCheckpointChain(
  events: readonly SettlementEventEnvelope[],
  cadence: number,
  digest: (bytes: string) => string,
): CheckpointChainResult {
  const projection = emptyJournal();
  const checkpoints: JournalCheckpoint[] = [];
  for (const event of events) {
    const folded = foldJournalEvents(projection, [event]);
    if (!folded.ok) {
      return { ok: false, atSeq: folded.atSeq, reason: folded.reason };
    }
    if (checkpointDue(event.seq, cadence)) {
      checkpoints.push(checkpointOf(projection, digest));
    }
  }
  return { ok: true, checkpoints, projection };
}

export type CheckpointVerification =
  { ok: true } | { ok: false; reason: "digest_mismatch" | "bytes_mismatch" | "missing_checkpoint" };

/**
 * Prove a stored checkpoint against the genesis-derived chain: same seq, same
 * digest, same BYTES. Anything else halts the journal.
 */
export function verifyCheckpoint(
  stored: JournalCheckpoint,
  derived: readonly JournalCheckpoint[],
): CheckpointVerification {
  const match = derived.find((checkpoint) => checkpoint.seq === stored.seq);
  if (match === undefined) {
    return { ok: false, reason: "missing_checkpoint" };
  }
  if (match.digest !== stored.digest) {
    return { ok: false, reason: "digest_mismatch" };
  }
  if (match.bytes !== stored.bytes) {
    return { ok: false, reason: "bytes_mismatch" };
  }
  return { ok: true };
}

export type CheckpointedFoldResult =
  JournalReplayResult | { ok: false; atSeq: number; reason: "checkpoint_corrupt" };

/**
 * The command path's fold: rehydrate a VERIFIED checkpoint and fold the tail.
 * Fails closed if the checkpoint's bytes do not re-serialize to themselves or
 * its digest does not match — a corrupted checkpoint can never become a balance.
 */
export function foldFromCheckpoint(
  checkpoint: JournalCheckpoint,
  tail: readonly SettlementEventEnvelope[],
  digest: (bytes: string) => string,
): CheckpointedFoldResult {
  if (digest(checkpoint.bytes) !== checkpoint.digest) {
    return { ok: false, atSeq: checkpoint.seq, reason: "checkpoint_corrupt" };
  }
  const projection = parseJournalProjection(checkpoint.bytes);
  if (projection === null || projection.lastSeq !== checkpoint.seq) {
    return { ok: false, atSeq: checkpoint.seq, reason: "checkpoint_corrupt" };
  }
  // Round-trip discipline: the rehydrated fold must canonicalize back to the
  // exact bytes that were verified against genesis — otherwise it is not that fold.
  if (canonicalJournalBytes(projection) !== checkpoint.bytes) {
    return { ok: false, atSeq: checkpoint.seq, reason: "checkpoint_corrupt" };
  }
  return foldJournalEvents(projection, tail);
}

// --- Rehydration (structural, fail-closed) ------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Parse checkpoint bytes back into a fold. Every field is validated: a
 * checkpoint that does not describe a well-formed journal projection is not a
 * journal projection, and the caller halts rather than trusting a type lie.
 */
export function parseJournalProjection(bytes: string): JournalProjection | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const accountsRaw = parsed["accounts"];
  const postingsRaw = parsed["postings"];
  const sourcesRaw = parsed["sources"];
  const receiptsRaw = parsed["receipts"];
  if (
    !isRecord(accountsRaw) ||
    !isRecord(postingsRaw) ||
    !isRecord(sourcesRaw) ||
    !isRecord(receiptsRaw) ||
    !isMoney(parsed["receiptCount"]) ||
    !isMoney(parsed["creditNoteCount"]) ||
    !isMoney(parsed["recoveries"]) ||
    !isMoney(parsed["lastSeq"]) ||
    !isMoney(parsed["eventCount"])
  ) {
    return null;
  }

  const accounts: Record<string, AccountBalance> = {};
  for (const [account, raw] of Object.entries(accountsRaw)) {
    if (!isRecord(raw) || !isMoney(raw["debits"]) || !isMoney(raw["credits"])) {
      return null;
    }
    accounts[account] = { debits: raw["debits"], credits: raw["credits"] };
  }

  const postings: Record<string, PostingRecord> = {};
  for (const [postingId, raw] of Object.entries(postingsRaw)) {
    if (
      !isRecord(raw) ||
      typeof raw["postingId"] !== "string" ||
      !isMoney(raw["eventSeq"]) ||
      !isMoney(raw["atMs"]) ||
      typeof raw["template"] !== "string" ||
      !isPostingTemplate(raw["template"]) ||
      typeof raw["sourceStream"] !== "string" ||
      !isMoney(raw["sourceSeq"]) ||
      !Array.isArray(raw["legs"])
    ) {
      return null;
    }
    const caseId = raw["caseId"];
    const teamId = raw["teamId"];
    const memo = raw["memo"];
    if (
      (caseId !== null && typeof caseId !== "string") ||
      (teamId !== null && typeof teamId !== "string") ||
      (memo !== null && typeof memo !== "string")
    ) {
      return null;
    }
    const legs: PostingLeg[] = [];
    for (const legRaw of raw["legs"]) {
      if (
        !isRecord(legRaw) ||
        typeof legRaw["account"] !== "string" ||
        !isMoney(legRaw["amount"]) ||
        (legRaw["direction"] !== "debit" && legRaw["direction"] !== "credit")
      ) {
        return null;
      }
      legs.push({
        account: legRaw["account"],
        direction: legRaw["direction"],
        amount: legRaw["amount"],
      });
    }
    postings[postingId] = {
      postingId: raw["postingId"],
      eventSeq: raw["eventSeq"],
      atMs: raw["atMs"],
      template: raw["template"],
      caseId,
      teamId,
      sourceStream: raw["sourceStream"],
      sourceSeq: raw["sourceSeq"],
      legs,
      memo,
    };
  }

  const sources: Record<string, string> = {};
  for (const [key, value] of Object.entries(sourcesRaw)) {
    if (typeof value !== "string") {
      return null;
    }
    sources[key] = value;
  }

  const receipts: Record<string, ReceiptRecord> = {};
  for (const [receiptId, raw] of Object.entries(receiptsRaw)) {
    if (
      !isRecord(raw) ||
      typeof raw["receiptId"] !== "string" ||
      !isMoney(raw["receiptNo"]) ||
      typeof raw["caseId"] !== "string" ||
      typeof raw["teamId"] !== "string" ||
      !isMoney(raw["amount"]) ||
      !isMoney(raw["credited"])
    ) {
      return null;
    }
    receipts[receiptId] = {
      receiptId: raw["receiptId"],
      receiptNo: raw["receiptNo"],
      caseId: raw["caseId"],
      teamId: raw["teamId"],
      amount: raw["amount"],
      credited: raw["credited"],
    };
  }

  return {
    accounts,
    postings,
    sources,
    receipts,
    receiptCount: parsed["receiptCount"],
    creditNoteCount: parsed["creditNoteCount"],
    recoveries: parsed["recoveries"],
    lastSeq: parsed["lastSeq"],
    eventCount: parsed["eventCount"],
  };
}
