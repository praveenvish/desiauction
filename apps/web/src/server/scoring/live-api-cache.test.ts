import { expect, it, vi } from "vitest";
import { createLiveApiCache } from "./live-api-cache";

it("shares one load per key within the TTL, including concurrent callers", async () => {
  const cache = createLiveApiCache(1000);
  const load = vi.fn(() => Promise.resolve({ seq: 1 }));
  const burst = await Promise.all(
    Array.from({ length: 1000 }, () => cache.read("room|cup||live", load, 0)),
  );
  expect(load).toHaveBeenCalledTimes(1);
  expect(new Set(burst).size).toBe(1);
  await cache.read("room|cup||live", load, 999);
  expect(load).toHaveBeenCalledTimes(1);
  await cache.read("room|cup||live", load, 1000);
  expect(load).toHaveBeenCalledTimes(2);
  await cache.read("room|cup||scorecard", load, 1000);
  expect(load).toHaveBeenCalledTimes(3);
});

it("never serves a failed load and is a pass-through at 0", async () => {
  const cache = createLiveApiCache(1000);
  const failing = vi.fn(() => Promise.reject(new Error("db down")));
  await expect(cache.read("k", failing, 0)).rejects.toThrow("db down");
  await Promise.resolve();
  const ok = vi.fn(() => Promise.resolve(1));
  expect(await cache.read("k", ok, 1)).toBe(1);
  const off = createLiveApiCache(0);
  await off.read("k", ok, 0);
  await off.read("k", ok, 0);
  expect(ok).toHaveBeenCalledTimes(3);
  expect(off.size).toBe(0);
});

it("stays bounded under a flood of distinct tokens", async () => {
  const cache = createLiveApiCache(1000, 10);
  for (let i = 0; i < 25; i++)
    await cache.read(`room||token-${String(i)}|live`, () => Promise.resolve(i), 0);
  expect(cache.size).toBeLessThanOrEqual(10);
});
