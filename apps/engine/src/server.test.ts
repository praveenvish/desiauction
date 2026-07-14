import { healthResponseSchema } from "@desiauction/contracts";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";

import type { AuctionEngine } from "./engine-core.js";
import { buildServer, wsTicket } from "./server.js";

const silentLogger = pino({ level: "silent" });

// A stub engine: the transport tests need shape, not behavior.
function stubEngine(): AuctionEngine {
  return {
    lastTickMs: 0,
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

function makeServer(dbOk: boolean) {
  return buildServer({
    logger: silentLogger,
    version: "test",
    checkDb: () => Promise.resolve(dbOk),
    engine: stubEngine(),
    engineSecret: "test-secret-123",
    nodeEnv: "test",
  });
}

describe("engine transport", () => {
  let built: ReturnType<typeof makeServer> | undefined;

  afterEach(async () => {
    await built?.server.close();
  });

  it("healthz returns 200 with a contract-valid body when checks pass", async () => {
    built = makeServer(true);
    const response = await built.server.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    const body = healthResponseSchema.parse(response.json());
    expect(body.status).toBe("ok");
    expect(body.checks["db"]).toBe("ok");
    expect(body.checks["watchdog"]).toBe("ok");
  });

  it("fails closed with 503 when the db check fails", async () => {
    built = makeServer(false);
    const response = await built.server.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(503);
    expect(healthResponseSchema.parse(response.json()).status).toBe("fail");
  });

  it("commands without the shared secret are 401; malformed commands are 400", async () => {
    built = makeServer(true);
    const noSecret = await built.server.inject({
      method: "POST",
      url: "/command",
      payload: { commandId: "c1", auctionId: "a", type: "PlaceBid", actor: "x" },
    });
    expect(noSecret.statusCode).toBe(401);
    const badType = await built.server.inject({
      method: "POST",
      url: "/command",
      headers: { "x-engine-secret": "test-secret-123" },
      payload: { commandId: "c1", auctionId: "a", type: "DeleteEverything", actor: "x" },
    });
    expect(badType.statusCode).toBe(400);
    const wellFormed = await built.server.inject({
      method: "POST",
      url: "/command",
      headers: { "x-engine-secret": "test-secret-123" },
      payload: { commandId: "c1", auctionId: "a", type: "PlaceBid", actor: "x", payload: {} },
    });
    expect(wellFormed.statusCode).toBe(200);
    expect(wellFormed.json()).toMatchObject({ accepted: false, reason: "unknown_auction" });
  });

  it("ws tickets are deterministic HMACs of the auction id", () => {
    expect(wsTicket("auction-1", "s")).toBe(wsTicket("auction-1", "s"));
    expect(wsTicket("auction-1", "s")).not.toBe(wsTicket("auction-2", "s"));
    expect(wsTicket("auction-1", "s")).not.toBe(wsTicket("auction-1", "other"));
  });
});
