import {
  publicLiveState,
  replayMatch,
  type PublicLiveState,
  type PublicScorecard,
  type PublicCharts,
} from "@desiauction/core/scoring";
import { afterEach, expect, it, vi } from "vitest";
import { LivePoll, pollDelay, stale } from "./live-poll";
const initial = (): PublicLiveState => ({
  ...publicLiveState(replayMatch([]), { teams: {}, players: {} }),
  phase: "live",
  seq: 5,
});
afterEach(() => {
  vi.useRealTimers();
});
it("calls browser fetch without a class receiver", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(function (this: unknown) {
    if (this !== undefined) throw new TypeError("Illegal invocation");
    return Promise.resolve(Response.json({ ...initial(), seq: 6 }));
  });
  const poll = new LivePoll("/live", initial(), vi.fn(), fetcher);
  poll.start(true);
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(poll.observation.state?.seq).toBe(6);
  expect(poll.observation.failures).toBe(0);
  poll.stop();
});
it("polls visible live play every two seconds, hidden play every fifteen, and final never", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(() => Promise.resolve(new Response(null, { status: 304 })));
  const publish = vi.fn();
  const poll = new LivePoll("/live", initial(), publish, fetcher);
  poll.start(true);
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetcher).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]).toEqual([
    "/live",
    expect.objectContaining({ headers: { "If-None-Match": '"5-self_scored"' } }),
  ]);
  poll.visibility(false);
  await vi.advanceTimersByTimeAsync(14999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
  poll.stop();
  const final = new LivePoll("/live", { ...initial(), phase: "final" }, publish, fetcher);
  final.start(true);
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  final.stop();
  expect(pollDelay(null, true, 0)).toBe(15000);
  expect(pollDelay({ ...initial(), phase: "finished" }, true, 0)).toBeNull();
  expect(pollDelay({ ...initial(), phase: "innings_break" }, true, 0)).toBe(15000);
});
it("loads a final scorecard once without a lean validator and then uses paired representation validators", async () => {
  vi.useFakeTimers();
  const live = { ...initial(), phase: "finished" as const };
  const scorecard: PublicScorecard = { v: 1, seq: live.seq, ballsPerOver: 6, innings: [] };
  const fetcher = vi.fn(() => Promise.resolve(Response.json({ live, scorecard })));
  const publish = vi.fn();
  const poll = new LivePoll("/live?view=scorecard", live, publish, fetcher, Date.now, true);
  poll.start(true, true);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher.mock.calls[0]).toEqual([
    "/live?view=scorecard",
    expect.objectContaining({ headers: {} }),
  ]);
  expect(publish).toHaveBeenCalledWith(expect.objectContaining({ state: live, scorecard }));
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  poll.stop();
});
it("rejects a mismatched scorecard without publishing its newer score", async () => {
  vi.useFakeTimers();
  const live = { ...initial(), seq: 6 };
  const scorecard: PublicScorecard = { v: 1, seq: 7, ballsPerOver: 6, innings: [] };
  const fetcher = vi.fn(() => Promise.resolve(Response.json({ live, scorecard })));
  const poll = new LivePoll("/live?view=scorecard", initial(), vi.fn(), fetcher, Date.now, true);
  poll.start(true, true);
  await vi.advanceTimersByTimeAsync(0);
  expect(poll.observation.state?.seq).toBe(5);
  expect(poll.observation.scorecard).toBeUndefined();
  expect(poll.observation.failures).toBe(1);
  poll.stop();
});
it("backoffs after failures, shows reconnecting after two, resets on304 without resetting stale age", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue(new Response(null, { status: 304 }));
  const publish = vi.fn();
  const poll = new LivePoll("/live", initial(), publish, fetcher);
  poll.start(true);
  await vi.advanceTimersByTimeAsync(2000);
  expect(poll.observation.failures).toBe(1);
  await vi.advanceTimersByTimeAsync(3999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(poll.observation.failures).toBe(2);
  await vi.advanceTimersByTimeAsync(8000);
  expect(poll.observation.failures).toBe(0);
  expect(stale(poll.observation, poll.observation.changedAt + 59999)).toBe(false);
  expect(stale(poll.observation, poll.observation.changedAt + 60000)).toBe(true);
  expect(pollDelay(initial(), true, 20)).toBe(30000);
  poll.stop();
});
it("updates in place with selected seq validators and resets stale age only for a new seq", async () => {
  vi.useFakeTimers();
  const next = { ...initial(), seq: 6 };
  const final = { ...next, seq: 7, phase: "final" as const, result: "Royals won by 6 wickets" };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(next))
    .mockResolvedValueOnce(Response.json(final));
  const publish = vi.fn();
  const poll = new LivePoll("/live", initial(), publish, fetcher);
  poll.start(true);
  await vi.advanceTimersByTimeAsync(2000);
  expect(poll.observation.state?.seq).toBe(6);
  expect(poll.observation.changedAt).toBe(Date.now());
  await vi.advanceTimersByTimeAsync(2000);
  expect(poll.observation.state?.result).toBe(final.result);
  expect(fetcher.mock.calls[1]).toEqual([
    "/live",
    expect.objectContaining({ headers: { "If-None-Match": '"6-self_scored"' } }),
  ]);
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  poll.stop();
});
it("does not overlap a slow request or publish after teardown", async () => {
  vi.useFakeTimers();
  let finish: ((response: Response) => void) | undefined;
  const fetcher = vi.fn(
    (_url: RequestInfo | URL, options?: RequestInit) =>
      new Promise<Response>((resolve) => {
        finish = resolve;
        expect(options?.signal?.aborted).toBe(false);
      }),
  );
  const publish = vi.fn();
  const poll = new LivePoll("/live", initial(), publish, fetcher);
  poll.start(true);
  await vi.advanceTimersByTimeAsync(2000);
  poll.visibility(false);
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  poll.stop();
  finish?.(Response.json({ ...initial(), seq: 6 }));
  await vi.advanceTimersByTimeAsync(0);
  expect(publish).not.toHaveBeenCalled();
});

