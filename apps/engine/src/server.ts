import type { HealthResponse } from "@desiauction/contracts";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { WebSocketServer } from "ws";

export interface ServerDeps {
  logger: FastifyBaseLogger;
  version: string;
  checkDb: () => Promise<boolean>;
}

/**
 * Dependencies are injected so unit tests exercise the server without
 * infrastructure (§22). The ws endpoint is the deploy smoke target (§20).
 */
export function buildServer(deps: ServerDeps): FastifyInstance {
  const server = Fastify({
    loggerInstance: deps.logger,
    disableRequestLogging: false,
  });

  server.get("/healthz", async (_request, reply) => {
    const dbOk = await deps.checkDb();
    const body: HealthResponse = {
      status: dbOk ? "ok" : "fail",
      version: deps.version,
      checks: { db: dbOk ? "ok" : "fail" },
    };
    return reply.status(dbOk ? 200 : 503).send(body);
  });

  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (socket) => {
    socket.on("message", (data, isBinary) => {
      socket.send(data, { binary: isBinary });
    });
  });

  server.server.on("upgrade", (request, socket, head) => {
    if (request.url === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  server.addHook("onClose", (_instance, done) => {
    wss.close(() => {
      done();
    });
  });

  return server;
}
