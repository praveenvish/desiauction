// Live engine performance harness (M-IP4-2). Seeds a real auction, runs a real
// engine (in-process core + a real HTTP/WS server), and MEASURES: command
// latency, snapshot generation, replay, recovery, concurrent bursts, broadcast
// fan-out to spectator counts. Prints median/p95 over N runs; cleans up.
// Run: pnpm --filter @desiauction/engine perf:live
import { performance } from "node:perf_hooks";

import { buildLiveSnapshot, createAuction, loadEvents } from "@desiauction/auction";
import {
  DEFAULT_AUCTION_CONFIG,
  registrationNumber,
  replayAuction,
  type AuctionConfig,
} from "@desiauction/core";
import {
  auctionEvents,
  auctions,
  auditLog,
  bids,
  competitions,
  lots,
  newId,
  organizations,
  orgMembers,
  paddles,
  people,
  registrations,
  teams,
} from "@desiauction/db";
import { eq, inArray } from "drizzle-orm";
import { pino } from "pino";
import { WebSocket } from "ws";

import { db, sql, checkDb } from "../src/db.js";
import { AuctionEngine } from "../src/engine-core.js";
import { buildServer, wsTicket } from "../src/server.js";

const logger = pino({ level: "silent" });
const RUN = `perf${String(Date.now()).slice(-6)}`;
const SECRET = "perf-secret-123";

function stats(samples: number[]): { median: number; p95: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
  };
}

function report(name: string, samples: number[]): void {
  const { median, p95 } = stats(samples);
  console.log(
    `${name.padEnd(56)} median ${median.toFixed(1).padStart(7)} ms · p95 ${p95.toFixed(1).padStart(7)} ms · n=${String(samples.length)}`,
  );
}

const CONFIG: AuctionConfig = {
  ...DEFAULT_AUCTION_CONFIG,
  timer: { initialSeconds: 3600, extensionSeconds: 15 }, // no expiry during runs
};

