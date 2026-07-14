// Runs against a real Postgres: docker compose locally, service container in
// CI (IP-0_DESIGN §22). DATABASE_URL is injected by vitest.config.ts.
import { healthResponseSchema } from "@desiauction/contracts";
import { pino } from "pino";
import { WebSocket } from "ws";
import { afterAll, describe, expect, it } from "vitest";

import { checkDb, db, sql } from "../db.js";
import { AuctionEngine } from "../engine-core.js";
import { buildServer } from "../server.js";

const logger = pino({ level: "silent" });
const engine = new AuctionEngine({ db, logger, onSnapshot: () => undefined });
const { server } = buildServer({
  logger,
  version: "integration",
  checkDb,
  engine,
  engineSecret: "integration-secret",
  nodeEnv: "test",
});

afterAll(async () => {
  await server.close();
  await sql.end();
});

describe("engine against real Postgres", () => {
  it("healthz reports ok through a live connection", async () => {
    const response = await server.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json()).checks["db"]).toBe("ok");
  });

  it("ws refuses a bad ticket (transport auth is fail-closed)", async () => {
    await server.listen({ host: "127.0.0.1", port: 0 });
    const address = server.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a bound socket address");
    }
    const ws = new WebSocket(
      `ws://127.0.0.1:${String(address.port)}/ws?auction=nope&ticket=forged`,
    );
    const refused = await new Promise<boolean>((resolve) => {
      ws.on("open", () => {
        resolve(false);
      });
      ws.on("error", () => {
        resolve(true);
      });
      ws.on("close", () => {
        resolve(true);
      });
    });
    expect(refused).toBe(true);
  });
});
