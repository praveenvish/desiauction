import { healthResponseSchema } from "@desiauction/contracts";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";

import type { AuctionEngine } from "./engine-core.js";
import { buildServer, wsTicket, wsTicketValid, TICKET_WINDOW_MS } from "./server.js";

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
