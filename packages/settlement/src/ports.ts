/**
 * Ports (IP-5_ARCHITECTURE §5/§6/§10). The settlement domain declares the
 * shapes it needs; adapters in the app tier implement them. No infrastructure
 * type — no driver, no SQL, no provider SDK — is permitted to cross this file,
 * which is what keeps `packages/settlement` importable by anything and coupled
 * to nothing.
 */

import type { AuctionEventEnvelope } from "@desiauction/core";

import type { CaseStatus, ObligationBasis } from "./case";
import type { LegDirection, PostingTemplate } from "./journal";
import type { SettlementEventEnvelope, StreamType } from "./events";

/**
 * The digest algorithm, injected. The domain produces canonical BYTES and never
 * hashes them itself: hashing is the edge's job (the app supplies sha-256), so
 * the domain stays free of platform builtins while every digest in the system
 * remains deterministic and reproducible.
 */
export type DigestFn = (bytes: string) => string;

// --- The frozen auction, as settlement is allowed to see it -------------------------

export interface AuctionSourceRef {
  readonly auctionId: string;
  readonly orgId: string;
  readonly competitionId: string;
  readonly status: string;
}

/**
 * READ-ONLY by construction: this port has no write operation, so no settlement
 * code path can express an auction mutation even by accident. Auction history
 * enters settlement as events and leaves as nothing.
 */
export interface AuctionSourcePort {
  loadAuction(auctionId: string): Promise<AuctionSourceRef | null>;
  loadEvents(auctionId: string): Promise<readonly AuctionEventEnvelope[]>;
}

// --- Projection rows (plain data; the store maps them to storage) -------------------

export interface CaseRow {
  readonly caseId: string;
  readonly orgId: string;
  readonly createdBy: string;
  readonly auctionId: string;
  readonly competitionId: string;
  readonly status: CaseStatus;
  readonly basis: ObligationBasis;
  readonly sourceEventCount: number;
  readonly sourceDigest: string;
  readonly foldDigest: string | null;
  /** The closure evidence package (M-IP5-3), null until closed / after reopen. */
  readonly closureEvidence: Readonly<Record<string, unknown>> | null;
  readonly closedAtSeq: number | null;
}

export interface ObligationRow {
  readonly caseId: string;
  readonly orgId: string;
  readonly teamId: string;
  readonly amount: number;
  readonly increased: number;
  readonly reduced: number;
  readonly discharged: number;
  readonly waived: number;
  readonly reinstated: number;
}

export interface LegRow {
  readonly legIndex: number;
  readonly account: string;
  readonly direction: LegDirection;
  readonly amount: number;
}

export interface PostingRow {
  readonly postingId: string;
  readonly orgId: string;
  readonly eventSeq: number;
  readonly template: PostingTemplate;
  readonly caseId: string | null;
  readonly teamId: string | null;
  readonly sourceStream: string;
  readonly sourceSeq: number;
  readonly memo: string | null;
  readonly atMs: number;
  readonly legs: readonly LegRow[];
}

export interface CheckpointRow {
  readonly orgId: string;
  readonly seq: number;
  readonly digest: string;
  readonly bytes: string;
  readonly verifiedAtMs: number | null;
}

/** The Payment aggregate's projection row (M-IP5-2). One per payment attempt. */
export interface PaymentRow {
  readonly paymentId: string;
  readonly orgId: string;
  readonly caseId: string;
  readonly teamId: string;
  readonly method: string;
  readonly status: string;
  readonly amount: number;
  readonly captured: number;
  readonly refundedTotal: number;
  readonly attested: boolean;
  readonly attestedBy: string | null;
  readonly providerRef: string | null;
}

