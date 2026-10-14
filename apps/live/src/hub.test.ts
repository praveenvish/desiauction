import { expect, it, vi } from "vitest";
import { createHub } from "./hub.js";
import { state } from "./test-state.js";
import { parseSubscription } from "./ticket.js";
import { selectDelayedEntry, publicLiveProjection } from "@desiauction/core/scoring";
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
function peer() {
  return { send: vi.fn(), close: vi.fn(), bufferedAmount: 0 };
}
it("rechecks gates before each release and never leaks denied state", async () => {
  let allowed = true;
  const read = vi.fn(() => Promise.resolve({ allowed, live: state() }));
  const hub = createHub(read, vi.fn());
  const a = peer();
  hub.join("a", { t: "secret" }, a);
  await tick();
  expect(a.send).toHaveBeenCalledTimes(1);
  allowed = false;
  hub.notify("a");
  await tick();
  expect(a.close).toHaveBeenCalledWith(1008);
  expect(a.send).toHaveBeenCalledTimes(1);
  hub.close();
});
it("coalesces duplicate notifications, disconnects slow consumers and removes rooms", async () => {
  const live = state();
  const hub = createHub(() => Promise.resolve({ allowed: true, live }), vi.fn());
  const a = peer();
  const leave = hub.join("a", {}, a);
  await tick();
  for (let i = 0; i < 100; i++) hub.notify("a");
  await tick();
  expect(a.send).toHaveBeenCalledTimes(1);
  live.seq++;
  a.bufferedAmount = 100000;
  hub.refresh();
  await tick();
  expect(a.close).toHaveBeenCalledWith(1013);
  leave();
  hub.close();
});
it("reads once per proof per tick and fans the frame out to every holder", async () => {
  const live = state();
  const read = vi.fn(() => Promise.resolve({ allowed: true, live }));
  const hub = createHub(read, vi.fn());
  const peers = Array.from({ length: 500 }, () => peer());
  for (const p of peers) hub.join("room", { s: "cup" }, p);
  const ticketed = peer();
  hub.join("room", { t: "ticket" }, ticketed);
  await tick();
  read.mockClear();
  live.seq++;
  hub.refresh();
  await tick();
  expect(read).toHaveBeenCalledTimes(2);
  expect(peers.every((p) => p.send.mock.calls.length === 2)).toBe(true);
  expect(ticketed.send).toHaveBeenCalledTimes(2);
  hub.close();
});
it("isolates bearer proofs in the same room and closes pending readers on shutdown", async () => {
  const a = peer(),
    b = peer();
  const live = state(1, "2026-10-10T12:00:00.000Z");
  const hub = createHub(
    (_id, gate) => Promise.resolve({ allowed: gate.t === "right", live }),
    vi.fn(),
  );
  hub.join("a", { t: "wrong" }, a);
  hub.join("a", { t: "right" }, b);
  await tick();
  expect(a.send).not.toHaveBeenCalled();
  expect(b.send).toHaveBeenCalledTimes(1);
  hub.close();
  expect(b.close).toHaveBeenCalledWith(1001);
});
it("P3 is insertion-ordered, timestamp-validated, with no current fallback", () => {
  const current = { state: state(9) };
  const history = [
    { state: state(1), updatedAt: new Date(0).toISOString() },
    { state: state(2), updatedAt: "bad" },
    { state: state(3), updatedAt: new Date(2000).toISOString() },
  ];
  expect(selectDelayedEntry(current, history, "unverified", 60, 61000)?.state.seq).toBe(1);
  expect(selectDelayedEntry(current, [], "unverified", 60, 61000)).toBeUndefined();
  expect(selectDelayedEntry(current, history, "verified", 60, 61000)?.state.seq).toBe(9);
  expect(selectDelayedEntry(current, history, "unverified", 60, 62000)?.state.seq).toBe(3);
  const raw = { ...state(), privateToken: "secret", history };
  expect(publicLiveProjection(raw)).not.toHaveProperty("privateToken");
  expect(publicLiveProjection(raw)).not.toHaveProperty("history");
});
it("rejects oversized gates, invalid fixture ids, binary-shaped/unknown commands", () => {
  const base = { t: "sub", fixtureId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", gate: { s: "cup" } };
  expect(parseSubscription(JSON.stringify(base))).toEqual(base);
  expect(parseSubscription("bad")).toBeNull();
  expect(parseSubscription(JSON.stringify({ ...base, t: "ball" }))).toBeNull();
  expect(parseSubscription(JSON.stringify({ ...base, gate: { t: "x".repeat(129) } }))).toBeNull();
});

it("deduplicates canonical snapshots but publishes same-sequence representation changes only to allowed peers", async () => {
  const a = peer(),
    b = peer();
  let live = state(7, "2026-10-10T12:00:00.000Z");
  const pending: (() => void)[] = [];
  const read = vi.fn(
    (_id, gate: { t?: string }) =>
      new Promise<{ allowed: boolean; live: typeof live }>((resolve) => {
        const snapshot = structuredClone(live);
        pending.push(() => {
          resolve({ allowed: gate.t === "right", live: snapshot });
        });
      }),
  );
  // The reader is deliberately held. Resolve each awaited read, then let its
  // drain continuation run before checking for the next read: no wall clock.
  async function completeReads() {
    while (pending.length) {
      pending.shift()?.();
      await Promise.resolve();
    }
  }
  const hub = createHub(read, vi.fn());
  hub.join("fixture", { t: "wrong" }, a);
  hub.join("fixture", { t: "right" }, b);
  await completeReads();
  expect(a.send).not.toHaveBeenCalled();
  expect(a.close).toHaveBeenCalledWith(1008);
  expect(b.send).toHaveBeenCalledTimes(1);
  hub.notify("fixture");
  await completeReads();
  expect(b.send).toHaveBeenCalledTimes(1);
  live = { ...live, updatedAt: "2026-10-10T12:00:01.000Z" };
  hub.notify("fixture");
  await completeReads();
  expect(b.send).toHaveBeenCalledTimes(2);
  expect(JSON.parse(b.send.mock.calls.at(-1)?.[0] as string)).toMatchObject({
    live: { seq: 7, updatedAt: live.updatedAt },
  });
  hub.notify("fixture");
  await completeReads();
  expect(b.send).toHaveBeenCalledTimes(2);
  live = { ...live, trust: "confirmed" };
  hub.notify("fixture");
  await completeReads();
  expect(b.send).toHaveBeenCalledTimes(3);
  expect(JSON.parse(b.send.mock.calls.at(-1)?.[0] as string)).toMatchObject({
    live: { seq: 7, trust: "confirmed" },
  });
  hub.refresh();
  await completeReads();
  expect(b.send).toHaveBeenCalledTimes(3);
  expect(a.send).not.toHaveBeenCalled();
  hub.close();
  expect(b.close).toHaveBeenCalledWith(1001);
});

it("C51 raid clock context advances without duplicate frames; delay changes release a new context for identical facts", async () => {
  const live = { ...state(), family: "raid" as const };
  let serverAtMs = 100000,
    delayMs = 60000;
  const hub = createHub(
    () => Promise.resolve({ allowed: true, live, clock: { serverAtMs, delayMs } }),
    vi.fn(),
  );
  const a = peer();
  try {
    hub.join("raid", { s: "cup" }, a);
    await tick();
    expect(JSON.parse(String(a.send.mock.calls[0]?.[0]))).toMatchObject({
      clock: { serverAtMs: 100000, delayMs: 60000 },
      live: { seq: 1 },
    });
    serverAtMs += 1000;
    hub.refresh();
    await tick();
    expect(a.send).toHaveBeenCalledTimes(1);
    delayMs = 0;
    hub.refresh();
    await tick();
    expect(a.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(a.send.mock.calls[1]?.[0]))).toMatchObject({
      clock: { serverAtMs: 101000, delayMs: 0 },
      live: { seq: 1 },
    });
    expect(live.seq).toBe(1);
  } finally {
    hub.close();
  }
});

it("C53 timed clock context advances without duplicate frames; delay changes release a new context for identical facts", async () => {
  const live = { ...state(), family: "timed" as const };
  let serverAtMs = 100000,
    delayMs = 60000;
  const hub = createHub(
    () => Promise.resolve({ allowed: true, live, clock: { serverAtMs, delayMs } }),
    vi.fn(),
  );
  const a = peer();
  try {
    hub.join("timed", { s: "cup" }, a);
    await tick();
    expect(JSON.parse(String(a.send.mock.calls[0]?.[0]))).toMatchObject({
      clock: { serverAtMs: 100000, delayMs: 60000 },
      live: { seq: 1 },
    });
    serverAtMs += 1000;
    hub.refresh();
    await tick();
    expect(a.send).toHaveBeenCalledTimes(1);
    delayMs = 0;
    hub.refresh();
    await tick();
    expect(a.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(a.send.mock.calls[1]?.[0]))).toMatchObject({
      clock: { serverAtMs: 101000, delayMs: 0 },
      live: { seq: 1 },
    });
    expect(live.seq).toBe(1);
  } finally {
    hub.close();
  }
});
