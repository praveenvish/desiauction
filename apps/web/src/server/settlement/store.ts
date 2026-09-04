import { createHash } from "node:crypto";

import {
  auctionEvents,
  auctions,
  auditLog,
  journalCheckpoints,
  journalLegs,
  journalPostings,
  newId,
  payments,
  settlementCases,
  settlementEvents,
  settlementObligations,
  type Db,
} from "@desiauction/db";
import type {
  AuctionSourcePort,
  AuctionSourceRef,
  CaseRow,
  CheckpointRow,
  DigestFn,
  ObligationRow,
  PaymentRow,
  PostingRow,
  SettlementEventEnvelope,
  SettlementStore,
  SettlementTx,
  StreamType,
} from "@desiauction/settlement";
import { and, asc, eq, gt, isNotNull, ne, sql } from "drizzle-orm";
import type { AuctionEventEnvelope } from "@desiauction/core";

// The Postgres adapter for the settlement ports (IP-5_ARCHITECTURE §5/§6). The
// domain declares the shapes; this file is the only place that knows they are
// rows. Nothing here decides anything: it stores what the writer commits and
// returns what the writer folds.

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The digest the domain hashes its canonical bytes with (ports.DigestFn). */
export const sha256: DigestFn = (bytes) => createHash("sha256").update(bytes).digest("hex");

function envelopeOf(row: {
  streamType: string;
  streamId: string;
  seq: number;
  type: string;
  atMs: number;
  actor: string;
  correlationId: string;
  commandId: string;
  payload: unknown;
}): SettlementEventEnvelope {
  return {
    streamType: row.streamType as StreamType,
    streamId: row.streamId,
    seq: row.seq,
    type: row.type,
    atMs: row.atMs,
    actor: row.actor,
    correlationId: row.correlationId,
    commandId: row.commandId,
    payload: row.payload as Record<string, unknown>,
  };
}

const EVENT_COLUMNS = {
  streamType: settlementEvents.streamType,
  streamId: settlementEvents.streamId,
  seq: settlementEvents.seq,
  type: settlementEvents.type,
  atMs: settlementEvents.atMs,
  actor: settlementEvents.actor,
  correlationId: settlementEvents.correlationId,
  commandId: settlementEvents.commandId,
  payload: settlementEvents.payload,
};

