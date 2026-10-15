import { afterEach, expect, it, vi } from "vitest";
import type { FinancialIntent } from "./financial-intent";

const storage = vi.hoisted(() => ({
  bind: vi.fn<() => Promise<unknown>>(),
  read: vi.fn<() => Promise<unknown>>(),
}));
vi.mock("../app/score/storage", () => ({
  bindScoringActor: storage.bind,
  scoringRead: storage.read,
  scoringUpdate: vi.fn(() => Promise.reject(new Error("device store must not be used"))),
  scoringWorkGuard: () => () => {},
}));
const { openFinancialIntentStorage } = await import("./financial-intent-storage");

const intent: FinancialIntent = {
  key: "payment-1",
  actorId: "person",
  orgId: "org",
  caseId: "case",
  targetId: "team",
  kind: "payment",
  amount: "1,000.00",
  method: "manual:cash",
  reason: "",
};
afterEach(() => {
  vi.useRealTimers();
  storage.bind.mockReset();
  storage.read.mockReset();
});

it("records money in this tab when the device store cannot be opened", async () => {
  storage.bind.mockRejectedValue(new Error("IndexedDB blocked"));
  const work = await openFinancialIntentStorage(intent);
  expect(work.degraded).toBe(true);
  const send = vi.fn(() => Promise.resolve({ ok: true as const }));
  expect((await work.dispatch(intent, send)).outcome).toBe("accepted");
  expect(send).toHaveBeenCalledTimes(1);
  expect((await work.read()).map((record) => record.outcome)).toEqual(["accepted"]);
});

it("falls back when the device store never answers", async () => {
  vi.useFakeTimers();
  storage.bind.mockResolvedValue({});
  storage.read.mockReturnValue(new Promise(() => {}));
  const opening = openFinancialIntentStorage(intent);
  await vi.advanceTimersByTimeAsync(3000);
  expect((await opening).degraded).toBe(true);
});

it("still blocks on corrupt stored records", async () => {
  storage.bind.mockResolvedValue({});
  storage.read.mockResolvedValue({ not: "records" });
  await expect(openFinancialIntentStorage(intent)).rejects.toThrow();
});
