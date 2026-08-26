import { createHmac, timingSafeEqual } from "node:crypto";

import type { HealthResponse } from "@desiauction/contracts";
import {
  isAuctionCommandType,
  isTransportCommandId,
  redactPurses,
  type AuctionCommandEnvelope,
  type AuctionSnapshot,
  type PurseScope,
} from "@desiauction/core";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { WebSocketServer, type WebSocket } from "ws";

import { ENGINE_ACTOR, type AuctionEngine } from "./engine-core.js";

// The engine transport (M-IP4-2). HTTP carries COMMANDS (from the web tier,
// authenticated by the shared secret — browsers never talk here directly);
// WebSockets carry SNAPSHOTS ONLY — never business logic, never timer logic,
// never rules. Clients converge on the broadcast AuctionSnapshot and render.

export interface ServerDeps {
  logger: FastifyBaseLogger;
  version: string;
  checkDb: () => Promise<boolean>;
  engine: AuctionEngine;
  engineSecret: string;
  nodeEnv: string;
  /** Browser origins allowed to open a spectate socket; [] = do not check. */
  allowedOrigins?: string[];
  maxSocketsPerRoom?: number;
  maxSocketsPerIp?: number;
}

/**
 * Spectator tickets: HMAC over (auctionId · time-window) — minted by the web
 * tier with the same secret. Windowing gives the ticket a BOUNDED lifetime (a
 * leaked ticket stops working within two windows) with no wire-format change —
 * the URL still carries a single hex string. MIN-2 remediation.
 */
export const TICKET_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The ticket now binds a MONEY SCOPE as well as an auction.
 *
 * `scope` is "all" for a conductor's board, or "t:<team ids, sorted, joined by
 * +>" for a bidder — and it is inside the HMAC, so a client cannot widen its
 * own by editing the query string. The engine redacts every purse outside the
 * scope before the frame leaves (P1-6); an unsigned scope would make that
 * redaction advisory, which is what the client-side filter already was.
 */
export function wsTicket(
  auctionId: string,
  secret: string,
  nowMs: number = Date.now(),
  scope = "all",
): string {
  const window = Math.floor(nowMs / TICKET_WINDOW_MS);
  return createHmac("sha256", secret)
    .update(`${auctionId}.${String(window)}.${scope}`)
    .digest("hex");
}

/**
 * Fail-closed validity: a ticket is accepted for the current OR the immediately
 * previous window (grace for a ticket minted just before a boundary), so its
 * lifetime is bounded by two windows instead of forever.
 */
export function wsTicketValid(
  auctionId: string,
  secret: string,
  ticket: string,
  nowMs: number = Date.now(),
  scope = "all",
): boolean {
  return (
    safeEqual(ticket, wsTicket(auctionId, secret, nowMs, scope)) ||
    safeEqual(ticket, wsTicket(auctionId, secret, nowMs - TICKET_WINDOW_MS, scope))
  );
}

