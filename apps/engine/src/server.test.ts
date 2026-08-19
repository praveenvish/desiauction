import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";

import { healthResponseSchema } from "@desiauction/contracts";
import { pino } from "pino";
import { afterEach, describe, expect, it } from "vitest";

import type { AuctionEngine } from "./engine-core.js";
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