function transaction(tx: Tx): SettlementTx {
  return {
    /**
     * Append the next event in the stream's total order. The unique
     * (stream_type, stream_id, seq) index turns a concurrent writer into a LOUD
     * failure rather than a silent interleave — the single-writer invariant is a
     * fact of the schema, not a promise of the code.
     */
    async appendEvent(input) {
      /**
       * SERIALIZE THE STREAM, RATHER THAN LETTING IT COLLIDE AND SAY SO LOUDLY.
       *
       * The comment above is accurate: the unique index does turn a concurrent
       * writer into a loud failure. What it does not say is who hears it. The
       * engine can rely on that index alone because a process-level lease means
       * one writer exists; settlement has no such lease — it runs in the web
       * tier, where two operators on one case, or two instances behind a load
       * balancer, are ordinary. Both would read the same `max(seq)`, both would
       * insert `seq + 1`, and the loser got a raw Postgres 23505 in the
       * interface while doing nothing wrong (audit PA-1 §7).
       *
       * A transaction-scoped advisory lock on the stream makes the second
       * writer WAIT instead of collide: it takes the lock, reads a `max(seq)`
       * that already includes the first write, and appends after it. Both
       * commands succeed, in order, which is what the operator expected.
       *
       * Scoped to one stream, so unrelated cases never queue behind each other,
       * and released on commit like the registration-approval lock this follows.
       * The unique index stays as the backstop — a lock is a convention between
       * willing participants, and the index is the thing that is simply true.
       */
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('settlement-stream'), hashtext(${`${input.streamType}:${input.streamId}`}))`,
      );
      const [row] = await tx
        .select({ max: sql<number>`coalesce(max(${settlementEvents.seq}), 0)::int` })
        .from(settlementEvents)
        .where(
          and(
            eq(settlementEvents.streamType, input.streamType),
            eq(settlementEvents.streamId, input.streamId),
          ),
        );
      const seq = (row?.max ?? 0) + 1;
      await tx.insert(settlementEvents).values({
        id: newId(),
        orgId: input.orgId,
        streamType: input.streamType,
        streamId: input.streamId,
        seq,
        type: input.type,
        atMs: input.atMs,
        actor: input.actor,
        correlationId: input.correlationId,
        commandId: input.commandId,
        payload: input.payload,
      });
      return seq;
    },

    /** In the same transaction as the event: audit failure fails the action. */
    async writeAudit(input) {
      await tx.insert(auditLog).values({
        id: newId(),
        actor: input.actor,
        action: input.action,
        scopeType: "org",
        scopeId: input.orgId,
        subject: input.subject,
        meta: {
          source: input.source,
          correlationId: input.correlationId,
          eventSeq: String(input.eventSeq),
          ...(input.reason !== undefined && input.reason !== "" ? { reason: input.reason } : {}),
        },
      });
    },

    async putCase(row) {
      await tx
        .insert(settlementCases)
        .values({
          id: row.caseId,
          orgId: row.orgId,
          auctionId: row.auctionId,
          competitionId: row.competitionId,
          status: row.status,
          basis: row.basis,
          sourceEventCount: row.sourceEventCount,
          sourceDigest: row.sourceDigest,
          foldDigest: row.foldDigest,
          closureEvidence: row.closureEvidence,
          closedAtSeq: row.closedAtSeq,
          createdBy: row.createdBy,
        })
        .onConflictDoUpdate({
          target: settlementCases.id,
          set: {
            status: row.status,
            sourceEventCount: row.sourceEventCount,
            sourceDigest: row.sourceDigest,
            foldDigest: row.foldDigest,
            closureEvidence: row.closureEvidence,
            closedAtSeq: row.closedAtSeq,
          },
        });
    },

    async putObligations(caseId, rows) {
      await tx.delete(settlementObligations).where(eq(settlementObligations.caseId, caseId));
      if (rows.length === 0) {
        return;
      }
      await tx.insert(settlementObligations).values(
        rows.map((row) => ({
          id: newId(),
          orgId: row.orgId,
          caseId: row.caseId,
          teamId: row.teamId,
          amount: row.amount,
          increased: row.increased,
          reduced: row.reduced,
          discharged: row.discharged,
          waived: row.waived,
          reinstated: row.reinstated,
        })),
      );
    },

    async putPosting(row) {
      await tx.insert(journalPostings).values({
        id: row.postingId,
        orgId: row.orgId,
        eventSeq: row.eventSeq,
        template: row.template,
        caseId: row.caseId,
        teamId: row.teamId,
        sourceStream: row.sourceStream,
        sourceSeq: row.sourceSeq,
        memo: row.memo,
        atMs: row.atMs,
      });
      await tx.insert(journalLegs).values(
        row.legs.map((leg) => ({
          id: newId(),
          orgId: row.orgId,
          postingId: row.postingId,
          legIndex: leg.legIndex,
          account: leg.account,
          direction: leg.direction,
          amount: leg.amount,
        })),
      );
    },

    async deletePostings(orgId) {
      await tx.delete(journalLegs).where(eq(journalLegs.orgId, orgId));
      await tx.delete(journalPostings).where(eq(journalPostings.orgId, orgId));
    },

    async putCheckpoint(row) {
      await tx
        .insert(journalCheckpoints)
        .values({
          id: newId(),
          orgId: row.orgId,
          seq: row.seq,
          digest: row.digest,
          bytes: row.bytes,
          verifiedAt: row.verifiedAtMs === null ? null : new Date(row.verifiedAtMs),
        })
        .onConflictDoUpdate({
          target: [journalCheckpoints.orgId, journalCheckpoints.seq],
          set: { digest: row.digest, bytes: row.bytes, verifiedAt: null },
        });
    },

    async markCheckpointVerified(orgId, seq, atMs) {
      await tx
        .update(journalCheckpoints)
        .set({ verifiedAt: new Date(atMs) })
        .where(and(eq(journalCheckpoints.orgId, orgId), eq(journalCheckpoints.seq, seq)));
    },

    async clearCheckpoints(orgId) {
      await tx.delete(journalCheckpoints).where(eq(journalCheckpoints.orgId, orgId));
    },

    async putPayment(row) {
      // The row id IS the stream id (paymentId), so the projection is byte-stable
      // across recovery — unlike legs/obligations, no fresh id is ever minted.
      await tx
        .insert(payments)
        .values({
          id: row.paymentId,
          orgId: row.orgId,
          caseId: row.caseId,
          teamId: row.teamId,
          method: row.method as (typeof payments.method.enumValues)[number],
          status: row.status as (typeof payments.status.enumValues)[number],
          amount: row.amount,
          captured: row.captured,
          refundedTotal: row.refundedTotal,
          attested: row.attested,
          attestedBy: row.attestedBy,
          providerRef: row.providerRef,
        })
        .onConflictDoUpdate({
          target: payments.id,
          set: {
            status: row.status as (typeof payments.status.enumValues)[number],
            captured: row.captured,
            refundedTotal: row.refundedTotal,
            attested: row.attested,
            attestedBy: row.attestedBy,
            providerRef: row.providerRef,
          },
        });
    },

    async deletePayments(orgId) {
      await tx.delete(payments).where(eq(payments.orgId, orgId));
    },
  };
}

async function postingsWhere(
  db: Db,
  orgId: string,
  fromEventSeq: number,
): Promise<readonly PostingRow[]> {
  const postings = await db
    .select()
    .from(journalPostings)
    .where(and(eq(journalPostings.orgId, orgId), gt(journalPostings.eventSeq, fromEventSeq)))
    .orderBy(asc(journalPostings.eventSeq));
  if (postings.length === 0) {
    return [];
  }
  const legs = await db.select().from(journalLegs).where(eq(journalLegs.orgId, orgId));
  const byPosting = new Map<string, typeof legs>();
  for (const leg of legs) {
    const bucket = byPosting.get(leg.postingId) ?? [];
    bucket.push(leg);
    byPosting.set(leg.postingId, bucket);
  }
  return postings.map((posting) => ({
    postingId: posting.id,
    orgId: posting.orgId,
    eventSeq: posting.eventSeq,
    template: posting.template,
    caseId: posting.caseId,
    teamId: posting.teamId,
    sourceStream: posting.sourceStream,
    sourceSeq: posting.sourceSeq,
    memo: posting.memo,
    atMs: posting.atMs,
    legs: (byPosting.get(posting.id) ?? [])
      .map((leg) => ({
        legIndex: leg.legIndex,
        account: leg.account,
        direction: leg.direction,
        amount: leg.amount,
      }))
      .sort((a, b) => a.legIndex - b.legIndex),
  }));
}

function checkpointRow(row: {
  orgId: string;
  seq: number;
  digest: string;
  bytes: string;
  verifiedAt: Date | null;
}): CheckpointRow {
  return {
    orgId: row.orgId,
    seq: row.seq,
    digest: row.digest,
    bytes: row.bytes,
    verifiedAtMs: row.verifiedAt === null ? null : row.verifiedAt.getTime(),
  };
}

export interface SettlementStoreWithRows extends SettlementStore {
  /** Postings after a seq — the command path's bounded row verification (§13a). */
  loadPostingsFrom(orgId: string, fromEventSeq: number): Promise<readonly PostingRow[]>;
}

export function createSettlementStore(db: Db): SettlementStoreWithRows {
  return {
    async transact(fn) {
      return db.transaction(async (tx) => fn(transaction(tx)));
    },

    async loadStream(streamType, streamId) {
      const rows = await db
        .select(EVENT_COLUMNS)
        .from(settlementEvents)
        .where(
          and(eq(settlementEvents.streamType, streamType), eq(settlementEvents.streamId, streamId)),
        )
        .orderBy(asc(settlementEvents.seq));
      return rows.map(envelopeOf);
    },

    async loadStreamFrom(streamType, streamId, fromSeq) {
      const rows = await db
        .select(EVENT_COLUMNS)
        .from(settlementEvents)
        .where(
          and(
            eq(settlementEvents.streamType, streamType),
            eq(settlementEvents.streamId, streamId),
            gt(settlementEvents.seq, fromSeq),
          ),
        )
        .orderBy(asc(settlementEvents.seq));
      return rows.map(envelopeOf);
    },

    async findByCommandId(streamType, streamId, commandId) {
      const [row] = await db
        .select(EVENT_COLUMNS)
        .from(settlementEvents)
        .where(
          and(
            eq(settlementEvents.streamType, streamType),
            eq(settlementEvents.streamId, streamId),
            eq(settlementEvents.commandId, commandId),
          ),
        )
        .limit(1);
      return row === undefined ? null : envelopeOf(row);
    },

    async loadCase(caseId) {
      const [row] = await db
        .select()
        .from(settlementCases)
        .where(eq(settlementCases.id, caseId))
        .limit(1);
      return row === undefined ? null : caseRowOf(row);
    },

    async loadCaseByAuction(auctionId) {
      // The live case for the auction — a voided one never blocks a fresh attempt.
      const [row] = await db
        .select()
        .from(settlementCases)
        .where(and(eq(settlementCases.auctionId, auctionId), ne(settlementCases.status, "voided")))
        .limit(1);
      return row === undefined ? null : caseRowOf(row);
    },

    async loadObligations(caseId) {
      const rows = await db
        .select()
        .from(settlementObligations)
        .where(eq(settlementObligations.caseId, caseId));
      return rows.map((row) => ({
        caseId: row.caseId,
        orgId: row.orgId,
        teamId: row.teamId,
        amount: row.amount,
        increased: row.increased,
        reduced: row.reduced,
        discharged: row.discharged,
        waived: row.waived,
        reinstated: row.reinstated,
      }));
    },

    async loadPostings(orgId) {
      return postingsWhere(db, orgId, 0);
    },

    async loadPostingsFrom(orgId, fromEventSeq) {
      return postingsWhere(db, orgId, fromEventSeq);
    },

    async loadCheckpoints(orgId) {
      const rows = await db
        .select()
        .from(journalCheckpoints)
        .where(eq(journalCheckpoints.orgId, orgId))
        .orderBy(asc(journalCheckpoints.seq));
      return rows.map(checkpointRow);
    },

    async latestVerifiedCheckpoint(orgId) {
      const rows = await db
        .select()
        .from(journalCheckpoints)
        .where(and(eq(journalCheckpoints.orgId, orgId), isNotNull(journalCheckpoints.verifiedAt)))
        .orderBy(asc(journalCheckpoints.seq));
      const last = rows[rows.length - 1];
      return last === undefined ? null : checkpointRow(last);
    },

    async loadPayment(paymentId) {
      const [row] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
      return row === undefined ? null : paymentRowOf(row);
    },

    async loadPaymentIds(orgId) {
      const rows = await db
        .selectDistinct({ streamId: settlementEvents.streamId })
        .from(settlementEvents)
        .where(and(eq(settlementEvents.orgId, orgId), eq(settlementEvents.streamType, "payment")))
        .orderBy(asc(settlementEvents.streamId));
      return rows.map((row) => row.streamId);
    },
  };
}

function paymentRowOf(row: {
  id: string;
  orgId: string;
  caseId: string;
  teamId: string;
  method: string;
  status: string;
  amount: number;
  captured: number;
  refundedTotal: number;
  attested: boolean;
  attestedBy: string | null;
  providerRef: string | null;
}): PaymentRow {
  return {
    paymentId: row.id,
    orgId: row.orgId,
    caseId: row.caseId,
    teamId: row.teamId,
    method: row.method,
    status: row.status,
    amount: row.amount,
    captured: row.captured,
    refundedTotal: row.refundedTotal,
    attested: row.attested,
    attestedBy: row.attestedBy,
    providerRef: row.providerRef,
  };
}

function caseRowOf(row: {
  id: string;
  orgId: string;
  auctionId: string;
  competitionId: string;
  status: string;
  basis: string;
  sourceEventCount: number;
  sourceDigest: string;
  foldDigest: string | null;
  closureEvidence: unknown;
  closedAtSeq: number | null;
  createdBy: string;
}): CaseRow & { createdBy: string } {
  return {
    caseId: row.id,
    orgId: row.orgId,
    auctionId: row.auctionId,
    competitionId: row.competitionId,
    status: row.status as CaseRow["status"],
    basis: row.basis as CaseRow["basis"],
    sourceEventCount: row.sourceEventCount,
    sourceDigest: row.sourceDigest,
    foldDigest: row.foldDigest,
    closureEvidence:
      row.closureEvidence === null ? null : (row.closureEvidence as Record<string, unknown>),
    closedAtSeq: row.closedAtSeq,
    createdBy: row.createdBy,
  };
}

/**
 * The frozen auction, read-only. There is no write method here and there never
 * will be: settlement consumes `auction_events` and the auction row, and holds
 * no path to mutate either (§2, §5).
 */
export function createAuctionSource(db: Db): AuctionSourcePort {
  return {
    async loadAuction(auctionId): Promise<AuctionSourceRef | null> {
      const [row] = await db
        .select({
          id: auctions.id,
          orgId: auctions.orgId,
          competitionId: auctions.competitionId,
          status: auctions.status,
        })
        .from(auctions)
        .where(eq(auctions.id, auctionId))
        .limit(1);
      return row === undefined
        ? null
        : {
            auctionId: row.id,
            orgId: row.orgId,
            competitionId: row.competitionId,
            status: row.status,
          };
    },

    async loadEvents(auctionId): Promise<readonly AuctionEventEnvelope[]> {
      const rows = await db
        .select({
          seq: auctionEvents.seq,
          type: auctionEvents.type,
          atMs: auctionEvents.atMs,
          actor: auctionEvents.actor,
          correlationId: auctionEvents.correlationId,
          payload: auctionEvents.payload,
        })
        .from(auctionEvents)
        .where(eq(auctionEvents.auctionId, auctionId))
        .orderBy(asc(auctionEvents.seq));
      return rows.map((row) => ({
        ...row,
        payload: row.payload as Record<string, unknown>,
      }));
    },
  };
}

export type { ObligationRow, PostingRow, CheckpointRow, PaymentRow };
