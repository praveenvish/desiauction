import Fastify from "fastify";
import { WebSocketServer } from "ws";
import { clientAddress } from "./client-address.js";
import { parseSubscription } from "./ticket.js";
import { createHub, type Reader } from "./hub.js";
import type { Env } from "./env.js";
export function createServer(env: Env, read: Reader, ready: () => Promise<boolean>) {
  const server = Fastify({
    logger: { redact: ["req.headers.authorization", "req.headers.cookie"] },
  });
  const hub = createHub(read, () => {
    server.log.error("live reader failed");
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const counts = new Map<string, number>();
  const alive = new WeakSet<object>();
  server.get("/healthz", () => ({ ok: true, version: env.APP_VERSION }));
  server.get("/readyz", async (_request, reply) => {
    try {
      if (await ready()) return { ok: true };
    } catch {
      /* Readiness fails closed on database errors. */
    }
    return reply.code(503).send({ ok: false });
  });
  server.server.on("upgrade", (request, socket, head) => {
    try {
      if (
        new URL(request.url ?? "/", "http://localhost").pathname !== "/live/ws" ||
        !request.headers.origin ||
        !env.LIVE_ALLOWED_ORIGINS.includes(request.headers.origin)
      ) {
        socket.destroy();
        return;
      }
      const ip = clientAddress(
        request.headers,
        request.socket.remoteAddress,
        env.TRUSTED_PROXY_COUNT,
      );
      if (wss.clients.size >= env.LIVE_MAX_SOCKETS) {
        socket.destroy();
        return;
      }
      // No trustworthy address: skip the per-client cap rather than lumping
      // every such client under one "" key (client-address.ts); the per-room
      // cap still holds.
      if (ip !== "" && (counts.get(ip) ?? 0) >= 20) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        if (ip !== "") counts.set(ip, (counts.get(ip) ?? 0) + 1);
        alive.add(ws);
        let leave: (() => void) | undefined;
        const deadline = setTimeout(() => {
          ws.close(1008);
        }, 10000);
        deadline.unref();
        ws.on("error", () => {
          ws.terminate();
        });
        ws.on("pong", () => alive.add(ws));
        ws.on("message", (data, binary) => {
          const sub =
            !binary && !leave
              ? parseSubscription(
                  (Buffer.isBuffer(data)
                    ? data
                    : Array.isArray(data)
                      ? Buffer.concat(data)
                      : Buffer.from(data)
                  ).toString("utf8"),
                )
              : null;
          if (!sub) {
            ws.close(1008);
            return;
          }
          clearTimeout(deadline);
          leave = hub.join(
            sub.fixtureId,
            { ...(sub.gate.s ? { s: sub.gate.s } : {}), ...(sub.gate.t ? { t: sub.gate.t } : {}) },
            ws,
          );
        });
        ws.on("close", () => {
          clearTimeout(deadline);
          leave?.();
          if (ip !== "") {
            const n = (counts.get(ip) ?? 1) - 1;
            if (n) counts.set(ip, n);
            else counts.delete(ip);
          }
        });
      });
    } catch {
      socket.destroy();
    }
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) ws.terminate();
      else {
        alive.delete(ws);
        ws.ping();
      }
    }
  }, 20000);
  heartbeat.unref();
  const release = setInterval(() => {
    hub.refresh();
  }, 2000);
  release.unref();
  server.addHook("preClose", (done) => {
    clearInterval(heartbeat);
    clearInterval(release);
    hub.close();
    for (const ws of wss.clients) ws.terminate();
    done();
  });
  server.addHook("onClose", async () => {
    await new Promise<void>((resolve) => {
      wss.close(() => {
        resolve();
      });
    });
  });
  return { server, hub };
}
