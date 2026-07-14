import { createHmac, timingSafeEqual } from "node:crypto";

import type { HealthResponse } from "@desiauction/contracts";
import { isAuctionCommandType, type AuctionCommandEnvelope } from "@desiauction/core";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { WebSocketServer, type WebSocket } from "ws";

import type { AuctionEngine } from "./engine-core.js";

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
}

/**
 * Spectator tickets: HMAC over (auctionId · time-window) — minted by the web
 * tier with the same secret. Windowing gives the ticket a BOUNDED lifetime (a
 * leaked ticket stops working within two windows) with no wire-format change —
 * the URL still carries a single hex string. MIN-2 remediation.
 */
export const TICKET_WINDOW_MS = 24 * 60 * 60 * 1000;

export function wsTicket(auctionId: string, secret: string, nowMs: number = Date.now()): string {
  const window = Math.floor(nowMs / TICKET_WINDOW_MS);
  return createHmac("sha256", secret)
    .update(`${auctionId}.${String(window)}`)
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
): boolean {
  return (
    safeEqual(ticket, wsTicket(auctionId, secret, nowMs)) ||
    safeEqual(ticket, wsTicket(auctionId, secret, nowMs - TICKET_WINDOW_MS))
  );
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
  join: (auctionId: string, socket: WebSocket) => void;
  roomSize: (auctionId: string) => number;
  heartbeat: () => void;
  /** Millis since the last WS heartbeat sweep (diagnostics; 0 = never ran). */
  heartbeatAgeMs: () => number;
  close: () => void;
}

export function createWsHub(engine: AuctionEngine, logger: FastifyBaseLogger): WsHub {
  const rooms = new Map<string, Room>();
  const alive = new WeakMap<WebSocket, boolean>();
  let lastHeartbeatAtMs = 0;

  const envelope = (serialized: string, version: number): string =>
    // serverNowMs lives on the TRANSPORT envelope (drift correction), never in
    // the snapshot — the snapshot bytes stay deterministic.
    `{"kind":"snapshot","serverNowMs":${String(Date.now())},"version":${String(version)},"snapshot":${serialized}}`;

  return {
    broadcast(auctionId, serialized, version) {
      const room = rooms.get(auctionId);
      if (room === undefined) {
        return;
      }
      const frame = envelope(serialized, version);
      for (const socket of room.sockets) {
        if (socket.readyState === socket.OPEN) {
          socket.send(frame);
        }
      }
    },
    join(auctionId, socket) {
      const room = rooms.get(auctionId) ?? { sockets: new Set<WebSocket>() };
      room.sockets.add(socket);
      rooms.set(auctionId, room);
      alive.set(socket, true);
      socket.on("pong", () => alive.set(socket, true));
      socket.on("close", () => {
        room.sockets.delete(socket);
      });
      // Snapshot replay on connect/reconnect: the full current state, versioned.
      const state = engine.snapshotOf(auctionId);
      if (state !== undefined && state.snapshot !== null) {
        socket.send(envelope(state.serialized, state.version));
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

  const wss = new WebSocketServer({ noServer: true });
  server.server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    const auctionId = url.searchParams.get("auction") ?? "";
    const ticket = url.searchParams.get("ticket") ?? "";
    if (auctionId === "" || !wsTicketValid(auctionId, deps.engineSecret, ticket)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      void deps.engine.ensureAuction(auctionId).then(() => {
        hub.join(auctionId, ws);
      });
    });
  });

  server.addHook("onClose", (_instance, done) => {
    hub.close();
    wss.close(() => {
      done();
    });
  });

  return { server, hub };
}