it("loads final charts once without a lean validator", async () => {
  vi.useFakeTimers();
  const live = { ...initial(), phase: "finished" as const };
  const charts: PublicCharts = { v: 1, seq: live.seq, ballsPerOver: 6, innings: [] };
  const fetcher = vi.fn(() => Promise.resolve(Response.json({ live, charts })));
  const publish = vi.fn();
  const poll = new LivePoll(
    "/live?view=charts",
    live,
    publish,
    fetcher,
    Date.now,
    false,
    undefined,
    true,
  );
  poll.start(true, true);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher.mock.calls[0]).toEqual([
    "/live?view=charts",
    expect.objectContaining({ headers: {} }),
  ]);
  expect(publish).toHaveBeenCalledWith(expect.objectContaining({ state: live, charts }));
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  poll.stop();
});
it("uses charts validators only after publishing an atomic pair", async () => {
  vi.useFakeTimers();
  const live = { ...initial(), seq: 6 };
  const charts: PublicCharts = { v: 1, seq: 6, ballsPerOver: 6, innings: [] };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ live, charts }))
    .mockResolvedValue(new Response(null, { status: 304 }));
  const poll = new LivePoll(
    "/live?view=charts",
    initial(),
    vi.fn(),
    fetcher,
    Date.now,
    false,
    undefined,
    true,
  );
  poll.start(true, true);
  await vi.advanceTimersByTimeAsync(0);
  expect(poll.observation.state?.seq).toBe(6);
  expect(poll.observation.charts).toEqual(charts);
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetcher.mock.calls[1]).toEqual([
    "/live?view=charts",
    expect.objectContaining({ headers: { "If-None-Match": '"charts-6-self_scored"' } }),
  ]);
  poll.stop();
});
it("rejects mismatched charts without advancing the visible score", async () => {
  vi.useFakeTimers();
  const charts: PublicCharts = { v: 1, seq: 7, ballsPerOver: 6, innings: [] };
  const fetcher = vi.fn(() =>
    Promise.resolve(Response.json({ live: { ...initial(), seq: 6 }, charts })),
  );
  const poll = new LivePoll(
    "/live?view=charts",
    initial(),
    vi.fn(),
    fetcher,
    Date.now,
    false,
    undefined,
    true,
  );
  poll.start(true, true);
  await vi.advanceTimersByTimeAsync(0);
  expect(poll.observation.state?.seq).toBe(5);
  expect(poll.observation.charts).toBeUndefined();
  expect(poll.observation.failures).toBe(1);
  poll.stop();
});

it("keeps visible pending results and shot amendments at two seconds until finish, hidden at fifteen", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ ...initial(), seq: 6, phase: "result_reached" }))
    .mockResolvedValueOnce(Response.json({ ...initial(), seq: 7, phase: "result_reached" }))
    .mockResolvedValueOnce(Response.json({ ...initial(), seq: 8, phase: "finished" }));
  const poll = new LivePoll("/live", initial(), vi.fn(), fetcher);
  poll.start(true);
  for (const [index, phase] of ["result_reached", "result_reached", "finished"].entries()) {
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetcher).toHaveBeenCalledTimes(index);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(index + 1);
    expect(poll.observation.state?.phase).toBe(phase);
    expect(poll.observation.state?.seq).toBe(index + 6);
  }
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(3);
  poll.stop();
  const pending = { ...initial(), phase: "result_reached" as const };
  expect(pollDelay(pending, false, 0)).toBe(15000);
  expect(pollDelay(pending, true, 2)).toBe(8000);
  expect(stale({ state: pending, failures: 0, changedAt: 0 }, 60000)).toBe(false);
  const hiddenFetch = vi.fn(() => Promise.resolve(new Response(null, { status: 304 })));
  const hidden = new LivePoll("/live", pending, vi.fn(), hiddenFetch);
  hidden.start(false);
  await vi.advanceTimersByTimeAsync(14999);
  expect(hiddenFetch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(hiddenFetch).toHaveBeenCalledTimes(1);
  hidden.stop();
});
