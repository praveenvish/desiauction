import { describe, expect, it } from "vitest";

import {
  CHECKPOINT_CADENCE,
  canonicalJournalBytes,
  checkpointDue,
  deriveCheckpointChain,
  foldFromCheckpoint,
  parseJournalProjection,
  verifyCheckpoint,
} from "./checkpoint";
import type { SettlementEventEnvelope } from "./events";
import {
  buildCollectionPosting,
  buildObligationPosting,
  replayJournal,
  trialBalance,
  walletOf,
  duesAccount,
} from "./journal";
import { envelope, testDigest } from "./testing";

const ORG = "01ORG00000000000000000000A";
const CADENCE = 5;

/** A journal long enough to cross several checkpoints. */
function journalEvents(cases: number): SettlementEventEnvelope[] {
  const events: SettlementEventEnvelope[] = [];
  for (let index = 0; index < cases; index += 1) {
    const caseId = `01CASE${String(index).padStart(20, "0")}`;
    const teamId = `01TEAM${String(index).padStart(20, "0")}`;
    const amount = 1_000 + index;
    const obligation = buildObligationPosting(caseId, [{ teamId, amount }]);
    events.push(
      envelope("journal", ORG, events.length + 1, "JournalPosted", {
        postingId: `01O${String(index).padStart(23, "0")}`,
        template: obligation.template,
        legs: obligation.legs.map((leg) => ({ ...leg })),
        source: { stream: `case:${caseId}`, seq: 3 },
        memo: null,
      }),
    );
    const collection = buildCollectionPosting(caseId, teamId, "manual:cash", amount, amount);
    events.push(
      envelope("journal", ORG, events.length + 1, "JournalPosted", {
        postingId: `01C${String(index).padStart(23, "0")}`,
        template: collection.template,
        legs: collection.legs.map((leg) => ({ ...leg })),
        source: { stream: `payment:01PAY${String(index).padStart(18, "0")}`, seq: 3 },
        memo: null,
      }),
    );
  }
  return events;
}

const EVENTS = journalEvents(12); // 24 journal events → checkpoints at 5,10,15,20

