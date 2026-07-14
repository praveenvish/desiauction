// SCALE CERTIFICATION HARNESS (M-IP4-4). The M-IP4-2 harness (perf-live.ts)
// measures latencies at ONE size; this one measures how the platform BEHAVES AS
// IT GROWS — the question a freeze has to answer.
//
// Matrix (directive): lots 100 · 250 · 500 · 1000 · 2500
//                     spectators 50 · 100 · 250 · 500 · 1000
//
// For every lot count it measures the whole spine: auction creation, engine
// load, queue throughput, PlaceBid latency (which includes the post-command
// re-fold), pure replay, snapshot build, snapshot BYTES, recovery, ledger
// regeneration, diagnostics. Then it fans a real bid out to real WebSocket
// spectators and measures convergence.
//
// Run: pnpm --filter @desiauction/engine perf:scale
import { performance } from "node:perf_hooks";

import { buildLiveSnapshot, createAuction, loadEvents } from "@desiauction/auction";
import {
  buildAuctionLedger,
  DEFAULT_AUCTION_CONFIG,
  registrationNumber,
  replayAuction,
  type AuctionConfig,
} from "@desiauction/core";
import {
  auctionEvents,
  auctionOwnerInvites,
  auctions,
  auditLog,
  bids,
  competitions,
  lots,
  newId,
  organizations,
  orgMembers,
  paddleGrants,
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
const SECRET = "perf-scale-secret";

const LOT_SCALES = [100, 250, 500, 1000, 2500];
const SPECTATOR_SCALES = [50, 100, 250, 500, 1000];
const TEAMS = 10;

// No expiry mid-run: the timer authority is measured in perf-live, not here.
const CONFIG: AuctionConfig = {
  ...DEFAULT_AUCTION_CONFIG,
  timer: { initialSeconds: 3600, extensionSeconds: 15 },
  squadMax: 3000, // scale runs must never hit the squad guard
  pursePerTeam: DEFAULT_AUCTION_CONFIG.pursePerTeam,
};

function stats(samples: number[]): { median: number; p95: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
  };
}

const rows: string[] = [];
function record(scale: number, metric: string, median: number, p95: number, n: number): void {
  const line = `| ${String(scale).padStart(5)} | ${metric.padEnd(42)} | ${median.toFixed(1).padStart(9)} | ${p95.toFixed(1).padStart(8)} | ${String(n).padStart(4)} |`;
  rows.push(line);
  console.log(line);
}

interface Seeded {
  orgId: string;
  ownerId: string;
  compId: string;
  auctionId: string;
  teamIds: string[];
  bidderIds: string[];
  personIds: string[];
}

