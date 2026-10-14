import type { PublicPlacementState } from "@desiauction/core/scoring";
import { once } from "node:events";
import { expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createServer } from "../server.js";
import { parseEnv } from "../env.js";
import { state } from "../test-state.js";
const env = parseEnv({
  SYSTEM_DATABASE_URL: "postgres://desiauction_system:test@127.0.0.1:15437/ls1_c29_clean",
  LIVE_ALLOWED_ORIGINS: "https://allowed.test",
});
const gate = { t: "sub", fixtureId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", gate: { s: "cup" } };
it("health/readiness, exact origin/path, socket cap, gated snapshot and 1KiB ceiling", async () => {
  const read = vi.fn(() => Promise.resolve({ allowed: true, live: state() }));
  let ready = false;
  const app = createServer(env, read, () => Promise.resolve(ready));
  const clients: WebSocket[] = [];
  try {
    expect((await app.server.inject({ url: "/healthz" })).statusCode).toBe(200);
    expect((await app.server.inject({ url: "/readyz" })).statusCode).toBe(503);
    ready = true;
    expect((await app.server.inject({ url: "/readyz" })).statusCode).toBe(200);
    const address = await app.server.listen({ host: "127.0.0.1", port: 0 });
    const target = address.replace("http:", "ws:") + "/live/ws";
    const rejected = new WebSocket(target, { origin: "https://evil.test" });
    await expect(once(rejected, "open")).rejects.toThrow();
    const wrongPath = new WebSocket(target.replace("/live/ws", "/ws"), {
      origin: "https://allowed.test",
    });
    await expect(once(wrongPath, "open")).rejects.toThrow();
    const first = new WebSocket(target, { origin: "https://allowed.test" });
    clients.push(first);
    await once(first, "open");
    const frame = once(first, "message");
    first.send(JSON.stringify(gate));
    const raw: unknown = (await frame)[0];
    expect(JSON.parse(String(raw))).toMatchObject({ t: "live", live: { seq: 1 } });
    expect(read).toHaveBeenCalledWith(gate.fixtureId, gate.gate);
    for (let i = 1; i < 20; i++) {
      const ws = new WebSocket(target, { origin: "https://allowed.test" });
      clients.push(ws);
      await once(ws, "open");
    }
    const excess = new WebSocket(target, { origin: "https://allowed.test" });
    await expect(once(excess, "open")).rejects.toThrow();
    const second = clients[1];
    if (!second) throw new Error("Missing test socket");
    const closed = once(second, "close");
    second.send("x".repeat(1025));
    const code: unknown = (await closed)[0];
    expect(code).toBe(1009);
  } finally {
    for (const client of clients) client.terminate();
    await app.server.close();
  }
}, 15000);

it("skips the per-client cap when no trustworthy address exists, instead of lumping clients", async () => {
  const proxied = parseEnv({
    SYSTEM_DATABASE_URL: "postgres://desiauction_system:test@127.0.0.1:15437/ls1_c29_clean",
    LIVE_ALLOWED_ORIGINS: "https://allowed.test",
    TRUSTED_PROXY_COUNT: "1",
  });
  const app = createServer(
    proxied,
    () => Promise.resolve({ allowed: true, live: state() }),
    () => Promise.resolve(true),
  );
  const clients: WebSocket[] = [];
  try {
    const address = await app.server.listen({ host: "127.0.0.1", port: 0 });
    const target = address.replace("http:", "ws:") + "/live/ws";
    // No X-Forwarded-For behind a declared proxy: 21 sockets all open.
    for (let i = 0; i < 21; i++) {
      const ws = new WebSocket(target, { origin: "https://allowed.test" });
      clients.push(ws);
      await once(ws, "open");
    }
    // A forwarded client is still held to its own 20.
    for (let i = 0; i < 20; i++) {
      const ws = new WebSocket(target, {
        origin: "https://allowed.test",
        headers: { "x-forwarded-for": "203.0.113.7" },
      });
      clients.push(ws);
      await once(ws, "open");
    }
    const excess = new WebSocket(target, {
      origin: "https://allowed.test",
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    await expect(once(excess, "open")).rejects.toThrow();
  } finally {
    for (const client of clients) client.terminate();
    await app.server.close();
  }
}, 15000);

it("placement sockets preserve all squads, release only selected snapshots and close on revoked public access", async () => {
  const live: PublicPlacementState = {
    ...state(),
    family: "placement",
    teams: [
      { id: "one", name: "First squad", initials: "FS" },
      { id: "two", name: "Second squad", initials: "SS" },
      { id: "three", name: "Third squad", initials: "TS" },
    ],
    panel: {
      v: 1,
      round: 1,
      rounds: 2,
      rows: [
        { teamId: "one", placement: 1, points: 17, kills: 7 },
        { teamId: "two", placement: 2, points: 8, kills: 2 },
        { teamId: "three", placement: 3, points: 6, kills: 1 },
      ],
    },
  };
  let allowed = true;
  let released: PublicPlacementState | null = null;
  const read = vi.fn(() => Promise.resolve({ allowed, live: released }));
  const app = createServer(env, read, () => Promise.resolve(true));
  let client: WebSocket | undefined;
  try {
    const address = await app.server.listen({ host: "127.0.0.1", port: 0 });
    client = new WebSocket(address.replace("http:", "ws:") + "/live/ws", {
      origin: "https://allowed.test",
    });
    await once(client, "open");
    const initial = once(client, "message");
    client.send(JSON.stringify(gate));
    expect(JSON.parse(String((await initial)[0]))).toEqual({ t: "live", live: null });
    const next = once(client, "message");
    released = live;
    app.hub.notify(gate.fixtureId);
    const frame = String((await next)[0]);
    expect(JSON.parse(frame)).toEqual({ t: "live", live });
    expect(frame).not.toMatch(/playerKills|actorPersonId|clientRecordedAt|home|away/);
    const closed = once(client, "close");
    allowed = false;
    app.hub.notify(gate.fixtureId);
    expect((await closed)[0]).toBe(1008);
  } finally {
    client?.terminate();
    await app.server.close();
  }
}, 15000);
