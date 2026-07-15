/**
 * Deterministic fixtures shared by the settlement unit suites. Test-only, and
 * pure like everything else here: no clock, no randomness, no IO — the same
 * inputs build the same log, byte for byte, on every machine.
 */

import type { AuctionEventEnvelope } from "@desiauction/core";

import type { NewEvent, SettlementEventEnvelope, StreamType } from "./events";

/**
 * A deterministic 64-bit FNV-1a digest. The production digest is sha-256,
 * injected at the edge (ports.DigestFn) — the domain is indifferent to WHICH
 * algorithm hashes its canonical bytes, and these suites prove that indifference
 * by using a different one.
 */
export function testDigest(bytes: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < bytes.length; index += 1) {
    hash = (hash ^ BigInt(bytes.charCodeAt(index))) & mask;
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Turn decided events into a persisted stream, exactly as the writer would. */
export function envelopes(
  events: readonly NewEvent[],
  options: { startSeq?: number; atMs?: number; actor?: string } = {},
): SettlementEventEnvelope[] {
  const startSeq = options.startSeq ?? 1;
  const atMs = options.atMs ?? 1_700_000_000_000;
  const actor = options.actor ?? "01ACTOR0000000000000000000";
  return events.map((event, index) => ({
    streamType: event.streamType,
    streamId: event.streamId,
    seq: startSeq + index,
    type: event.type,
    atMs: atMs + index,
    actor,
    correlationId: `01CORR${String(index).padStart(20, "0")}`,
    commandId: `01CMD${String(index).padStart(21, "0")}`,
    payload: event.payload,
  }));
}

export function envelope(
  streamType: StreamType,
  streamId: string,
  seq: number,
  type: string,
  payload: Record<string, unknown>,
): SettlementEventEnvelope {
  return {
    streamType,
    streamId,
    seq,
    type,
    atMs: 1_700_000_000_000 + seq,
    actor: "01ACTOR0000000000000000000",
    correlationId: `01CORR${String(seq).padStart(20, "0")}`,
    commandId: `01CMD${String(seq).padStart(21, "0")}`,
    payload,
  };
}

export interface AuctionFixtureSale {
  readonly lotId: string;
  readonly paddleId: string;
  readonly amount: number;
}

export interface AuctionFixture {
  readonly teams: readonly { readonly teamId: string; readonly paddleId: string }[];
  readonly sales: readonly AuctionFixtureSale[];
}

/**
 * A frozen auction log settlement can fold: paddles issued, lots prepared and
 * queued, the night opened, bids accepted, lots sold, the auction closed. Every
 * payload is exactly what the FROZEN catalog defines — these fixtures fold
 * through `replayAuction` itself, so intake is tested against the real reducer,
 * never a mock of it.
 */
export function auctionSourceLog(fixture: AuctionFixture): AuctionEventEnvelope[] {
  const events: { type: string; payload: Record<string, unknown> }[] = [
    {
      type: "AuctionCreated",
      payload: { competitionId: "01COMP", lotCount: fixture.sales.length, name: "Night" },
    },
  ];
  fixture.teams.forEach((team, index) => {
    events.push({
      type: "PaddleIssued",
      payload: {
        paddleId: team.paddleId,
        teamId: team.teamId,
        personId: `01PERSON${String(index).padStart(18, "0")}`,
        paddleNumber: `P0${String(index + 1)}`,
      },
    });
  });
  const lotIds = [...new Set(fixture.sales.map((sale) => sale.lotId))];
  lotIds.forEach((lotId, index) => {
    events.push({
      type: "LotPrepared",
      payload: {
        lotId,
        registrationId: `01REG${String(index).padStart(21, "0")}`,
        lotNumber: `L${String(index + 1).padStart(3, "0")}`,
        basePrice: 100_000,
      },
    });
  });
  for (const lotId of lotIds) {
    events.push({ type: "LotQueued", payload: { lotId } });
  }
  events.push({ type: "AuctionOpened", payload: { from: "scheduled" } });
  fixture.sales.forEach((sale, index) => {
    const bidId = `01BID${String(index).padStart(21, "0")}`;
    events.push({ type: "LotOpened", payload: { lotId: sale.lotId, endsAtMs: 1_700_000_030_000 } });
    events.push({
      type: "BidAccepted",
      payload: {
        lotId: sale.lotId,
        bidId,
        paddleId: sale.paddleId,
        amount: sale.amount,
        prevBidId: null,
      },
    });
    events.push({
      type: "LotSold",
      payload: { lotId: sale.lotId, bidId, paddleId: sale.paddleId, amount: sale.amount },
    });
  });
  events.push({ type: "AuctionClosed", payload: { from: "live" } });

  return events.map((event, index) => ({
    seq: index + 1,
    type: event.type,
    atMs: 1_700_000_000_000 + index * 1_000,
    actor: "01CONDUCTOR000000000000000",
    correlationId: `01CORR${String(index).padStart(20, "0")}`,
    payload: event.payload,
  }));
}

/** The one lawful way a completed auction's log still grows (§11). */
export function withAuctionRecovered(
  events: readonly AuctionEventEnvelope[],
): AuctionEventEnvelope[] {
  const last = events[events.length - 1];
  return [
    ...events,
    {
      seq: (last?.seq ?? 0) + 1,
      type: "AuctionRecovered",
      atMs: (last?.atMs ?? 0) + 1_000,
      actor: "00000000000000000000000000",
      correlationId: "01CORRRECOVERY00000000000",
      payload: { divergences: 1, eventCount: events.length },
    },
  ];
}
