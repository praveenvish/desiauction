import { afterEach, expect, it, vi } from "vitest";
import { ViewPing } from "./view-ping";
afterEach(() => vi.useRealTimers());
it("counts visible viewers once a minute and preserves the interval across visibility changes", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  const ping = new ViewPing("/view", { s: "cup" }, fetcher);
  ping.start(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30000);
  ping.visibility(false);
  ping.visibility(true);
  ping.visibility(true);
  await vi.advanceTimersByTimeAsync(29999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0]).toEqual([
    "/view",
    expect.objectContaining({ method: "POST", body: '{"s":"cup"}' }),
  ]);
  ping.visibility(false);
  await vi.advanceTimersByTimeAsync(180000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  ping.visibility(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledTimes(3);
  ping.stop();
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("does not ping on a hidden initial page or retry failures faster than a minute", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockRejectedValue(new Error("Offline"));
  const ping = new ViewPing("/view", {}, fetcher);
  ping.start(false);
  await vi.advanceTimersByTimeAsync(120000);
  expect(fetcher).not.toHaveBeenCalled();
  ping.visibility(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(59999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
  ping.stop();
});
it("does not overlap slow pings and aborts without rescheduling on teardown", async () => {
  vi.useFakeTimers();
  let finish: ((response: Response) => void) | undefined;
  let signal: AbortSignal | null | undefined;
  const fetcher = vi.fn(
    (_url: RequestInfo | URL, options?: RequestInit) =>
      new Promise<Response>((resolve) => {
        finish = resolve;
        signal = options?.signal;
      }),
  );
  const ping = new ViewPing("/view", {}, fetcher);
  ping.start(true);
  await vi.advanceTimersByTimeAsync(0);
  ping.visibility(false);
  ping.visibility(true);
  await vi.advanceTimersByTimeAsync(180000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  ping.stop();
  expect(signal?.aborted).toBe(true);
  finish?.(new Response(null, { status: 204 }));
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
