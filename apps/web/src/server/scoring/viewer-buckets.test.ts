import { expect, it, vi } from "vitest";
import { ViewerBuckets } from "./viewer-buckets";
const identity = { fixtureId: "fixture", orgId: "org" };
it("retains cumulative counts when a delayed ping completes during a flush", async () => {
  let release = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const counts: number[] = [];
  const buckets = new ViewerBuckets(async (_identity, _proofs, count) => {
    counts.push(count);
    if (counts.length === 1) await waiting;
    return true;
  }, false);
  buckets.record(identity, {}, 1000, "viewer-a");
  const flushing = buckets.flush(61000);
  buckets.record(identity, {}, 1000, "viewer-b");
  release();
  await flushing;
  await buckets.flush(121000);
  expect(counts).toEqual([1, 2]);
});
it("bounds failed retries and discards expired buckets", async () => {
  const persist = vi.fn(() => Promise.reject(new Error("Unavailable")));
  const buckets = new ViewerBuckets(persist, false);
  buckets.record(identity, {}, 1000, "viewer-a");
  for (const at of [61000, 121000, 181000, 241000]) await buckets.flush(at);
  expect(persist).toHaveBeenCalledTimes(3);
  buckets.record(identity, {}, 1000, "viewer-a");
  await buckets.flush(361000);
  expect(persist).toHaveBeenCalledTimes(3);
});
it("bounds fixture buckets and retained proofs while keeping the active minute pending", async () => {
  const persist = vi.fn(() => Promise.resolve(true));
  const buckets = new ViewerBuckets(persist, false);
  for (let i = 0; i < 2050; i++)
    buckets.record({ ...identity, fixtureId: String(i) }, {}, 1000, "viewer-0");
  for (let i = 0; i < 12; i++)
    buckets.record(
      { ...identity, fixtureId: "2049" },
      { t: String(i) },
      1000,
      `viewer-${String(i + 1)}`,
    );
  await buckets.flush(59000);
  expect(persist).not.toHaveBeenCalled();
  await buckets.flush(61000);
  expect(persist).toHaveBeenCalledTimes(2048);
  const last = persist.mock.calls.at(-1) as unknown as [unknown, unknown[], number];
  expect(last[1]).toHaveLength(8);
  expect(last[2]).toBe(13);
});

it("counts a viewer once a minute however often it pings, and distinct viewers separately", async () => {
  const counts: number[] = [];
  const persist = vi.fn((...args: [unknown, unknown, number]) => {
    counts.push(args[2]);
    return Promise.resolve(true);
  });
  const buckets = new ViewerBuckets(persist, false);
  for (let i = 0; i < 15; i++) buckets.record(identity, {}, 1000, "same-client");
  await buckets.flush(61000);
  expect(counts.at(-1)).toBe(1);
  for (let i = 0; i < 15; i++) buckets.record(identity, {}, 61000, `client-${String(i)}`);
  await buckets.flush(121000);
  expect(counts.at(-1)).toBe(15);
});