async function main(): Promise<void> {
  const orgId = newId();
  const ownerId = newId();
  const bidderIds = Array.from({ length: 10 }, () => newId());
  const teamIds = Array.from({ length: 10 }, () => newId());
  const compId = newId();

  await db.insert(people).values([
    { id: ownerId, phone: `+9192${RUN.slice(-6)}0`, name: "Perf Owner" },
    ...bidderIds.map((id, i) => ({
      id,
      phone: `+9193${RUN.slice(-5)}${String(i).padStart(2, "0")}`,
      name: `Perf Bidder ${String(i)}`,
    })),
  ]);
  await db
    .insert(organizations)
    .values({ id: orgId, name: `Perf Live ${RUN}`, slug: `perf-live-${RUN}`, createdBy: ownerId });
  await db.insert(orgMembers).values({ orgId, personId: ownerId });
  await db.insert(competitions).values({
    id: compId,
    orgId,
    name: `Perf Live League ${RUN}`,
    slug: `perf-live-league-${RUN}`,
    status: "registration_closed",
    createdBy: ownerId,
  });
  await db.insert(teams).values(
    teamIds.map((id, i) => ({
      id,
      orgId,
      competitionId: compId,
      name: `Perf Live Team ${String(i).padStart(2, "0")}`,
      createdBy: ownerId,
    })),
  );
  // The pool: 30 distinct players (one registration per person per competition).
  const poolPersonIds = Array.from({ length: 30 }, () => newId());
  await db.insert(people).values(
    poolPersonIds.map((id, i) => ({
      id,
      phone: `+9194${RUN.slice(-4)}${String(i).padStart(3, "0")}`,
      name: `Perf Player ${String(i)}`,
    })),
  );
  const regIds = Array.from({ length: 30 }, () => newId());
  await db.insert(registrations).values(
    regIds.map((id, i) => ({
      id,
      orgId,
      competitionId: compId,
      personId: poolPersonIds[i] as string,
      role: "batter" as const,
      status: "approved" as const,
      registrationNumber: registrationNumber(id),
    })),
  );

  const created = await createAuction(
    db,
    { id: compId, orgId, name: `Perf Live League ${RUN}` },
    {
      ok: true,
      competitionId: compId,
      pool: regIds.map((registrationId) => ({ registrationId, basePriceBand: null })),
    },
    ownerId,
    CONFIG,
  );
  if (!created.ok) {
    throw new Error(`auction creation failed: ${created.reason}`);
  }
  const auctionId = created.auctionId;

  let broadcastCount = 0;
  // Late-bound hub (the index.ts wiring): snapshots reach the WS rooms.
  let hubRef: ReturnType<typeof buildServer>["hub"] | null = null;
  const engine = new AuctionEngine({
    db,
    logger,
    onSnapshot: (a, serialized, version) => {
      broadcastCount += 1;
      hubRef?.broadcast(a, serialized, version);
    },
  });
  const { server, hub } = buildServer({
    logger,
    version: "perf",
    checkDb,
    engine,
    engineSecret: SECRET,
    nodeEnv: "test",
  });
  hubRef = hub;
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  const port = address !== null && typeof address !== "string" ? address.port : 0;

  const command = async (
    type: string,
    actor: string,
    payload: Record<string, unknown>,
    conduct = false,
  ) =>
    engine.submit({ commandId: newId(), auctionId, type: type as never, actor, conduct, payload });

  // Setup: claim 10 paddles, queue, open, open first lot.
  for (let i = 0; i < 10; i++) {
    await command("ClaimPaddle", bidderIds[i] as string, { teamId: teamIds[i] as string });
  }
  await command("QueueLots", ownerId, {}, true);
  const { transitionAuction } = await import("@desiauction/auction");
  const state = engine.snapshotOf(auctionId);
  if (state === undefined) {
    throw new Error("no engine state");
  }
  await transitionAuction(db, state.record, ownerId, "open");
  engine.reset(auctionId);
  const reloaded = await engine.ensureAuction(auctionId);
  const lotId = reloaded?.snapshot?.queue[0]?.lotId ?? "";
  await command("OpenLot", ownerId, { lotId }, true);

  const paddleRows = await db
    .select({ id: paddles.id, personId: paddles.personId })
    .from(paddles)
    .where(eq(paddles.auctionId, auctionId));
  const paddleOf = new Map(paddleRows.map((p) => [p.personId, p.id]));

  console.log(`\nEngine live on :${String(port)} — measuring:\n`);

  // --- Command latency: sequential accepted bids (full queue → aggregate →
  // event → rebuild → broadcast round trip).
  const bidLatency: number[] = [];
  for (let i = 0; i < 40; i++) {
    const bidder = bidderIds[(i + 1) % 10] as string;
    const next = engine.snapshotOf(auctionId)?.snapshot?.currentLot?.nextMinimumBid ?? 0;
    const start = performance.now();
    const ack = await command("PlaceBid", bidder, {
      lotId,
      paddleId: paddleOf.get(bidder) ?? "",
      amountRaw: next,
    });
    const elapsed = performance.now() - start;
    if (ack.accepted) {
      bidLatency.push(elapsed);
    }
  }
  report("PlaceBid command latency (accepted, incl. rebuild)", bidLatency);

  // --- Concurrent burst: 10 simultaneous bids, one winner.
  const burst: number[] = [];
  for (let round = 0; round < 10; round++) {
    const next = engine.snapshotOf(auctionId)?.snapshot?.currentLot?.nextMinimumBid ?? 0;
    const start = performance.now();
    await Promise.all(
      bidderIds.map((bidder) =>
        command("PlaceBid", bidder, {
          lotId,
          paddleId: paddleOf.get(bidder) ?? "",
          amountRaw: next,
        }),
      ),
    );
    burst.push(performance.now() - start);
  }
  report("10 concurrent bids (burst wall time, 1 winner)", burst);

  // --- Snapshot generation + replay duration at current log size.
  const events = await loadEvents(db, auctionId);
  console.log(`event log size: ${String(events.length)} events`);
  const record = engine.snapshotOf(auctionId)?.record;
  if (record === undefined) {
    throw new Error("no record");
  }
  const snapshotGen: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    await buildLiveSnapshot(db, record);
    snapshotGen.push(performance.now() - start);
  }
  report("buildLiveSnapshot (load events + fold + verify)", snapshotGen);
  const replayOnly: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    replayAuction(events);
    replayOnly.push(performance.now() - start);
  }
  report(`replayAuction pure fold (${String(events.length)} events)`, replayOnly);

  // --- Recovery duration: fresh engine instance, replay-on-load.
  const recovery: number[] = [];
  for (let i = 0; i < 10; i++) {
    const fresh = new AuctionEngine({ db, logger, onSnapshot: () => undefined });
    const start = performance.now();
    await fresh.ensureAuction(auctionId);
    recovery.push(performance.now() - start);
  }
  report("engine recovery (restart → replay → snapshot)", recovery);

  // --- Broadcast fan-out: N spectators over real WebSockets.
  for (const spectators of [50, 200]) {
    const ticket = wsTicket(auctionId, SECRET);
    const sockets: WebSocket[] = [];
    await Promise.all(
      Array.from({ length: spectators }, () => {
        const socket = new WebSocket(
          `ws://127.0.0.1:${String(port)}/ws?auction=${auctionId}&ticket=${ticket}`,
        );
        sockets.push(socket);
        return new Promise<void>((resolve, reject) => {
          socket.on("open", () => {
            resolve();
          });
          socket.on("error", reject);
        });
      }),
    );
    // Measure: bid → every spectator receives the new snapshot frame.
    const fanout: number[] = [];
    for (let i = 0; i < 5; i++) {
      const next = engine.snapshotOf(auctionId)?.snapshot?.currentLot?.nextMinimumBid ?? 0;
      const bidder = bidderIds[(i + 3) % 10] as string;
      const expectVersion = (engine.snapshotOf(auctionId)?.version ?? 0) + 1;
      const start = performance.now();
      const received = Promise.all(
        sockets.map(
          (socket) =>
            new Promise<void>((resolve) => {
              const onMessage = (data: unknown) => {
                const text = String(data);
                if (text.includes(`"version":${String(expectVersion)}`)) {
                  socket.off("message", onMessage);
                  resolve();
                }
              };
              socket.on("message", onMessage);
            }),
        ),
      );
      await command("PlaceBid", bidder, {
        lotId,
        paddleId: paddleOf.get(bidder) ?? "",
        amountRaw: next,
      });
      await received;
      fanout.push(performance.now() - start);
    }
    report(`bid → ${String(spectators)} spectators all converged`, fanout);
    for (const socket of sockets) {
      socket.close();
    }
  }
  console.log(`total broadcasts emitted: ${String(broadcastCount)}`);

  // --- Cleanup ---------------------------------------------------------------
  await server.close();
  await db.delete(auctionEvents).where(eq(auctionEvents.orgId, orgId));
  await db.delete(bids).where(eq(bids.orgId, orgId));
  await db.delete(lots).where(eq(lots.orgId, orgId));
  await db.delete(paddles).where(eq(paddles.orgId, orgId));
  await db.delete(auctions).where(eq(auctions.orgId, orgId));
  await db.delete(registrations).where(eq(registrations.orgId, orgId));
  await db.delete(teams).where(eq(teams.orgId, orgId));
  await db.delete(competitions).where(eq(competitions.orgId, orgId));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, orgId));
  await db.delete(auditLog).where(eq(auditLog.scopeId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await db.delete(people).where(inArray(people.id, [ownerId, ...bidderIds, ...poolPersonIds]));
  await sql.end();
  console.log("\ncleanup complete");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