/** "all" → see every purse; "t:a+b" → see only those teams'. */
export function parsePurseScope(scope: string): PurseScope {
  if (scope === "all") {
    return null;
  }
  if (scope.startsWith("t:")) {
    return scope
      .slice(2)
      .split("+")
      .filter((id) => id !== "");
  }
  return [];
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

interface Room {
  sockets: Set<WebSocket>;
}

export interface WsHub {
  broadcast: (auctionId: string, serialized: string, version: number) => void;
  join: (auctionId: string, socket: WebSocket, remoteAddress?: string, scope?: PurseScope) => void;
  roomSize: (auctionId: string) => number;
  /** Open sockets currently attributed to one client address. */
  socketsFrom: (remoteAddress: string) => number;
  heartbeat: () => void;
  /** Millis since the last WS heartbeat sweep (diagnostics; 0 = never ran). */
  heartbeatAgeMs: () => number;
  close: () => void;
}

export function createWsHub(engine: AuctionEngine, logger: FastifyBaseLogger): WsHub {
  const rooms = new Map<string, Room>();
  const alive = new WeakMap<WebSocket, boolean>();
  // Per-address socket counts, so one client cannot open sockets without end.
  // Decremented on close; the WeakMap remembers which address to credit back.
  const perIp = new Map<string, number>();
  const addressOf = new WeakMap<WebSocket, string>();
  // Each socket's money scope. null = every purse (a conductor's board).
  const scopeOf = new WeakMap<WebSocket, PurseScope>();
  let lastHeartbeatAtMs = 0;

  // A snapshot frame is a few KB. Anything an order of magnitude past that is
  // either a bug or an attempt to grow the send buffer without bound.
  const SLOW_CONSUMER_BYTES = 4 * 1024 * 1024;

  const envelope = (serialized: string, version: number): string =>
    // serverNowMs lives on the TRANSPORT envelope (drift correction), never in
    // the snapshot — the snapshot bytes stay deterministic.
    `{"kind":"snapshot","serverNowMs":${String(Date.now())},"version":${String(version)},"snapshot":${serialized}}`;

  /**
   * A stable key for a socket's money scope, so one redaction is computed per
   * DISTINCT audience per broadcast rather than per socket. A room is a
   * conductor plus a handful of owners, so this is a handful of keys.
   */
  const scopeKey = (scope: PurseScope): string =>
    scope === null ? "all" : [...scope].sort().join("+");

  /**
   * Redact the CANONICAL snapshot for one audience and serialize it for the
   * wire. `state.serialized` is never touched: it is what the engine hashes and
   * byte-compares to prove determinism, so the redaction lives here, at the
   * transport, and applies to the frame only.
   */
  const frameFor = (serialized: string, version: number, scope: PurseScope): string => {
    if (scope === null) {
      return envelope(serialized, version);
    }
    const snapshot = JSON.parse(serialized) as AuctionSnapshot;
    return envelope(JSON.stringify(redactPurses(snapshot, scope)), version);
  };

  return {
    broadcast(auctionId, serialized, version) {
      const room = rooms.get(auctionId);
      if (room === undefined) {
        return;
      }
      const frames = new Map<string, string>();
      for (const socket of room.sockets) {
        if (socket.readyState !== socket.OPEN) {
          continue;
        }
        // BACKPRESSURE. A client that stops reading (suspended laptop, dead
        // mobile radio) still has frames queued at it every command; without
        // this the send buffer is unbounded process memory owned by whoever
        // stops reading fastest.
        if (socket.bufferedAmount > SLOW_CONSUMER_BYTES) {
          logger.warn({ auctionId, buffered: socket.bufferedAmount }, "slow consumer — closing");
          socket.terminate();
          room.sockets.delete(socket);
          continue;
        }
        const scope = scopeOf.get(socket) ?? null;
        const key = scopeKey(scope);
        let frame = frames.get(key);
        if (frame === undefined) {
          frame = frameFor(serialized, version, scope);
          frames.set(key, frame);
        }
        socket.send(frame);
      }
    },
    socketsFrom(remoteAddress) {
      return perIp.get(remoteAddress) ?? 0;
    },
    join(auctionId, socket, remoteAddress, scope = null) {
      const room = rooms.get(auctionId) ?? { sockets: new Set<WebSocket>() };
      scopeOf.set(socket, scope);
      room.sockets.add(socket);
      rooms.set(auctionId, room);
      alive.set(socket, true);
      if (remoteAddress !== undefined) {
        addressOf.set(socket, remoteAddress);
        perIp.set(remoteAddress, (perIp.get(remoteAddress) ?? 0) + 1);
      }
      socket.on("pong", () => alive.set(socket, true));
      // SNAPSHOTS ONLY, IN ONE DIRECTION. The engine has never had a message
      // handler, which meant client frames were accepted by the protocol layer
      // and silently buffered. A socket that talks is not a spectator.
      socket.on("message", () => {
        logger.warn({ auctionId }, "client sent a frame on a receive-only socket — closing");
        socket.close(1003, "receive-only");
      });
      socket.on("error", () => {
        socket.terminate();
      });
      socket.on("close", () => {
        room.sockets.delete(socket);
        const address = addressOf.get(socket);
        if (address !== undefined) {
          const next = (perIp.get(address) ?? 1) - 1;
          if (next <= 0) {
            perIp.delete(address);
          } else {
            perIp.set(address, next);
          }
        }
        if (room.sockets.size === 0) {
          rooms.delete(auctionId);
        }
      });
      // Snapshot replay on connect/reconnect: the full current state, versioned.
      const state = engine.snapshotOf(auctionId);
      if (state !== undefined && state.snapshot !== null) {
        socket.send(frameFor(state.serialized, state.version, scope));
      }
    },
    roomSize(auctionId) {
      return rooms.get(auctionId)?.sockets.size ?? 0;
    },
    heartbeatAgeMs() {
      return lastHeartbeatAtMs === 0 ? 0 : Date.now() - lastHeartbeatAtMs;
    },
    heartbeat() {
      lastHeartbeatAtMs = Date.now();
      for (const [auctionId, room] of rooms) {
        const state = engine.snapshotOf(auctionId);
        for (const socket of room.sockets) {
          if (alive.get(socket) === false) {
            logger.warn({ auctionId }, "heartbeat timeout — terminating socket");
            socket.terminate();
            room.sockets.delete(socket);
            continue;
          }
          alive.set(socket, false);
          socket.ping();
          if (socket.readyState === socket.OPEN) {
            socket.send(
              `{"kind":"heartbeat","serverNowMs":${String(Date.now())},"version":${String(state?.version ?? 0)}}`,
            );
          }
        }
      }
    },
    close() {
      for (const room of rooms.values()) {
        for (const socket of room.sockets) {
          socket.close(1001, "engine shutdown");
        }
      }
      rooms.clear();
    },
  };
}

export function buildServer(deps: ServerDeps): { server: FastifyInstance; hub: WsHub } {
  const server = Fastify({
    loggerInstance: deps.logger,
    disableRequestLogging: true,
  });
  const hub = createWsHub(deps.engine, deps.logger);

  server.get("/healthz", async (_request, reply) => {
    const dbOk = await deps.checkDb();
    const stalled = deps.engine.lastTickMs !== 0 && Date.now() - deps.engine.lastTickMs > 5_000;
    const body: HealthResponse = {
      status: dbOk && !stalled ? "ok" : "fail",
      version: deps.version,
      checks: { db: dbOk ? "ok" : "fail", watchdog: stalled ? "fail" : "ok" },
    };
    return reply.status(dbOk && !stalled ? 200 : 503).send(body);
  });

  /**
   * READINESS, as distinct from liveness.
   *
   * `/healthz` answers "is this process alive and is its watchdog ticking" —
   * the right question for a restart policy. A load balancer needs a different
   * one: "should this instance receive traffic yet". They differ for the whole
   * window after boot while the engine is still rehydrating auctions from the
   * event log, during which it is alive but not yet able to serve a correct
   * snapshot. The web tier has had /readyz since PX-11; the engine had no
   * equivalent, so a deploy could route commands at an instance mid-replay
   * (audit 2026-08-18, P2-10).
   */
  server.get("/readyz", async (_request, reply) => {
    const dbOk = await deps.checkDb();
    const ticking = deps.engine.lastTickMs !== 0 && Date.now() - deps.engine.lastTickMs <= 5_000;
    const ready = dbOk && ticking;
    return reply.status(ready ? 200 : 503).send({
      status: ready ? "ok" : "fail",
      version: deps.version,
      checks: { db: dbOk ? "ok" : "fail", watchdog: ticking ? "ok" : "fail" },
    });
  });

  // The command endpoint: web-tier only (shared secret). Every command gets a
  // deterministic Accepted/Rejected ack — no silent failures.
  server.post("/command", async (request, reply) => {
    const secret = request.headers["x-engine-secret"];
    if (typeof secret !== "string" || !safeEqual(secret, deps.engineSecret)) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const body = request.body as Partial<AuctionCommandEnvelope> | null;
    if (
      body === null ||
      typeof body !== "object" ||
      typeof body.commandId !== "string" ||
      typeof body.auctionId !== "string" ||
      typeof body.type !== "string" ||
      typeof body.actor !== "string" ||
      !isAuctionCommandType(body.type)
    ) {
      return reply.status(400).send({ error: "invalid_command" });
    }
    // The idempotency key must be one the transport is allowed to choose, so
    // it can never address the engine's internal timer namespace (P0-2).
    if (!isTransportCommandId(body.commandId)) {
      return reply.status(400).send({ error: "invalid_command_id" });
    }
    // The engine self-actor attributes timer-driven writes to "engine" in the
    // audit trail. The transport may never claim it, or a secret-holder could
    // forge engine-attributed history for a human action.
    if (body.actor === ENGINE_ACTOR) {
      return reply.status(400).send({ error: "invalid_actor" });
    }
    const ack = await deps.engine.submit({
      commandId: body.commandId,
      auctionId: body.auctionId,
      type: body.type,
      actor: body.actor,
      conduct: body.conduct === true,
      override: body.override === true,
      payload: body.payload ?? {},
    });
    return reply.status(200).send(ack);
  });

  // Read-only diagnostics (M-IP4-3): the recovery dashboard's feed. Web-tier
  // only (shared secret) — spectators can NEVER reach engine internals.
  server.get("/diagnostics/:auctionId", async (request, reply) => {
    const secret = request.headers["x-engine-secret"];
    if (typeof secret !== "string" || !safeEqual(secret, deps.engineSecret)) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const { auctionId } = request.params as { auctionId: string };
    const state = await deps.engine.ensureAuction(auctionId);
    if (state === null) {
      return reply.status(404).send({ error: "unknown_auction" });
    }
    const diagnostics = deps.engine.diagnosticsOf(auctionId);
    return reply.status(200).send({
      ...diagnostics,
      connectedClients: hub.roomSize(auctionId),
      wsHeartbeatAgeMs: hub.heartbeatAgeMs(),
      serverNowMs: Date.now(),
    });
  });

  server.get("/snapshot/:auctionId", async (request, reply) => {
    const secret = request.headers["x-engine-secret"];
    if (typeof secret !== "string" || !safeEqual(secret, deps.engineSecret)) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const { auctionId } = request.params as { auctionId: string };
    const state = await deps.engine.ensureAuction(auctionId);
    if (state === null) {
      return reply.status(404).send({ error: "unknown_auction" });
    }
    if (state.snapshot === null || state.halted !== null) {
      return reply.status(409).send({ error: "halted", reason: state.halted });
    }
    return reply.status(200).header("content-type", "application/json").send(state.serialized);
  });

  // Ops/test surface: drop in-memory state ≙ process restart (state rebuilds
  // from the event log on next touch). Never available in production.
  server.post("/admin/reset", async (request, reply) => {
    if (deps.nodeEnv === "production") {
      return reply.status(404).send({ error: "not_found" });
    }
    const secret = request.headers["x-engine-secret"];
    if (typeof secret !== "string" || !safeEqual(secret, deps.engineSecret)) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const body = request.body as { auctionId?: string } | null;
    deps.engine.reset(body?.auctionId);
    return reply.status(200).send({ ok: true });
  });

  // A spectate frame is a few KB; nothing legitimate arrives here at all, since
  // the socket is receive-only. `ws` defaults to a 100 MiB ceiling, which it
  // buffers before telling anyone — that is a memory-exhaustion budget handed
  // to any holder of a ticket.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
  const allowedOrigins = deps.allowedOrigins ?? [];
  const maxPerRoom = deps.maxSocketsPerRoom ?? 2_000;
  const maxPerIp = deps.maxSocketsPerIp ?? 50;

  server.server.on("upgrade", (request, socket, head) => {
    // EVERY PATH OUT OF HERE MUST BE A `socket.destroy()`, NEVER A THROW.
    //
    // This handler runs on Node's raw 'upgrade' event, outside Fastify's error
    // handling, and the process turns any uncaught exception into exit(1)
    // (index.ts — "a dead process is safer than a lying one"). That is the
    // right posture for a corrupted single writer and exactly the wrong one
    // here: `new URL()` throws on request targets Node's HTTP parser happily
    // accepts (`//%zz/ws`, `http://[::1`), so one malformed line from any
    // unauthenticated client killed the auction runtime mid-auction. Audited
    // 2026-08-18; reproduced from healthy to connection-refused in one request.
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname !== "/ws") {
        socket.destroy();
        return;
      }
      const origin = request.headers.origin;
      if (allowedOrigins.length > 0 && (origin === undefined || !allowedOrigins.includes(origin))) {
        socket.destroy();
        return;
      }
      const auctionId = url.searchParams.get("auction") ?? "";
      const ticket = url.searchParams.get("ticket") ?? "";
      // The scope travels in the clear but is INSIDE the HMAC, so editing it
      // invalidates the ticket. Absent means "all", which keeps every existing
      // conductor link working.
      const scopeParam = url.searchParams.get("scope") ?? "all";
      if (
        auctionId === "" ||
        !wsTicketValid(auctionId, deps.engineSecret, ticket, Date.now(), scopeParam)
      ) {
        socket.destroy();
        return;
      }
      const purseScope = parsePurseScope(scopeParam);
      if (hub.roomSize(auctionId) >= maxPerRoom) {
        deps.logger.warn({ auctionId }, "auction room at capacity — refusing socket");
        socket.destroy();
        return;
      }
      const remoteAddress = request.socket.remoteAddress ?? "";
      if (remoteAddress !== "" && hub.socketsFrom(remoteAddress) >= maxPerIp) {
        deps.logger.warn({ remoteAddress }, "client at socket capacity — refusing socket");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        void deps.engine
          .ensureAuction(auctionId)
          .then(() => {
            hub.join(auctionId, ws, remoteAddress, purseScope);
          })
          .catch((error: unknown) => {
            // An auction that cannot be loaded is not a reason to take the
            // process down either — it is a reason to refuse this one socket.
            deps.logger.error({ err: error, auctionId }, "ws join failed — closing socket");
            ws.close(1011, "unavailable");
          });
      });
    } catch (error) {
      deps.logger.warn({ err: error, target: request.url }, "malformed upgrade request — refused");
      socket.destroy();
    }
  });

  server.addHook("onClose", (_instance, done) => {
    hub.close();
    wss.close(() => {
      done();
    });
  });

  return { server, hub };
}