async function seed(lotCount: number): Promise<Seeded> {
  const tag = `${String(Date.now()).slice(-7)}${String(lotCount).padStart(4, "0")}`;
  const orgId = newId();
  const ownerId = newId();
  const compId = newId();
  const bidderIds = Array.from({ length: TEAMS }, () => newId());
  const teamIds = Array.from({ length: TEAMS }, () => newId());
  const personIds = Array.from({ length: lotCount }, () => newId());

  await db.insert(people).values([
    { id: ownerId, phone: `+91${tag}00`, name: "Scale Owner" },
    ...bidderIds.map((id, i) => ({
      id,
      phone: `+91${tag}1${String(i).padStart(2, "0")}`,
      name: `Scale Bidder ${String(i)}`,
    })),
  ]);
  // People are inserted in chunks: 2500 rows in one statement exceeds the
  // driver's parameter budget.
  for (let i = 0; i < personIds.length; i += 500) {
    const chunk = personIds.slice(i, i + 500);
    await db.insert(people).values(
      chunk.map((id, j) => ({
        id,
        phone: `+91${tag}2${String(i + j).padStart(5, "0")}`,
        name: `Scale Player ${String(i + j)}`,
      })),
    );
  }
  await db
    .insert(organizations)
    .values({ id: orgId, name: `Scale ${tag}`, slug: `scale-${tag}`, createdBy: ownerId });
  await db.insert(orgMembers).values({ orgId, personId: ownerId });
  await db.insert(competitions).values({
    id: compId,
    orgId,
    name: `Scale League ${tag}`,
    slug: `scale-league-${tag}`,
    status: "registration_closed",
    createdBy: ownerId,
  });
  await db.insert(teams).values(
    teamIds.map((id, i) => ({
      id,
      orgId,
      competitionId: compId,
      name: `Scale Team ${String(i).padStart(2, "0")}`,
      createdBy: ownerId,
    })),
  );
  const regIds = Array.from({ length: lotCount }, () => newId());
  for (let i = 0; i < regIds.length; i += 500) {
    const chunk = regIds.slice(i, i + 500);
    await db.insert(registrations).values(
      chunk.map((id, j) => ({
        id,
        orgId,
        competitionId: compId,
        personId: personIds[i + j] as string,
        role: "batter" as const,
        status: "approved" as const,
        registrationNumber: registrationNumber(id),
      })),
    );
  }

  // MEASURED: auction creation (pool → prepared lots + one event per lot).
  const createStart = performance.now();
  const created = await createAuction(
    db,
    { id: compId, orgId, name: `Scale League ${tag}` },
    {
      ok: true,
      competitionId: compId,
      pool: regIds.map((registrationId) => ({ registrationId, basePriceBand: null })),
    },
    ownerId,
    CONFIG,
  );
  const createMs = performance.now() - createStart;
  if (!created.ok) {
    throw new Error(`auction creation failed: ${created.reason}`);
  }
  record(lotCount, "createAuction (pool → lots + events)", createMs, createMs, 1);

  return { orgId, ownerId, compId, auctionId: created.auctionId, teamIds, bidderIds, personIds };
}

async function cleanup(s: Seeded): Promise<void> {
  await db.delete(auctionEvents).where(eq(auctionEvents.orgId, s.orgId));
  await db.delete(bids).where(eq(bids.orgId, s.orgId));
  await db.delete(lots).where(eq(lots.orgId, s.orgId));
  await db.delete(paddleGrants).where(eq(paddleGrants.orgId, s.orgId));
  await db.delete(auctionOwnerInvites).where(eq(auctionOwnerInvites.orgId, s.orgId));
  await db.delete(paddles).where(eq(paddles.orgId, s.orgId));
  await db.delete(auctions).where(eq(auctions.orgId, s.orgId));
  await db.delete(registrations).where(eq(registrations.orgId, s.orgId));
  await db.delete(teams).where(eq(teams.orgId, s.orgId));
  await db.delete(competitions).where(eq(competitions.orgId, s.orgId));
  await db.delete(orgMembers).where(eq(orgMembers.orgId, s.orgId));
  await db.delete(auditLog).where(eq(auditLog.scopeId, s.orgId));
  await db.delete(organizations).where(eq(organizations.id, s.orgId));
  for (let i = 0; i < s.personIds.length; i += 500) {
    await db.delete(people).where(inArray(people.id, s.personIds.slice(i, i + 500)));
  }
  await db.delete(people).where(inArray(people.id, [s.ownerId, ...s.bidderIds]));
}