describe("Checkpoints — acceleration that can never become truth", () => {
  it("derives the chain from the GENESIS fold at the cadence", () => {
    const chain = deriveCheckpointChain(EVENTS, CADENCE, testDigest);
    expect(chain.ok).toBe(true);
    if (!chain.ok) {
      return;
    }
    expect(chain.checkpoints.map((checkpoint) => checkpoint.seq)).toEqual([5, 10, 15, 20]);
    expect(checkpointDue(1_000, CHECKPOINT_CADENCE)).toBe(true);
    expect(checkpointDue(999, CHECKPOINT_CADENCE)).toBe(false);
  });

  it("checkpoint equivalence: checkpoint + tail is BYTE-IDENTICAL to the genesis fold", () => {
    const chain = deriveCheckpointChain(EVENTS, CADENCE, testDigest);
    if (!chain.ok) {
      throw new Error("chain");
    }
    const genesis = replayJournal(EVENTS);
    if (!genesis.ok) {
      throw new Error("genesis");
    }
    const genesisBytes = canonicalJournalBytes(genesis.projection);

    for (const checkpoint of chain.checkpoints) {
      const tail = EVENTS.filter((event) => event.seq > checkpoint.seq);
      const folded = foldFromCheckpoint(checkpoint, tail, testDigest);
      expect(folded.ok).toBe(true);
      if (!folded.ok) {
        continue;
      }
      // The whole claim of §13a, in one assertion.
      expect(canonicalJournalBytes(folded.projection)).toBe(genesisBytes);
      expect(trialBalance(folded.projection).balanced).toBe(true);
      expect(
        walletOf(
          folded.projection,
          duesAccount("01CASE00000000000000000000", "01TEAM00000000000000000000"),
        )?.balance,
      ).toBe(0);
    }
  });

  it("verifies a stored checkpoint against the genesis chain", () => {
    const chain = deriveCheckpointChain(EVENTS, CADENCE, testDigest);
    if (!chain.ok) {
      throw new Error("chain");
    }
    const stored = chain.checkpoints[1];
    if (stored === undefined) {
      throw new Error("fixture");
    }
    expect(verifyCheckpoint(stored, chain.checkpoints)).toEqual({ ok: true });

    // Tampered BYTES with the digest recomputed — the attacker's best move, and
    // it still fails: the checkpoint is compared against what GENESIS says it
    // must be, so a self-consistent lie is still a lie.
    const forgedBytes = stored.bytes.replace(/"debits":(\d+)/, '"debits":999999');
    const forged = { seq: stored.seq, bytes: forgedBytes, digest: testDigest(forgedBytes) };
    expect(verifyCheckpoint(forged, chain.checkpoints)).toEqual({
      ok: false,
      reason: "digest_mismatch",
    });

    // Belt and braces: even if a digest ever collided, the BYTES are compared too.
    expect(verifyCheckpoint({ ...stored, bytes: forgedBytes }, chain.checkpoints)).toEqual({
      ok: false,
      reason: "bytes_mismatch",
    });

    // Tampered DIGEST alone.
    const badDigest = { ...stored, digest: "0000000000000000" };
    expect(verifyCheckpoint(badDigest, chain.checkpoints)).toEqual({
      ok: false,
      reason: "digest_mismatch",
    });

    // A checkpoint at a seq the genesis chain never produced.
    expect(verifyCheckpoint({ ...stored, seq: 7 }, chain.checkpoints)).toEqual({
      ok: false,
      reason: "missing_checkpoint",
    });
  });

  it("refuses to fold from a corrupted checkpoint — a lie never becomes a balance", () => {
    const chain = deriveCheckpointChain(EVENTS, CADENCE, testDigest);
    if (!chain.ok) {
      throw new Error("chain");
    }
    const stored = chain.checkpoints[0];
    if (stored === undefined) {
      throw new Error("fixture");
    }
    const tail = EVENTS.filter((event) => event.seq > stored.seq);

    // Bytes edited, digest left alone.
    const tampered = { ...stored, bytes: stored.bytes.replace(/"credits":(\d+)/, '"credits":1') };
    expect(foldFromCheckpoint(tampered, tail, testDigest)).toEqual({
      ok: false,
      atSeq: stored.seq,
      reason: "checkpoint_corrupt",
    });

    // Structurally invalid bytes.
    expect(
      foldFromCheckpoint({ ...stored, bytes: "{", digest: testDigest("{") }, tail, testDigest),
    ).toEqual({
      ok: false,
      atSeq: stored.seq,
      reason: "checkpoint_corrupt",
    });

    // A checkpoint whose declared seq disagrees with the fold it carries.
    expect(foldFromCheckpoint({ ...stored, seq: stored.seq + 1 }, tail, testDigest)).toEqual({
      ok: false,
      atSeq: stored.seq + 1,
      reason: "checkpoint_corrupt",
    });
  });

  it("rehydrates a fold that re-serializes to the exact verified bytes", () => {
    const chain = deriveCheckpointChain(EVENTS, CADENCE, testDigest);
    if (!chain.ok) {
      throw new Error("chain");
    }
    for (const checkpoint of chain.checkpoints) {
      const parsed = parseJournalProjection(checkpoint.bytes);
      expect(parsed).not.toBeNull();
      if (parsed !== null) {
        expect(canonicalJournalBytes(parsed)).toBe(checkpoint.bytes);
        expect(parsed.lastSeq).toBe(checkpoint.seq);
      }
    }
    expect(parseJournalProjection("not json")).toBeNull();
    expect(parseJournalProjection('{"accounts":{}}')).toBeNull();
    // A type lie in the fold (a string where money belongs) is not a fold.
    expect(
      parseJournalProjection(
        '{"accounts":{"funds:manual:cash":{"credits":0,"debits":"lots"}},"creditNoteCount":0,"eventCount":0,"lastSeq":0,"postings":{},"receiptCount":0,"receipts":{},"recoveries":0,"sources":{}}',
      ),
    ).toBeNull();
  });

  it("fails the chain closed when the journal itself will not fold", () => {
    const broken = [...EVENTS, envelope("journal", ORG, 25, "MoneyAppeared", {})];
    expect(deriveCheckpointChain(broken, CADENCE, testDigest)).toEqual({
      ok: false,
      atSeq: 25,
      reason: "unknown_event_type",
    });
  });
});
