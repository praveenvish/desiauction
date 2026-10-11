import { afterEach, describe, expect, it, vi } from "vitest";
import { retryDelay, sendBatch, startSync, SyncRefusal } from "./sync";
import type { QueueItem } from "./queue";

const item: QueueItem = {
  status: "pending",
  event: {
    eventId: "entry",
    seq: 6,
    attempt: 1,
    actorPersonId: "scorer",
    type: "ball",
    v: 1,
    payload: { bowlerId: "a", strikerId: "h", nonStrikerId: "h2", runsBat: 0, extras: {} },
    targetEventId: null,
    clientSeq: 6,
    clientRecordedAt: "2026-10-09T00:00:00Z",
  },
};
function fakeWindow() {
  const target = Object.assign(new EventTarget(), {
    navigator: { onLine: true },
    document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
  });
  return target as unknown as Window;
}
afterEach(() => vi.useRealTimers());
describe("scoring send loop", () => {
  it("batches at most 50, sends stable client identity and reloads canonical history", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ acks: [{ eventId: "entry", seq: 6, status: "stored" }] })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ attempt: 1, lastSeq: 0, events: [] })));
    await sendBatch(
      "fixture",
      "device",
      1,
      Array.from({ length: 107 }, () => item),
      false,
      fetcher,
    );
    const init = fetcher.mock.calls[0]?.[1];
    if (typeof init?.body !== "string") throw new Error("Expected JSON request");
    const body = JSON.parse(init.body) as {
      deviceId: string;
      events: Record<string, unknown>[];
    };
    expect(body.deviceId).toBe("device");
    expect(body.events).toHaveLength(50);
    expect(body.events[0]).not.toHaveProperty("seq");
    expect(body.events[0]).not.toHaveProperty("actorPersonId");
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/score/fixture/events?since=0");
  });
  it("bounds exponential retry from one second to thirty seconds", () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(retryDelay)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });
  it("retries transient failure without losing the batch and stops permanent refusals", async () => {
    vi.useFakeTimers();
    const target = fakeWindow(),
      failed = vi.fn();
    const batch = vi.fn().mockResolvedValue({ items: [item], deviceId: "device", attempt: 1 });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("No signal"))
      .mockResolvedValue(new Response(JSON.stringify({ message: "Claim held" }), { status: 403 }));
    const sender = startSync("fixture", { batch, received: vi.fn(), failed }, target, fetcher);
    await sender.flush();
    expect(failed).toHaveBeenCalledWith("No signal", false, []);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(failed).toHaveBeenLastCalledWith("Claim held", true, ["entry"]);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    sender.stop();
  });
  it("pagehide requests keepalive and removes listeners on cleanup", async () => {
    const target = fakeWindow();
    let remaining = [item];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ acks: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ attempt: 1, lastSeq: 0, events: [] })));
    const sender = startSync(
      "fixture",
      {
        batch: () => Promise.resolve({ items: remaining, deviceId: "device", attempt: 1 }),
        received: () => {
          remaining = [];
          return Promise.resolve();
        },
        failed: vi.fn(),
      },
      target,
      fetcher,
    );
    target.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
    expect(fetcher.mock.calls[0]?.[1]?.keepalive).toBe(true);
    sender.stop();
    target.dispatchEvent(new Event("online"));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("a business refusal preserves its server message", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "Reload to continue." }), { status: 409 }),
      );
    await expect(sendBatch("fixture", "device", 1, [item], false, fetcher)).rejects.toEqual(
      new SyncRefusal("Reload to continue.", ["entry"]),
    );
  });
});