async function runLotScale(lotCount: number): Promise<void> {
  const s = await seed(lotCount);
  const engine = new AuctionEngine({ db, logger, onSnapshot: () => undefined });
  const command = async (
    type: string,
    actor: string,
    payload: Record<string, unknown>,
    conduct = false,
  ) =>
    engine.submit({
      commandId: newId(),
      auctionId: s.auctionId,
      type: type as never,
      actor,
      conduct,
      payload,
    });

  // Engine load = replay-on-load (the recovery path) at this scale.
  const loadStart = performance.now();
  const loaded = await engine.ensureAuction(s.auctionId);
  record(lotCount, "engine load (replay + verify + snapshot)", performance.now() - loadStart, 0, 1);
  if (loaded?.halted != null) {
    throw new Error(`engine halted at load: ${loaded.halted}`);
  }

  // Owner model for every team. Every ack is asserted: a silent setup failure
  // would quietly invalidate every number this harness prints.
  const must = (ack: { accepted: boolean; reason?: string }, what: string): void => {
    if (!ack.accepted) {
      throw new Error(`${what} failed: ${ack.reason ?? "?"}`);
    }
  };
  for (let i = 0; i < TEAMS; i++) {
    const bidder = s.bidderIds[i] as string;
    const invited = await command(
      "InviteOwner",
      s.ownerId,
      {
        teamId: s.teamIds[i] as string,
        tokenHash: newId(), // unique per run: the hash column is globally unique

        expiresAtMs: Date.now() + 3_600_000,
      },
      true,
    );
    must(invited, "InviteOwner");
    const inviteId = (invited.reason ?? "").replace("invite:", "");
    must(await command("AcceptOwnerInvite", bidder, { inviteId }), "AcceptOwnerInvite");
    must(
      await command(
        "GrantPaddle",
        s.ownerId,
        { teamId: s.teamIds[i] as string, personId: bidder },
        true,
      ),
      "GrantPaddle",
    );
    must(await command("ClaimPaddle", bidder, { teamId: s.teamIds[i] as string }), "ClaimPaddle");
  }

  // QUEUE THROUGHPUT: N lots queued (bulk ≡ N single transitions).
  const queueStart = performance.now();
  await command("QueueLots", s.ownerId, {}, true);
  const queueMs = performance.now() - queueStart;
  record(lotCount, "QueueLots (whole pool, bulk)", queueMs, queueMs, 1);
  record(lotCount, "  └─ per-lot queue cost", queueMs / lotCount, 0, lotCount);

  must(await command("OpenAuction", s.ownerId, {}, true), "OpenAuction");
  const state = engine.snapshotOf(s.auctionId);
  const lotId = state?.snapshot?.queue[0]?.lotId ?? "";
  must(await command("OpenLot", s.ownerId, { lotId }, true), "OpenLot");

  const paddleRows = await db
    .select({ id: paddles.id, personId: paddles.personId })
    .from(paddles)
    .where(eq(paddles.auctionId, s.auctionId));
  const paddleOf = new Map(paddleRows.map((r) => [r.personId, r.id]));

  // PLACE BID at scale. Each accepted command triggers a FULL re-fold of the
  // event log + snapshot rebuild + verify — so this is the metric that reveals
  // how command latency tracks auction size.
  const bidLatency: number[] = [];
  for (let i = 0; i < 20; i++) {
    const bidder = s.bidderIds[i % TEAMS] as string;
    // The engine publishes the next legal rung; asking it (rather than guessing
    // an increment) keeps the harness honest against the ladder.
    const amount = engine.snapshotOf(s.auctionId)?.snapshot?.currentLot?.nextMinimumBid ?? 0;
    const start = performance.now();
    const ack = await command("PlaceBid", bidder, {
      lotId,
      paddleId: paddleOf.get(bidder),
      amountRaw: amount,
    });
    const elapsed = performance.now() - start;
    if (!ack.accepted) {
      throw new Error(`scale bid rejected: ${ack.reason ?? "?"}`);
    }
    bidLatency.push(elapsed);
  }
  const bid = stats(bidLatency);
  record(
    lotCount,
    "PlaceBid (ack incl. re-fold + rebuild)",
    bid.median,
    bid.p95,
    bidLatency.length,
  );

  // Pure fold + snapshot assembly + serialization.
  const events = await loadEvents(db, s.auctionId);
  const foldOnly: number[] = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    replayAuction(events);
    foldOnly.push(performance.now() - start);
  }
  const fold = stats(foldOnly);
  record(
    lotCount,
    `replayAuction pure fold (${String(events.length)} ev)`,
    fold.median,
    fold.p95,
    10,
  );

  const record0 = {
    id: s.auctionId,
    orgId: s.orgId,
    competitionId: s.compId,
    name: "scale",
    status: "live" as const,
    config: CONFIG,
  };
  const snapGen: number[] = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    await buildLiveSnapshot(db, record0);
    snapGen.push(performance.now() - start);
  }
  const snap = stats(snapGen);
  record(lotCount, "buildLiveSnapshot (load+fold+verify+build)", snap.median, snap.p95, 10);

  // SNAPSHOT BYTES — the broadcast payload every spectator receives per event.
  const built = await buildLiveSnapshot(db, record0);
  const bytes = built.ok ? Buffer.byteLength(built.serialized, "utf8") : 0;
  console.log(
    `| ${String(lotCount).padStart(5)} | ${"snapshot payload (KiB, per broadcast)".padEnd(42)} | ${(bytes / 1024).toFixed(1).padStart(9)} | ${"—".padStart(8)} | ${"—".padStart(4)} |`,
  );
  rows.push(
    `| ${String(lotCount).padStart(5)} | ${"snapshot payload (KiB, per broadcast)".padEnd(42)} | ${(bytes / 1024).toFixed(1).padStart(9)} | ${"—".padStart(8)} | ${"—".padStart(4)} |`,
  );

  // RECOVERY: drop in-memory state (≙ process restart) and rebuild from the log.
  const recovery: number[] = [];
  for (let i = 0; i < 5; i++) {
    engine.reset(s.auctionId);
    const start = performance.now();
    await engine.ensureAuction(s.auctionId);
    recovery.push(performance.now() - start);
  }
  const rec = stats(recovery);
  record(lotCount, "recovery (restart → replay → snapshot)", rec.median, rec.p95, 5);

  // LEDGER regeneration (the whole operational history, from events).
  const refs = built.ok ? built : null;
  const ledger: number[] = [];
  let ledgerRows = 0;
  if (refs !== null) {
    const snapshotRefsForLedger = {
      auctionId: s.auctionId,
      auctionName: "scale",
      pursePerTeam: CONFIG.pursePerTeam,
      slabs: CONFIG.slabs,
      lots: {},
      paddles: {},
    };
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const built2 = buildAuctionLedger(events, snapshotRefsForLedger, {});
      ledger.push(performance.now() - start);
      ledgerRows = built2.length;
    }
    const led = stats(ledger);
    record(lotCount, `ledger regeneration (${String(ledgerRows)} rows)`, led.median, led.p95, 5);
  }

  // Diagnostics refresh (the recovery dashboard's feed).
  const diag: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    engine.diagnosticsOf(s.auctionId);
    diag.push(performance.now() - start);
  }
  const dg = stats(diag);
  record(lotCount, "diagnostics refresh (in-process)", dg.median, dg.p95, 20);

  await cleanup(s);
  console.log(
    `| ${"".padStart(5)} | ${"".padEnd(42)} | ${"".padStart(9)} | ${"".padStart(8)} | ${"".padStart(4)} |`,
  );
}

