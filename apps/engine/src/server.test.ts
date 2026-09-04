import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";

import { healthResponseSchema } from "@desiauction/contracts";
import {
  DEFAULT_AUCTION_CONFIG,
  type AuctionCommandEnvelope,
  type AuctionEventEnvelope,
  type AuctionStatus,
} from "@desiauction/core";
import { auctionEvents, auctions, type Db } from "@desiauction/db";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";

import { AuctionEngine } from "./engine-core.js";
import {
  buildServer,
  parsePurseScope,
  wsTicket,
  wsTicketValid,
  TICKET_WINDOW_MS,
} from "./server.js";

const silentLogger = pino({ level: "silent" });

/** The shape a browser mints (`crypto.randomUUID()`); see isTransportCommandId. */
const VALID_ID = "0f9a1c2e-4b6d-4f8a-9c1e-2d3b4a5c6d7e";

// A stub engine: the transport tests need shape, not behavior.
function stubEngine(lastTickMs = 0): AuctionEngine {
  return {
    lastTickMs,
    tickDriftMs: 0,
    submit: () =>
      Promise.resolve({ commandId: "c", accepted: false, reason: "unknown_auction", version: 0 }),
    ensureAuction: () => Promise.resolve(null),
    snapshotOf: () => undefined,
    reset: () => undefined,
    tick: () => undefined,
    deepVerify: () => Promise.resolve(true),
  } as unknown as AuctionEngine;
}

function makeServer(dbOk: boolean, lastTickMs = 0) {
  return buildServer({
    logger: silentLogger,
    version: "test",
    checkDb: () => Promise.resolve(dbOk),
    engine: stubEngine(lastTickMs),
    engineSecret: "test-secret-123",
    nodeEnv: "test",
  });
}