export interface AppendEventInput {
  readonly orgId: string;
  readonly streamType: StreamType;
  readonly streamId: string;
  readonly type: string;
  readonly atMs: number;
  readonly actor: string;
  readonly correlationId: string;
  readonly commandId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface AuditInput {
  readonly actor: string;
  readonly action: string;
  readonly orgId: string;
  readonly subject: string;
  readonly source: string;
  readonly correlationId: string;
  readonly eventSeq: number;
  readonly reason?: string;
}

/**
 * The unit of work. Every settlement mutation is exactly one of these: the
 * event, its audit row and its projection rows commit together or not at all
 * (audit failure fails the action — invariant 28).
 */
export interface SettlementTx {
  appendEvent(input: AppendEventInput): Promise<number>;
  writeAudit(input: AuditInput): Promise<void>;
  putCase(row: CaseRow): Promise<void>;
  /** Replaces the case's obligation rows wholesale — projections are disposable. */
  putObligations(caseId: string, rows: readonly ObligationRow[]): Promise<void>;
  putPosting(row: PostingRow): Promise<void>;
  /** Recovery's eraser: rows are rebuilt FROM events, never patched towards them. */
  deletePostings(orgId: string): Promise<void>;
  putCheckpoint(row: CheckpointRow): Promise<void>;
  markCheckpointVerified(orgId: string, seq: number, atMs: number): Promise<void>;
  clearCheckpoints(orgId: string): Promise<void>;
  putPayment(row: PaymentRow): Promise<void>;
  /** Recovery's eraser for the payment projection — rebuilt FROM events. */
  deletePayments(orgId: string): Promise<void>;
}

export interface SettlementStore {
  transact<T>(fn: (tx: SettlementTx) => Promise<T>): Promise<T>;
  loadStream(streamType: StreamType, streamId: string): Promise<readonly SettlementEventEnvelope[]>;
  loadStreamFrom(
    streamType: StreamType,
    streamId: string,
    fromSeq: number,
  ): Promise<readonly SettlementEventEnvelope[]>;
  findByCommandId(
    streamType: StreamType,
    streamId: string,
    commandId: string,
  ): Promise<SettlementEventEnvelope | null>;
  loadCase(caseId: string): Promise<CaseRow | null>;
  loadCaseByAuction(auctionId: string): Promise<CaseRow | null>;
  loadObligations(caseId: string): Promise<readonly ObligationRow[]>;
  loadPostings(orgId: string): Promise<readonly PostingRow[]>;
  loadCheckpoints(orgId: string): Promise<readonly CheckpointRow[]>;
  latestVerifiedCheckpoint(orgId: string): Promise<CheckpointRow | null>;
  loadPayment(paymentId: string): Promise<PaymentRow | null>;
  /** Distinct payment stream ids for the org — recovery's enumeration input. */
  loadPaymentIds(orgId: string): Promise<readonly string[]>;
}

// --- The payment gateway port (declared here; adapters arrive with M-IP5-2) ---------

export interface GatewayOrderInput {
  readonly paymentId: string;
  readonly orgId: string;
  readonly amount: number;
  readonly receipt: string;
}

export interface GatewayOrder {
  readonly orderRef: string;
}

export interface WebhookEnvelope {
  readonly providerEventId: string;
  readonly orderRef: string;
  readonly paymentId: string;
  readonly orgId: string;
  readonly kind: "authorized" | "captured" | "failed" | "refunded" | "disputed";
  readonly amount: number;
  readonly currency: string;
  readonly providerRef: string;
}

export type WebhookVerification =
  { ok: true; envelope: WebhookEnvelope } | { ok: false; reason: string };

export interface ProviderPaymentRecord {
  readonly providerRef: string;
  readonly status: string;
  readonly amount: number;
}

export interface ProviderRefundRecord {
  readonly providerRef: string;
  readonly amount: number;
}

/**
 * The single shape a payment provider may take. Gateway independence is
 * structural: the domain never imports an SDK, and no provider type escapes
 * this boundary. A second provider is another adapter, never a rewrite.
 */
export interface PaymentGatewayPort {
  readonly method: string;
  createOrder(input: GatewayOrderInput): Promise<GatewayOrder>;
  verifyWebhook(rawBody: string, signature: string, receivedAtMs: number): WebhookVerification;
  fetchPayment(providerRef: string): Promise<ProviderPaymentRecord>;
  initiateRefund(providerRef: string, amount: number): Promise<ProviderRefundRecord>;
}