/** Broadcast fan-out: real WebSocket spectators converge on a real bid. */
async function runSpectatorScale(): Promise<void> {
  const lotCount = 250; // a realistic auction night
  const s = await seed(lotCount);
  let hubRef: ReturnType<typeof buildServer>["hub"] | null = null;
  const engine = new AuctionEngine({
    db,
    logger,
    onSnapshot: (a, serialized, version) => hubRef?.broadcast(a, serialized, version),
  });
  const { server, hub } = buildServer({
    logger,
    version: "perf-scale",
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
    engine.submit({
      commandId: newId(),
      auctionId: s.auctionId,
      type: type as never,
      actor,
      conduct,
      payload,
    });

  await engine.ensureAuction(s.auctionId);
  for (let i = 0; i < TEAMS; i++) {
    const bidder = s.bidderIds[i] as string;
    const invited = await command(
      "InviteOwner",
      s.ownerId,
      {
        teamId: s.teamIds[i] as string,
        tokenHash: `spec-${String(i)}`,
        expiresAtMs: Date.now() + 3_600_000,
      },
      true,
    );
    const inviteId = (invited.reason ?? "").replace("invite:", "");
    await command("AcceptOwnerInvite", bidder, { inviteId });
    await command(
      "GrantPaddle",
      s.ownerId,
      { teamId: s.teamIds[i] as string, personId: bidder },
      true,
    );
    await command("ClaimPaddle", bidder, { teamId: s.teamIds[i] as string });
  }
  await command("QueueLots", s.ownerId, {}, true);
  await command("OpenAuction", s.ownerId, {}, true);
  const lotId = engine.snapshotOf(s.auctionId)?.snapshot?.queue[0]?.lotId ?? "";
  await command("OpenLot", s.ownerId, { lotId }, true);
  const paddleRows = await db
    .select({ id: paddles.id, personId: paddles.personId })
    .from(paddles)
    .where(eq(paddles.auctionId, s.auctionId));
  const paddleOf = new Map(paddleRows.map((r) => [r.personId, r.id]));

  const ticket = wsTicket(s.auctionId, SECRET);
  const url = `ws://127.0.0.1:${String(port)}/ws?auction=${s.auctionId}&ticket=${ticket}`;
  const sockets: WebSocket[] = [];

  for (const spectators of SPECTATOR_SCALES) {
    // Grow the room to the target size, measuring JOIN (connect → snapshot).
    const joinSamples: number[] = [];
    const toAdd = spectators - sockets.length;
    await Promise.all(
      Array.from({ length: toAdd }, () => {
        const start = performance.now();
        return new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(url);
          sockets.push(ws);
          ws.once("message", () => {
            joinSamples.push(performance.now() - start);
            resolve();
          });
          ws.once("error", reject);
        });
      }),
    );
    const join = stats(joinSamples);
    record(spectators, "spectator join (connect → full snapshot)", join.median, join.p95, toAdd);

    // FAN-OUT: one real bid → every spectator receives the new snapshot.
    const fanout: number[] = [];
    for (let round = 0; round < 5; round++) {
      const bidder = s.bidderIds[round % TEAMS] as string;
      const target = engine.snapshotOf(s.auctionId)?.version ?? 0;
      const arrivals: number[] = [];
      const start = performance.now();
      const converged = new Promise<void>((resolve) => {
        let seen = 0;
        for (const ws of sockets) {
          const onMessage = (raw: WebSocket.RawData): void => {
            const frame = JSON.parse(String(raw)) as { kind: string; version: number };
            if (frame.kind === "snapshot" && frame.version > target) {
              arrivals.push(performance.now() - start);
              ws.off("message", onMessage);
              seen += 1;
              if (seen === sockets.length) {
                resolve();
              }
            }
          };
          ws.on("message", onMessage);
        }
      });
      const amount = engine.snapshotOf(s.auctionId)?.snapshot?.currentLot?.nextMinimumBid ?? 0;
      await command("PlaceBid", bidder, {
        lotId,
        paddleId: paddleOf.get(bidder),
        amountRaw: amount,
      });
      await converged;
      fanout.push(Math.max(...arrivals));
    }
    const fan = stats(fanout);
    record(spectators, "bid → ALL spectators converged (last)", fan.median, fan.p95, 5);
  }

  for (const ws of sockets) {
    ws.close();
  }
  await server.close();
  await cleanup(s);
}

async function main(): Promise<void> {
  console.log("\nDESIAUCTION — IP-4 SCALE CERTIFICATION\n");
  console.log(
    `| ${"scale".padStart(5)} | ${"metric".padEnd(42)} | ${"median ms".padStart(9)} | ${"p95 ms".padStart(8)} | ${"n".padStart(4)} |`,
  );
  console.log(
    `|${"-".repeat(7)}|${"-".repeat(44)}|${"-".repeat(11)}|${"-".repeat(10)}|${"-".repeat(6)}|`,
  );

  for (const lotCount of LOT_SCALES) {
    await runLotScale(lotCount);
  }
  console.log("\n--- BROADCAST FAN-OUT (250-lot auction, real WebSockets) ---\n");
  await runSpectatorScale();

  console.log("\nDone.\n");
  await sql.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