describe("engine transport", () => {
  let built: ReturnType<typeof makeServer> | undefined;

  afterEach(async () => {
    await built?.server.close();
  });

  it("healthz returns 200 with a contract-valid body when the watchdog is ticking", async () => {
    built = makeServer(true);
    const response = await built.server.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    const body = healthResponseSchema.parse(response.json());
    expect(body.status).toBe("ok");
    expect(body.checks["watchdog"]).toBe("ok");
  });

  it("healthz stays ALIVE (200) even when the DB is down — liveness is not readiness (PRR F45)", async () => {
    // A DB blip must not make the orchestrator KILL a healthy engine mid-auction.
    // Liveness reflects only the watchdog; DB reachability gates /readyz instead.
    built = makeServer(false);
    const response = await built.server.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json()).status).toBe("ok");
  });

  it("readyz is 503 when the DB is down, 200 when it is up and ticking (routing gate)", async () => {
    const down = makeServer(false, Date.now());
    const downRes = await down.server.inject({ method: "GET", url: "/readyz" });
    expect(downRes.statusCode).toBe(503);
    await down.server.close();

    built = makeServer(true, Date.now());
    const upRes = await built.server.inject({ method: "GET", url: "/readyz" });
    expect(upRes.statusCode).toBe(200);
    expect(healthResponseSchema.parse(upRes.json()).status).toBe("ok");
  });

  it("commands without the shared secret are 401; malformed commands are 400", async () => {
    built = makeServer(true);
    const noSecret = await built.server.inject({
      method: "POST",
      url: "/command",
      payload: { commandId: VALID_ID, auctionId: "a", type: "PlaceBid", actor: "x" },
    });
    expect(noSecret.statusCode).toBe(401);
    const badType = await built.server.inject({
      method: "POST",
      url: "/command",
      headers: { "x-engine-secret": "test-secret-123" },
      payload: { commandId: VALID_ID, auctionId: "a", type: "DeleteEverything", actor: "x" },
    });
    expect(badType.statusCode).toBe(400);
    const wellFormed = await built.server.inject({
      method: "POST",
      url: "/command",
      headers: { "x-engine-secret": "test-secret-123" },
      payload: { commandId: VALID_ID, auctionId: "a", type: "PlaceBid", actor: "x", payload: {} },
    });
    expect(wellFormed.statusCode).toBe(200);
    expect(wellFormed.json()).toMatchObject({ accepted: false, reason: "unknown_auction" });
  });

  // REGRESSION (audit 2026-08-18, P0-3). `new URL()` throws on request targets
  // Node's HTTP parser accepts, the throw escaped the raw 'upgrade' listener,
  // and index.ts turns any uncaught exception into process.exit(1). One
  // unauthenticated line killed the live auction runtime. Every path out of the
  // upgrade handler must now be a socket.destroy(), never a throw.
  it("malformed upgrade targets are refused without taking the process down", async () => {
    built = makeServer(true);
    await built.server.listen({ port: 0, host: "127.0.0.1" });
    const { port } = built.server.server.address() as AddressInfo;

    const attempt = (target: string): Promise<"refused" | "upgraded"> =>
      new Promise((resolve, reject) => {
        const req = httpRequest({
          host: "127.0.0.1",
          port,
          path: target,
          headers: {
            Connection: "Upgrade",
            Upgrade: "websocket",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version": "13",
          },
        });
        req.on("upgrade", (_res, socket) => {
          socket.destroy();
          resolve("upgraded");
        });
        req.on("response", () => {
          resolve("refused");
        });
        req.on("error", () => {
          resolve("refused");
        });
        req.on("close", () => {
          resolve("refused");
        });
        req.setTimeout(2_000, () => {
          req.destroy();
          reject(new Error("timed out"));
        });
        req.end();
      });

    for (const target of ["//%zz/ws", "//%", "/ws?auction=%zz", "/nope"]) {
      expect(await attempt(target)).toBe("refused");
    }
    // Still alive and still serving after every one of them.
    const response = await built.server.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
  });

  it("an unticketed /ws upgrade is refused", async () => {
    built = makeServer(true);
    await built.server.listen({ port: 0, host: "127.0.0.1" });
    const { port } = built.server.server.address() as AddressInfo;
    const outcome = await new Promise<string>((resolve) => {
      const req = httpRequest({
        host: "127.0.0.1",
        port,
        path: "/ws?auction=a1&ticket=forged",
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version": "13",
        },
      });
      req.on("upgrade", (_res, socket) => {
        socket.destroy();
        resolve("upgraded");
      });
      req.on("response", () => {
        resolve("refused");
      });
      req.on("error", () => {
        resolve("refused");
      });
      req.on("close", () => {
        resolve("refused");
      });
      req.end();
    });
    expect(outcome).toBe("refused");
  });

  // REGRESSION (audit 2026-08-18, P0-2). commandId is the idempotency key, it
  // comes from the browser, and the engine's own timer commands lived in the
  // same namespace under ids derived from public snapshot fields. Pinning the
  // shape makes that namespace unreachable rather than merely unguessed.
  it("refuses command ids outside the shapes the transport is allowed to mint", async () => {
    built = makeServer(true);
    const server = built.server;
    const send = (commandId: string) =>
      server.inject({
        method: "POST",
        url: "/command",
        headers: { "x-engine-secret": "test-secret-123" },
        payload: { commandId, auctionId: "a", type: "PlaceBid", actor: "x", payload: {} },
      });

    // The exact shape of the engine's internal timer ids — the live exploit.
    const poison = await send("timer-close-01KYQ8214G1J6KWB86ZGCG7M2A-1787068480567");
    expect(poison.statusCode).toBe(400);
    expect(poison.json()).toMatchObject({ error: "invalid_command_id" });
    for (const bad of ["closing-lot-1", "", "../../etc", "a".repeat(200), "not a uuid"]) {
      expect((await send(bad)).statusCode).toBe(400);
    }

    // What real clients mint still passes: crypto.randomUUID() and newId().
    for (const good of ["0f9a1c2e-4b6d-4f8a-9c1e-2d3b4a5c6d7e", "01KYQ8214G1J6KWB86ZGCG7M2A"]) {
      const ok = await send(good);
      expect(ok.statusCode).toBe(200);
    }
  });

  // The engine self-actor attributes timer-driven writes to "engine" in the
  // audit trail (appendEvent stamps meta.source from it). The transport may
  // never claim it, or a secret-holder could forge engine-attributed history
  // for a human action and blame the timer for it after the fact.
  it("refuses a command claiming the engine's own actor", async () => {
    built = makeServer(true);
    const server = built.server;
    const post = (actor: string) =>
      server.inject({
        method: "POST",
        url: "/command",
        headers: { "x-engine-secret": "test-secret-123" },
        payload: {
          commandId: "0f9a1c2e-4b6d-4f8a-9c1e-2d3b4a5c6d7e",
          auctionId: "a",
          type: "PlaceBid",
          actor,
          payload: {},
        },
      });

    const forged = await post("00000000000000000000000000");
    expect(forged.statusCode).toBe(400);
    expect(forged.json()).toMatchObject({ error: "invalid_actor" });

    // A real person's actor still passes.
    expect((await post("01KYQ8214G1J6KWB86ZGCG7M2A")).statusCode).toBe(200);
  });

  // THE SCOPE IS INSIDE THE HMAC (audit 2026-08-18, P1-6). A ticket authorises
  // an auction AND an audience; if the scope were merely a query parameter the
  // engine's redaction would be advisory, which is exactly what the client-side
  // filter already was.
  it("ws tickets bind the money scope — a widened scope invalidates the ticket", () => {
    const t = 1_000_000_000_000;
    const bidder = wsTicket("auction-1", "s", t, "t:team-a");
    expect(wsTicketValid("auction-1", "s", bidder, t, "t:team-a")).toBe(true);
    // The whole attack: keep the ticket, ask for everyone's money.
    expect(wsTicketValid("auction-1", "s", bidder, t, "all")).toBe(false);
    // And the reverse: a conductor's ticket is not a bidder's.
    const conductor = wsTicket("auction-1", "s", t, "all");
    expect(wsTicketValid("auction-1", "s", conductor, t, "t:team-a")).toBe(false);
    // Scopes are distinct per audience.
    expect(wsTicket("auction-1", "s", t, "t:team-a")).not.toBe(
      wsTicket("auction-1", "s", t, "t:team-b"),
    );
  });

  it("parsePurseScope maps the wire token onto the audience", () => {
    expect(parsePurseScope("all")).toBeNull();
    expect(parsePurseScope("t:team-a")).toEqual(["team-a"]);
    expect(parsePurseScope("t:team-a+team-b")).toEqual(["team-a", "team-b"]);
    // An anonymous spectator: no teams, therefore no money.
    expect(parsePurseScope("t:")).toEqual([]);
    // Anything unrecognised is treated as the narrowest audience, not the widest.
    expect(parsePurseScope("nonsense")).toEqual([]);
  });

  it("ws tickets are windowed HMACs: deterministic within a window, distinct across auctions/secrets", () => {
    const t = 1_000_000_000_000;
    expect(wsTicket("auction-1", "s", t)).toBe(wsTicket("auction-1", "s", t));
    expect(wsTicket("auction-1", "s", t)).not.toBe(wsTicket("auction-2", "s", t));
    expect(wsTicket("auction-1", "s", t)).not.toBe(wsTicket("auction-1", "other", t));
    // A different window yields a different ticket — the lifetime is bounded.
    expect(wsTicket("auction-1", "s", t)).not.toBe(
      wsTicket("auction-1", "s", t + 2 * TICKET_WINDOW_MS),
    );
  });

  it("ws ticket lifetime (MIN-2): current + previous window accepted; older/forged rejected", () => {
    const t = 1_000_000_000_000;
    const fresh = wsTicket("auction-1", "s", t);
    expect(wsTicketValid("auction-1", "s", fresh, t)).toBe(true);
    // Grace: a ticket minted just before a boundary still works one window on.
    expect(wsTicketValid("auction-1", "s", fresh, t + TICKET_WINDOW_MS)).toBe(true);
    // Bounded: two windows on, the ticket is dead (was infinite before the fix).
    expect(wsTicketValid("auction-1", "s", fresh, t + 2 * TICKET_WINDOW_MS)).toBe(false);
    // Forged and wrong-secret tickets are refused.
    expect(wsTicketValid("auction-1", "s", "forged", t)).toBe(false);
    expect(wsTicketValid("auction-1", "s", wsTicket("auction-1", "other", t), t)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE ENGINE CORE'S OWN MEMORY (audit 2026-08-26).
//
// Everything below exercises the parts of the engine that decide BEFORE any row
// is touched: the per-actor meter, the key the ack cache is built on, and the
// residency sweep. The live-engine integration suite owns behaviour against
// real Postgres; these own the arithmetic that suite cannot express — a burst
// exceeded, two actors colliding on one command id, an auction going quiet for
// a day — and they run in microseconds because the database here is a fixture.
// ---------------------------------------------------------------------------

const AUCTION_ID = "01KYQ8214G1J6KWB86ZGCG7M2A";
const ACTOR_A = "01KYQ8214G1J6KWB86ZGCG7M2B";
const ACTOR_B = "01KYQ8214G1J6KWB86ZGCG7M2C";
/** A wall-clock instant; the engine reads its clock through EngineDeps.nowMs. */
const T0 = 1_800_000_000_000;
const MINUTE = 60_000;

/** The drizzle calls the engine's read path makes, and nothing else. */
interface FakeQuery {
  from: (table: unknown) => FakeQuery;
  leftJoin: () => FakeQuery;
  where: () => FakeQuery;
  orderBy: () => FakeQuery;
  limit: () => FakeQuery;
  then: (resolve: (rows: unknown[]) => void) => void;
}

interface FakeDb {
  db: Db;
  /** Queries issued so far: a command refused before the queue reads none. */
  reads: () => number;
}

/**
 * An auction whose whole history is `types`, with no lot, bid or paddle rows —
 * so the fold and the row projections agree by construction and nothing halts.
 */
function eventLog(...types: readonly string[]): AuctionEventEnvelope[] {
  return types.map((type, index) => ({
    seq: index + 1,
    type,
    atMs: T0,
    actor: ACTOR_A,
    correlationId: AUCTION_ID,
    payload: {},
  }));
}

function fakeDb(status: AuctionStatus, events: AuctionEventEnvelope[]): FakeDb {
  let reads = 0;
  const auctionRow = {
    id: AUCTION_ID,
    orgId: "01KYQ8214G1J6KWB86ZGCG7M2D",
    competitionId: "01KYQ8214G1J6KWB86ZGCG7M2E",
    name: "Fixture Auction",
    status,
    config: DEFAULT_AUCTION_CONFIG,
  };
  const rowsFor = (table: unknown): unknown[] => {
    if (table === auctions) {
      return [auctionRow];
    }
    if (table === auctionEvents) {
      return [...events];
    }
    return [];
  };
  const db = {
    select: (): FakeQuery => {
      let rows: unknown[] = [];
      const query: FakeQuery = {
        from: (table: unknown) => {
          reads += 1;
          rows = rowsFor(table);
          return query;
        },
        leftJoin: () => query,
        where: () => query,
        orderBy: () => query,
        limit: () => query,
        then: (resolve: (value: unknown[]) => void) => {
          resolve(rows);
        },
      };
      return query;
    },
  };
  return { db: db as unknown as Db, reads: () => reads };
}

function harness(
  options: {
    status?: AuctionStatus;
    events?: readonly string[];
    rateBurst?: number;
    rateRefillPerSec?: number;
  } = {},
) {
  const clock = { nowMs: T0 };
  const broadcasts: number[] = [];
  const fake = fakeDb(
    options.status ?? "scheduled",
    eventLog(...(options.events ?? ["AuctionCreated"])),
  );
  const engine = new AuctionEngine({
    db: fake.db,
    logger: silentLogger,
    onSnapshot: (_auctionId, _serialized, version) => {
      broadcasts.push(version);
    },
    nowMs: () => clock.nowMs,
    ...(options.rateBurst === undefined ? {} : { rateBurst: options.rateBurst }),
    ...(options.rateRefillPerSec === undefined
      ? {}
      : { rateRefillPerSec: options.rateRefillPerSec }),
  });
  return { engine, clock, broadcasts, fake };
}

function command(
  type: AuctionCommandEnvelope["type"],
  actor: string,
  commandId: string,
  extra: { conduct?: boolean; payload?: Record<string, unknown> } = {},
): AuctionCommandEnvelope {
  return {
    commandId,
    auctionId: AUCTION_ID,
    type,
    actor,
    conduct: extra.conduct ?? false,
    payload: extra.payload ?? {},
  };
}

describe("engine core — the per-actor meter", () => {
  // The token bucket has been on the command path since the 2026-08-18 audit
  // and nothing has ever asserted it — "rate_limited" appeared in no test in
  // the repository. This is that assertion.
  it("refuses past the burst, and the refusal costs no query and no broadcast", async () => {
    // A burst of two with no refill: the third command in the same instant is
    // over the line, deterministically and without waiting for a real second.
    const { engine, broadcasts, fake } = harness({ rateBurst: 2, rateRefillPerSec: 0 });

    const first = await engine.submit(command("QueueLots", ACTOR_A, "cmd-1", { conduct: true }));
    const second = await engine.submit(command("QueueLots", ACTOR_A, "cmd-2", { conduct: true }));
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(broadcasts).toHaveLength(2);
    const readsBeforeRefusal = fake.reads();

    const refused = await engine.submit(command("QueueLots", ACTOR_A, "cmd-3", { conduct: true }));
    expect(refused).toMatchObject({ commandId: "cmd-3", accepted: false, reason: "rate_limited" });
    // METERED BEFORE THE QUEUE — the whole point of the limit. The refusal read
    // no row, folded no log, broadcast to nobody, and never took a place in
    // front of somebody else's bid.
    expect(fake.reads()).toBe(readsBeforeRefusal);
    expect(broadcasts).toHaveLength(2);

    // And it is per ACTOR: the spammer's neighbour is untouched by it.
    const neighbour = await engine.submit(
      command("QueueLots", ACTOR_B, "cmd-4", { conduct: true }),
    );
    expect(neighbour.accepted).toBe(true);
  });

  it("reclaims an idle actor's bucket, and hands back exactly the meter a restart would", async () => {
    const { engine, clock } = harness({ rateBurst: 5, rateRefillPerSec: 10 });
    await engine.submit(command("QueueLots", ACTOR_A, "cmd-1", { conduct: true }));
    expect(engine.residency()).toMatchObject({ buckets: 1, evictedBuckets: 0 });

    // A sweep runs, but a bucket touched a minute ago is not idle.
    clock.nowMs = T0 + MINUTE;
    engine.tick();
    expect(engine.residency()).toMatchObject({ buckets: 1, evictedBuckets: 0 });

    // Eleven minutes on it is untouched AND refilled to the full burst — which
    // is precisely the bucket `allow()` mints for an actor it has never seen,
    // so dropping it changes nothing except the memory it was holding.
    clock.nowMs = T0 + 11 * MINUTE;
    engine.tick();
    expect(engine.residency()).toMatchObject({ buckets: 0, evictedBuckets: 1 });

    // Reclaiming is not weakening: the same actor is metered on the same terms.
    for (let i = 0; i < 5; i++) {
      const ack = await engine.submit(
        command("QueueLots", ACTOR_A, `after-${String(i)}`, { conduct: true }),
      );
      expect(ack.accepted).toBe(true);
    }
    const over = await engine.submit(
      command("QueueLots", ACTOR_A, "after-over", { conduct: true }),
    );
    expect(over).toMatchObject({ accepted: false, reason: "rate_limited" });
  });

  // REGRESSION (audit 2026-08-18, P0-2). The ack cache used to be keyed by the
  // command id alone, which made it a namespace shared by every participant and
  // the engine's own timer. The key is now (actor, commandId); nothing pinned
  // the cross-actor half of that until now.
  it("keys the ack cache by ACTOR: one actor's command id neither serves nor suppresses another's", async () => {
    const { engine, broadcasts } = harness();
    const sharedId = "0f9a1c2e-4b6d-4f8a-9c1e-2d3b4a5c6d7e";

    // The same actor, twice: the ORIGINAL ack comes back, byte for byte and
    // object for object, and the command does not run a second time.
    const first = await engine.submit(command("QueueLots", ACTOR_A, sharedId));
    expect(first).toMatchObject({ accepted: false, reason: "not_authorized" });
    const replayed = await engine.submit(command("QueueLots", ACTOR_A, sharedId));
    expect(replayed).toBe(first); // the cached object itself — never re-executed
    expect(broadcasts).toHaveLength(1);

    // A DIFFERENT actor, the same id: evaluated on its own merits. A conductor
    // is not answered with the refusal a bidder collected a moment earlier.
    const other = await engine.submit(command("QueueLots", ACTOR_B, sharedId, { conduct: true }));
    expect(other).toMatchObject({ accepted: true, reason: "queued:0" });
    expect(broadcasts).toHaveLength(2);

    // …and the collision did not evict or rewrite the first actor's ack either.
    const stillCached = await engine.submit(command("QueueLots", ACTOR_A, sharedId));
    expect(stillCached).toBe(first);
    expect(broadcasts).toHaveLength(2);
  });
});

describe("engine core — bounded residency", () => {
  const FINISHED = ["AuctionCreated", "AuctionOpened", "AuctionClosed"] as const;

  it("NEVER evicts a live auction, however long it sits quiet", async () => {
    const live = harness({ status: "live", events: ["AuctionCreated", "AuctionOpened"] });
    const state = await live.engine.ensureAuction(AUCTION_ID);
    expect(state?.halted).toBeNull();
    expect(state?.snapshot?.auctionStatus).toBe("live");

    // A whole day of silence — a lull between lots, a paused stream, a stalled
    // conductor. None of it may cost the auction its state.
    live.clock.nowMs = T0 + 24 * 60 * MINUTE;
    live.engine.tick();
    expect(live.engine.snapshotOf(AUCTION_ID)).toBeDefined();
    expect(live.engine.residency()).toMatchObject({ auctions: 1, evictedAuctions: 0 });

    // A paused auction is mid-night too: the guard is terminal status, not idleness.
    const paused = harness({
      status: "paused",
      events: ["AuctionCreated", "AuctionOpened", "AuctionPaused"],
    });
    expect((await paused.engine.ensureAuction(AUCTION_ID))?.snapshot?.auctionStatus).toBe("paused");
    paused.clock.nowMs = T0 + 24 * 60 * MINUTE;
    paused.engine.tick();
    expect(paused.engine.snapshotOf(AUCTION_ID)).toBeDefined();
    expect(paused.engine.residency()).toMatchObject({ auctions: 1, evictedAuctions: 0 });
  });

  it("NEVER evicts an auction with a command in flight", async () => {
    const { engine, clock } = harness({ status: "completed", events: [...FINISHED] });
    await engine.ensureAuction(AUCTION_ID);
    clock.nowMs = T0 + 20 * MINUTE; // old enough to go, on age alone

    // `submit` counts the command synchronously, before its first await, so the
    // tick below runs at the exact instant a command is mid-flight.
    const inFlight = engine.submit(command("QueueLots", ACTOR_A, "cmd-1", { conduct: true }));
    engine.tick();
    expect(engine.snapshotOf(AUCTION_ID)).toBeDefined();
    expect(engine.residency()).toMatchObject({ auctions: 1, evictedAuctions: 0 });
    expect((await inFlight).accepted).toBe(true);

    // Drained, and quiet again for the TTL: the SAME auction the tick above
    // refused to evict now goes — so it was the queue depth that saved it.
    clock.nowMs = T0 + 40 * MINUTE;
    engine.tick();
    expect(engine.snapshotOf(AUCTION_ID)).toBeUndefined();
    expect(engine.residency()).toMatchObject({ auctions: 0, evictedAuctions: 1 });
  });

  it("evicts a finished, quiet auction — and the next touch rebuilds it byte for byte", async () => {
    const { engine, clock } = harness({ status: "completed", events: [...FINISHED] });
    const before = await engine.ensureAuction(AUCTION_ID);
    expect(before?.snapshot?.auctionStatus).toBe("completed");
    const serialized = before?.serialized ?? "";
    expect(serialized).not.toBe("");

    // Still watched: every join and diagnostics read goes through ensureAuction,
    // which is the touch that keeps a finished auction resident.
    clock.nowMs = T0 + 14 * MINUTE;
    engine.tick();
    await engine.ensureAuction(AUCTION_ID);
    clock.nowMs = T0 + 28 * MINUTE; // 14 minutes since that touch, not 28
    engine.tick();
    expect(engine.snapshotOf(AUCTION_ID)).toBeDefined();

    // Nobody has asked for a quarter of an hour: it goes.
    clock.nowMs = T0 + 44 * MINUTE;
    engine.tick();
    expect(engine.snapshotOf(AUCTION_ID)).toBeUndefined();
    expect(engine.residency()).toMatchObject({ auctions: 0, evictedAuctions: 1 });

    // THE INVARIANT the eviction rests on: it was equivalent to a restart. The
    // event log rebuilds the identical snapshot, down to the bytes on the wire.
    const rebuilt = await engine.ensureAuction(AUCTION_ID);
    expect(rebuilt?.halted).toBeNull();
    expect(rebuilt?.serialized).toBe(serialized);
  });

  it("keeps a HALTED auction whatever its status: a fail-closed halt is evidence", async () => {
    // Rows and events disagree — the auction row says completed, the log has
    // never been opened — so the load halts fail-closed.
    const { engine, clock } = harness({ status: "completed", events: ["AuctionCreated"] });
    const state = await engine.ensureAuction(AUCTION_ID);
    expect(state?.halted).toContain("projection_mismatch");

    clock.nowMs = T0 + 24 * 60 * MINUTE;
    engine.tick();
    expect(engine.snapshotOf(AUCTION_ID)?.halted).toContain("projection_mismatch");
    expect(engine.residency()).toMatchObject({ auctions: 1, evictedAuctions: 0 });
  });
});
